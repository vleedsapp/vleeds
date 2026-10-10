import { planRowCommit, type CommitPlan } from "@/lib/imports/commit";
import { fitEvidence } from "@/lib/imports/ingest";
import { planCompanyMerge, type ExistingCompany } from "@/lib/imports/merge";
import type { NormalizedCompany } from "@/lib/imports/rows";
import { matchCompany, type CompanyMatchReason, type ExternalIdentity, type KnownCompany } from "@/lib/lead-core/dedupe";
import { formatEmployees, formatLocation } from "@/lib/lead-core/display";
import { companyInputSchema, locationSchema } from "@/lib/lead-core/schemas";
import type { EnrichedCompany } from "@/lib/providers/company-enrichment/types";
import type { EnrichmentDecision, EnrichmentMatchState } from "./model";

/**
 * Enrichment → the existing P1-E2 pipeline. Pure functions:
 *   toNormalizedCompany   provider fields → lead-core validation/normalization
 *   classifyEnrichment    lead-core dedupe hierarchy (provider id → domain →
 *                         phone review → name+place review → new)
 *   planEnrichmentCommit  the CSV commit planner (same merge rules) + provider
 *                         evidence, then public.ingest_lead
 * No second normalization, matching or merge algorithm exists for enrichment.
 */

// -----------------------------------------------------------------------------
// Normalization
// -----------------------------------------------------------------------------

/**
 * Validates and normalizes provider fields with the lead-core company schema.
 * A field the schema rejects (e.g. an unusable phone) is dropped rather than
 * failing the whole company; the name falls back to the domain when the
 * provider returned none (never to transient discovery content).
 */
