import "server-only";

import {
  commitEnrichment,
  companiesForEnrichmentMatching,
  companyForMerge,
  companyWithDomain,
  discoveryReferenceById,
  enrichmentRunCreditMillis,
  getEnrichmentResult,
  insertEnrichmentResult,
  recordEnrichmentUsage,
  resultLocation,
  updateEnrichmentRun,
  type EnrichmentRunRecord,
} from "@/lib/dal";
import type { NormalizedCompany } from "@/lib/imports/rows";
import type { CompanyEnrichmentProvider, DomainSuggestion } from "@/lib/providers/company-enrichment/types";
import {
  allowedEnrichmentDecisions,
  enrichmentMessage,
  suggestedDecision,
  type EnrichmentDecision,
  type EnrichmentMatchState,
  type EnrichmentView,
} from "./model";
import { classifyEnrichment, planEnrichmentCommit, reviewFields, toNormalizedCompany } from "./plan";

/**
 * Orchestrates ONE enrichment run on explicit user actions (server-side):
 *   resolve domain (free) → enrich company (credit-bearing, explicit) →
 *   normalize + classify → durable result → review → ingest_lead.
 * Every provider request is accounted for in provider_usage_events with an
 * estimated credit figure. Transient discovery content may be passed in for a
 * single domain lookup and is never written anywhere.
 */

const RETRYABLE = new Set(["timeout", "unavailable", "rate_limited", "malformed", "storage"]);

export type StepOutcome = { suggestions: DomainSuggestion[]; error: { code: string } | null };

/** Domain resolution for a run. The name is used for this request only. */
export async function resolveDomainsForRun(
  workspaceId: string,
  run: EnrichmentRunRecord,
  provider: CompanyEnrichmentProvider,
  companyName: string,
): Promise<StepOutcome> {
  const moved = await updateEnrichmentRun(workspaceId, run.id, ["draft", "domain_review", "failed"], { status: "resolving_domain", error_code: null });
  if (!moved.ok) return { suggestions: [], error: { code: "stale" } };
  const r = await provider.resolveDomain({ companyName });
  if (r.usage) await recordEnrichmentUsage(workspaceId, run.id, provider.providerKey, r.usage);
  const code = r.ok ? null : r.code === "invalid_request" && !r.usage ? "invalid_name" : r.code;
  await updateEnrichmentRun(workspaceId, run.id, ["resolving_domain"], { status: "domain_review", error_code: code });
  return r.ok ? { suggestions: r.suggestions, error: null } : { suggestions: [], error: { code: code! } };
}

/** Company enrichment for a run and a chosen domain; on success records the durable result and moves to review. */
export async function enrichRun(
  workspaceId: string,
  run: EnrichmentRunRecord,
  provider: CompanyEnrichmentProvider,
  domain: string,
): Promise<{ error: { code: string } | null }> {
  const moved = await updateEnrichmentRun(workspaceId, run.id, ["draft", "domain_review", "failed"], { status: "enriching", requested_domain: domain, error_code: null });
  if (!moved.ok) return { error: { code: "stale" } };
  const fail = async (code: string) => {
    await updateEnrichmentRun(workspaceId, run.id, ["enriching"], { status: "failed", error_code: code });
    return { error: { code } };
  };

  const r = await provider.enrichCompany({ domain });
  if (r.usage) await recordEnrichmentUsage(workspaceId, run.id, provider.providerKey, r.usage);
  if (!r.ok) return fail(r.code);

  const company = toNormalizedCompany(r.company);
  if (!company) return fail("unusable");

  // Identities: the enrichment provider's company id, and the discovery reference the run came from.
  const identities: { providerKey: string; externalRecordId: string }[] = [];
  if (r.company.externalId) identities.push({ providerKey: provider.providerKey, externalRecordId: r.company.externalId });
  if (run.discoveryCandidateId) {
    const ref = await discoveryReferenceById(workspaceId, run.discoveryCandidateId);
    if (ref) identities.push({ providerKey: ref.providerKey, externalRecordId: ref.externalRecordId });
  }
  let target: string | null = null;
  if (run.inputKind === "existing_company" && run.targetCompanyId) {
    target = (await companyForMerge(workspaceId, run.targetCompanyId))?.id ?? null;
    if (!target) return fail("target_gone");
  }
  const known = await companiesForEnrichmentMatching(workspaceId, company, identities);
  const match = classifyEnrichment(
    company,
    identities.map((i) => ({ providerKey: i.providerKey, externalRecordId: i.externalRecordId })),
    known,
    target,
  );

  const stored = await insertEnrichmentResult(workspaceId, run.id, provider.providerKey, {
    externalRecordId: r.company.externalId,
    company,
    tags: r.company.tags,
    matchState: match.matchState,
    matchedCompanyId: match.matchedCompanyId,
  });
  if (!stored.ok) return fail("storage");

  const done = await updateEnrichmentRun(workspaceId, run.id, ["enriching"], {
    status: "review",
    resolved_domain: company.primaryDomain,
    match_state: match.matchState,
    match_reason: match.matchReason,
    matched_company_id: match.matchedCompanyId,
    decision: suggestedDecision(match.matchState),
  });
  return { error: done.ok ? null : { code: "storage" } };
}

/** A stored result as lead-core input (durable data only; never browser input). */
export function storedCompany(result: NonNullable<Awaited<ReturnType<typeof getEnrichmentResult>>>): NormalizedCompany | null {
  return toNormalizedCompany({
    name: result.canonicalName,
    domain: result.primaryDomain,
    websiteUrl: result.websiteUrl,
    phone: result.primaryPhone,
    location: resultLocation(result.location),
    employeeCountMin: result.employeeCountMin,
    employeeCountMax: result.employeeCountMax,
    industry: result.industry,
    description: result.description,
  });
}

export type SaveOutcome =
  | { ok: true; commitResult: "created" | "merged" | "skipped"; companyId: string | null; companyName: string | null; evidenceAdded: number; identityLinked: boolean; notes: string[] }
  | { ok: false; code: string };

const DB_MESSAGE: Record<string, string> = {
  conflict: "conflict",
  stale: "stale",
  forbidden: "target_gone",
};

/** Create / merge / skip for a run in review, through the P1-E2 planner and public.ingest_lead. */
export async function saveRun(
  workspaceId: string,
  run: EnrichmentRunRecord,
  provider: { providerKey: string; label: string },
  decision: EnrichmentDecision,
): Promise<SaveOutcome> {
  if (run.status !== "review" || !run.matchState) return { ok: false, code: "stale" };
  if (!allowedEnrichmentDecisions(run.matchState).includes(decision)) return { ok: false, code: "decision" };

  if (decision === "skip") {
    const r = await updateEnrichmentRun(workspaceId, run.id, ["review"], {
      status: "completed",
      decision: "skip",
      commit_result: "skipped",
      commit_notes: ["Skipped by decision. Nothing was written to Leads."],
      completed_at: new Date().toISOString(),
    });
    return r.ok ? { ok: true, commitResult: "skipped", companyId: null, companyName: null, evidenceAdded: 0, identityLinked: false, notes: [] } : { ok: false, code: "stale" };
  }

  const result = await getEnrichmentResult(workspaceId, run.id);
  const company = result ? storedCompany(result) : null;
  if (!result || !company) return { ok: false, code: "storage" };

  const target = decision === "merge" && run.matchedCompanyId ? await companyForMerge(workspaceId, run.matchedCompanyId) : null;
  if (decision === "merge" && !target) return { ok: false, code: "target_gone" };
  const owner = company.primaryDomain ? await companyWithDomain(workspaceId, company.primaryDomain, target?.id ?? null) : null;

  const plan = planEnrichmentCommit(
    company,
    run.matchState as EnrichmentMatchState,
    decision,
    { providerKey: provider.providerKey, label: provider.label, externalRecordId: result.externalRecordId },
    result.tags,
    { target, domainOwnedElsewhere: owner },
  );
  if (plan.kind !== "ingest") return { ok: false, code: plan.kind === "fail" ? "target_gone" : "stale" };

  const moved = await updateEnrichmentRun(workspaceId, run.id, ["review"], { status: "processing", decision });
  if (!moved.ok) return { ok: false, code: "stale" };
  const written = await commitEnrichment(workspaceId, run.id, plan.call, plan.notes);
  if (!written.ok) {
    await updateEnrichmentRun(workspaceId, run.id, ["processing"], { status: "review" });
    return { ok: false, code: DB_MESSAGE[written.reason] ?? "storage" };
  }
  return {
    ok: true,
    commitResult: written.data.commitResult,
    companyId: written.data.companyId,
    companyName: target?.canonical_name ?? company.canonicalName,
    evidenceAdded: plan.call.evidence.length,
    identityLinked: written.data.identityLinked,
    notes: plan.notes,
  };
}