export function toNormalizedCompany(c: Pick<EnrichedCompany, "name" | "domain" | "websiteUrl" | "phone" | "location" | "employeeCountMin" | "employeeCountMax" | "industry" | "description">): NormalizedCompany | null {
  const input: Record<string, unknown> = {
    canonicalName: c.name ?? c.domain,
    websiteUrl: c.websiteUrl,
    primaryDomain: c.domain,
    primaryPhone: c.phone,
    location: c.location,
    employeeCountMin: c.employeeCountMin,
    employeeCountMax: c.employeeCountMax,
    industry: c.industry,
    description: c.description,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const parsed = companyInputSchema.safeParse(input);
    if (parsed.success) {
      const v = parsed.data;
      if (!v.primaryDomain) return null;
      return {
        canonicalName: v.canonicalName,
        normalizedName: v.normalizedName,
        websiteUrl: v.websiteUrl,
        primaryDomain: v.primaryDomain,
        primaryPhone: v.primaryPhone,
        primaryPhoneNormalized: v.primaryPhoneNormalized,
        location: v.location,
        employeeCountMin: v.employeeCountMin,
        employeeCountMax: v.employeeCountMax,
        qualificationState: null,
        notes: null,
        industry: v.industry,
        description: v.description,
      };
    }
    const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    if (bad.has("canonicalName") || bad.has("primaryDomain")) return null;
    if (bad.has("employeeCountMax") || bad.has("employeeCountMin")) {
      input.employeeCountMin = null;
      input.employeeCountMax = null;
    }
    for (const k of bad) if (k !== "employeeCountMin" && k !== "employeeCountMax") input[k] = null;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Matching
// -----------------------------------------------------------------------------

export type EnrichmentClassification = {
  matchState: EnrichmentMatchState;
  matchReason: CompanyMatchReason | null;
  matchedCompanyId: string | null;
};

/**
 * @param target      the company an "existing company" enrichment started from
 * @param identities  provider identities of the incoming record (enrichment
 *                    provider id, and the discovery reference it came from)
 * @param known       candidate companies of THIS workspace, with their linked
 *                    provider identities
 */
export function classifyEnrichment(
  company: NormalizedCompany,
  identities: ExternalIdentity[],
  known: KnownCompany[],
  target: string | null,
): EnrichmentClassification {
  if (target) return { matchState: "existing_company", matchReason: null, matchedCompanyId: target };
  const candidate = { name: company.canonicalName, domain: company.primaryDomain, phone: company.primaryPhone, location: company.location };
  // matchCompany takes one provider identity; try each (then none) — the hierarchy is unchanged.
  let r: ReturnType<typeof matchCompany> = { outcome: "new" };
  for (const external of [...identities, null]) {
    r = matchCompany({ ...candidate, external }, known);
    if (r.outcome === "match") return { matchState: "existing_company", matchReason: r.reason, matchedCompanyId: r.id };
  }
  if (r.outcome === "review") return { matchState: "possible_duplicate", matchReason: r.reason, matchedCompanyId: r.ids[0] };
  return { matchState: "new", matchReason: null, matchedCompanyId: null };
}

// -----------------------------------------------------------------------------
// Commit planning
// -----------------------------------------------------------------------------

export type EnrichmentCommitContext = {
  /** The company to merge into (current values), when merging. */
  target: (ExistingCompany & { id: string }) | null;
  /** Another active company of the workspace already has the incoming domain. */
  domainOwnedElsewhere: { id: string; name: string } | null;
};

/**
 * Plans one enrichment commit with the P1-E2 row planner (create/merge/skip,
 * conservative merge, evidence per non-empty field), stamped with the
 * provider's identity, plus tags as evidence only.
 */
export function planEnrichmentCommit(
  company: NormalizedCompany,
  matchState: EnrichmentMatchState,
  decision: EnrichmentDecision,
  provider: { providerKey: string; label: string; externalRecordId: string | null },
  tags: string[],
  ctx: EnrichmentCommitContext,
): CommitPlan {
  const plan = planRowCommit(
    {
      commitResult: null,
      matchState: matchState === "existing_company" ? "matched" : matchState,
      decision,
      staged: { mapped: {}, company, contact: null },
    },
    { target: ctx.target, targetContacts: [], emailOwners: [] },
    "api",
    { provider: { providerKey: provider.providerKey, externalRecordId: provider.externalRecordId }, sourceLabel: provider.label },
  );
  if (plan.kind !== "ingest") return plan;

  // One active company per domain: never move a domain onto a second company.
  if (ctx.domainOwnedElsewhere) {
    const fields = plan.call.company.fields;
    if ("primary_domain" in fields || !plan.call.company.id) {
      delete fields.primary_domain;
      delete fields.website_url;
      plan.notes.push(`Domain not added: ${ctx.domainOwnedElsewhere.name} already uses ${company.primaryDomain}.`);
    }
  }

  if (tags.length) {
    plan.call.evidence.push({
      subject: "company",
      field_key: "company.tags",
      observed_value: fitEvidence(tags.join(", ")),
      source_kind: "api",
      provider_key: provider.providerKey,
      ...(provider.externalRecordId ? { external_record_id: provider.externalRecordId } : {}),
    });
  }
  return plan;
}

// -----------------------------------------------------------------------------
// Review preview
// -----------------------------------------------------------------------------

/**
 * Per-field comparison for the review screen, derived from the SAME merge
 * planner the commit uses (so the preview can't disagree with the write):
 *   new   no existing company: the value is used as is
 *   fill  the existing field is empty and will be filled
 *   same  equal after normalization: nothing changes
 *   keep  both populated and different: the existing value is kept
 *   none  the provider returned nothing for this field
 */
export type FieldOutcome = "new" | "fill" | "same" | "keep" | "none";
export type ReviewField = { key: string; label: string; incoming: string | null; existing: string | null; outcome: FieldOutcome };

const fmt = {
  location: (l: unknown) => {
    const parsed = l ? locationSchema.safeParse(l) : null;
    return parsed?.success ? formatLocation(parsed.data) : null;
  },
  employees: formatEmployees,
};

export function reviewFields(company: NormalizedCompany, existing: (ExistingCompany & { id: string }) | null): ReviewField[] {
  const patch = existing ? planCompanyMerge(existing, company).patch : {};
  const row = (key: string, label: string, incoming: string | null, current: string | null, column: string | null, equal: boolean): ReviewField => ({
    key,
    label,
    incoming,
    existing: current,
    outcome: !incoming ? "none" : !existing ? "new" : column && column in patch ? "fill" : equal || !current ? "same" : "keep",
  });
  const e = existing;
  const lower = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  return [
    row("name", "Company name", company.canonicalName, e?.canonical_name ?? null, null, !!e && lower(e.canonical_name) === lower(company.canonicalName)),
    row("domain", "Domain", company.primaryDomain, e?.primary_domain ?? null, "primary_domain", e?.primary_domain === company.primaryDomain),
    row("industry", "Industry", company.industry ?? null, e?.industry ?? null, "industry", lower(e?.industry) === lower(company.industry)),
    row("location", "Location", fmt.location(company.location), e ? fmt.location(e.location) : null, "location", JSON.stringify(e?.location ?? null) === JSON.stringify(company.location)),
    row("phone", "Phone", company.primaryPhone, e?.primary_phone ?? null, "primary_phone", !!e && (e.primary_phone ?? "").replace(/\D/g, "") === (company.primaryPhone ?? "").replace(/\D/g, "")),
    row(
      "employees",
      "Employees",
      fmt.employees(company.employeeCountMin, company.employeeCountMax),
      e ? fmt.employees(e.employee_count_min, e.employee_count_max) : null,
      "employee_count_min" in patch ? "employee_count_min" : "employee_count_max",
      !!e && e.employee_count_min === company.employeeCountMin && e.employee_count_max === company.employeeCountMax,
    ),
    row("description", "Description", company.description ?? null, e?.description ?? null, "description", (e?.description ?? "").trim() === (company.description ?? "").trim()),
  ];
}