const MATCH_TEXT: Record<string, string> = {
  external_id: "the same provider record",
  domain: "the same domain",
  phone: "the same phone number",
  name_location: "the same name in the same place",
};

/** Builds what the sheet shows for a run (review data from the stored result; suggestions only if just fetched). */
export async function viewFor(
  workspaceId: string,
  run: EnrichmentRunRecord,
  provider: CompanyEnrichmentProvider,
  extra: { suggestions?: DomainSuggestion[]; error?: { code: string } | null; outcome?: EnrichmentView["outcome"] } = {},
): Promise<EnrichmentView> {
  let review: EnrichmentView["review"] = null;
  if ((run.status === "review" || run.status === "processing") && run.matchState) {
    const result = await getEnrichmentResult(workspaceId, run.id);
    const company = result ? storedCompany(result) : null;
    if (result && company) {
      const existing = run.matchedCompanyId ? await companyForMerge(workspaceId, run.matchedCompanyId) : null;
      const matched = existing ? { id: existing.id, name: existing.canonical_name } : null;
      review = {
        fields: reviewFields(company, run.matchState === "new" ? null : existing),
        matchState: run.matchState,
        matchText:
          run.matchState === "new"
            ? "New company: nothing in this workspace matches it."
            : run.inputKind === "existing_company"
              ? `Enriching ${matched?.name ?? "this company"}. Only empty fields are filled.`
              : run.matchState === "existing_company"
                ? `Existing company: ${matched?.name ?? "a company in this workspace"} has ${MATCH_TEXT[run.matchReason ?? ""] ?? "a matching identity"}.`
                : `Possible duplicate: ${matched?.name ?? "a company in this workspace"} has ${MATCH_TEXT[run.matchReason ?? ""] ?? "a similar identity"}.`,
        matched,
        allowed: allowedEnrichmentDecisions(run.matchState),
        decision: run.decision,
        tags: result.tags,
      };
    }
  }
  const code = extra.error?.code ?? (run.status === "failed" || run.status === "domain_review" ? run.errorCode : null);
  const estimate = provider.enrichmentCreditEstimate();
  return {
    runId: run.id,
    status: run.status,
    inputKind: run.inputKind,
    providerLabel: provider.label,
    requestedDomain: run.requestedDomain,
    suggestions: (extra.suggestions ?? []).map((s) => ({ domain: s.domain, companyName: s.companyName, confidenceLabel: s.confidenceLabel ?? null, emailCount: s.emailCount ?? null })),
    error: code ? { code, message: enrichmentMessage(code, provider.label), retry: RETRYABLE.has(code) } : null,
    review,
    outcome: extra.outcome ?? null,
    creditsUsedMillis: await enrichmentRunCreditMillis(workspaceId, run.id),
    enrichmentEstimateMillis: estimate?.millis ?? null,
  };
}
