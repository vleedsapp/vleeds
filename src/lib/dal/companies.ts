import "server-only";

import { cache } from "react";
import {
  formatAddress,
  formatEmployees,
  formatLocation,
  formatObserved,
} from "@/lib/lead-core/display";
import { CONTACT_STATUSES, GRADES, locationSchema, QUALIFICATION_STATES, SOURCE_KINDS, type ContactStatus, type Grade, type QualificationState, type SourceKind } from "@/lib/lead-core/schemas";
import type { CompanyDetail, CompanyList, CompanyListItem, CompanySummary, FitSummary, ScoreView } from "@/lib/lead-core/views";
import { DEFAULT_LEAD_QUERY, LEADS_PAGE_SIZE, type LeadListQuery } from "@/lib/lead-core/list-query";
import type { KnownCompany } from "@/lib/lead-core/dedupe";
import { companyColumns, contactColumns, evidenceFor as evidenceForIngest } from "@/lib/imports/ingest";
import type { ExistingCompany } from "@/lib/imports/merge";
import type { NormalizedCompany, NormalizedContact } from "@/lib/imports/rows";
import { isUuid } from "@/lib/navigation";
import type { ListCompaniesRow } from "@/lib/supabase/app-types";
import type { Json } from "@/lib/supabase/database.types";
import { contactsForCompanies } from "./contacts";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";
import { evidenceFor } from "./lead-sources";
import { scoreCurrentness, scoresForCompanies } from "./lead-scores";
import { scoringInputFor } from "./scoring";
import { activeSuppressions } from "./suppressions";

const asQualification = (v: string): QualificationState =>
  (QUALIFICATION_STATES as readonly string[]).includes(v) ? (v as QualificationState) : "unreviewed";
const asContactStatus = (v: string): ContactStatus =>
  (CONTACT_STATUSES as readonly string[]).includes(v) ? (v as ContactStatus) : "unknown";
const asSourceKind = (v: string): SourceKind => ((SOURCE_KINDS as readonly string[]).includes(v) ? (v as SourceKind) : "other");

function parseLocation(value: Json | null) {
  if (value === null) return null;
  const parsed = locationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const asGrade = (v: string | null): Grade | null => ((GRADES as readonly string[]).includes(v ?? "") ? (v as Grade) : null);

/**
 * One page of the workspace's active companies, filtered and sorted in the
 * database (public.list_companies, RLS applies), with the summary the Leads
 * table needs. Callers must have authorized the workspace; RLS filters again.
 */
export const listCompanies = cache(async (workspaceId: string, query: LeadListQuery = DEFAULT_LEAD_QUERY): Promise<CompanyList> => {
  await requireUser();
  const { data, error } = await (await supabase()).rpc("list_companies", {
    p_workspace_id: workspaceId,
    p_qualification: query.qualification ?? undefined,
    p_grade: query.grade ?? undefined,
    p_restricted: query.restricted ?? undefined,
    p_has_contact: query.hasContact ?? undefined,
    p_country: query.country ?? undefined,
    p_sort: query.sort,
    p_limit: LEADS_PAGE_SIZE,
    p_offset: (query.page - 1) * LEADS_PAGE_SIZE,
  });
  if (error) throw new DataAccessError("listCompanies", error);

  const rows: ListCompaniesRow[] = data ?? [];
  const ids = rows.map((c) => c.id);
  const contacts = await contactsForCompanies(workspaceId, ids);
  const evidence = await evidenceFor(workspaceId, ids, contacts.map((c) => c.id));

  const companyOfContact = new Map(contacts.map((c) => [c.id, c.company_id]));
  const evidenceCount = new Map<string, number>();
  for (const e of evidence) {
    const companyId = e.company_id ?? (e.contact_id ? companyOfContact.get(e.contact_id) : undefined);
    if (companyId) evidenceCount.set(companyId, (evidenceCount.get(companyId) ?? 0) + 1);
  }

  const items: CompanyListItem[] = rows.map((c) => {
    const own = contacts.filter((x) => x.company_id === c.id);
    const primary = own.find((x) => x.is_primary) ?? null;
    return {
      id: c.id,
      name: c.canonical_name,
      domain: c.primary_domain,
      location: formatLocation(parseLocation(c.location)),
      qualification: asQualification(c.qualification_state),
      primaryContact: primary ? { name: primary.full_name, title: primary.job_title } : null,
      contactCount: c.contact_count,
      evidenceCount: evidenceCount.get(c.id) ?? 0,
      restricted: c.restricted,
      grade: asGrade(c.grade),
      score: c.score,
      scoreState: (["current", "excluded", "outdated"].includes(c.score_state) ? c.score_state : "none") as CompanyListItem["scoreState"],
      coveragePercent: c.coverage_percent,
      updatedAt: c.updated_at,
    };
  });

  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { items, total, page: query.page, pageSize: LEADS_PAGE_SIZE, pageCount: Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE)) };
});

/** Active companies that could match the given identities (for duplicate checks). Workspace-local. */
export async function companiesForMatching(
  workspaceId: string,
  keys: { domains: string[]; phones: string[]; names: string[] },
): Promise<KnownCompany[]> {
  const client = await supabase();
  const columns = "id, primary_domain, primary_phone_normalized, normalized_name, location";
  const byId = new Map<string, KnownCompany>();
  const lookups: [string, string[]][] = [
    ["primary_domain", keys.domains],
    ["primary_phone_normalized", keys.phones],
    ["normalized_name", keys.names],
  ];
  for (const [column, values] of lookups) {
    const unique = [...new Set(values.filter(Boolean))];
    for (let i = 0; i < unique.length; i += MATCH_CHUNK) {
      const { data, error } = await client
        .from("companies")
        .select(columns)
        .eq("workspace_id", workspaceId)
        .is("archived_at", null)
        .in(column as "primary_domain", unique.slice(i, i + MATCH_CHUNK));
      if (error) throw new DataAccessError("companiesForMatching", error);
      for (const c of data ?? []) {
        const loc = parseLocation(c.location);
        byId.set(c.id, {
          id: c.id,
          primaryDomain: c.primary_domain,
          primaryPhoneNormalized: c.primary_phone_normalized,
          normalizedName: c.normalized_name,
          location: loc ? { countryCode: loc.countryCode, region: loc.region, city: loc.city } : null,
          externalIds: [],
        });
      }
    }
  }
  return [...byId.values()];
}

const MATCH_CHUNK = 100;

/** Full editable values of one company (merge planning). */
export async function companyForMerge(workspaceId: string, companyId: string): Promise<(ExistingCompany & { id: string }) | null> {
  const { data, error } = await (await supabase())
    .from("companies")
    .select(
      "id, canonical_name, normalized_name, website_url, primary_domain, primary_phone, primary_phone_normalized, location, employee_count_min, employee_count_max, qualification_state, notes, industry, description",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", companyId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new DataAccessError("companyForMerge", error);
  return data;
}

/** Short description of companies for duplicate warnings and review. */
export async function companySummaries(workspaceId: string, ids: string[]): Promise<Map<string, CompanySummary>> {
  const out = new Map<string, CompanySummary>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const { data, error } = await (await supabase())
    .from("companies")
    .select("id, canonical_name, primary_domain, primary_phone, location")
    .eq("workspace_id", workspaceId)
    .in("id", unique);
  if (error) throw new DataAccessError("companySummaries", error);
  const contacts = await contactsForCompanies(workspaceId, unique);
  for (const c of data ?? []) {
    const primary = contacts.find((k) => k.company_id === c.id && k.is_primary);
    out.set(c.id, {
      id: c.id,
      name: c.canonical_name,
      domain: c.primary_domain,
      phone: c.primary_phone,
      location: formatLocation(parseLocation(c.location)),
      primaryContact: primary?.full_name ?? null,
    });
  }
  return out;
}

/**
 * Creates a company (optionally with its first contact, who becomes primary)
 * plus manual evidence, as one transaction (public.ingest_lead).
 */
export async function createCompanyManual(
  workspaceId: string,
  company: NormalizedCompany,
  contact: NormalizedContact | null,
): Promise<MutationResult<{ companyId: string }>> {
  await requireUser();
  const { data, error } = await (await supabase()).rpc("ingest_lead", {
    p_workspace_id: workspaceId,
    p_company: { fields: companyColumns(company) } as Json,
    p_contact: contact ? ({ fields: contactColumns(contact), primary_if_none: true } as Json) : undefined,
    p_evidence: evidenceForIngest(company, contact, "manual") as Json,
  });
  if (error) return { ok: false, reason: failureFromDbError("createCompanyManual", error) };
  const result = data as { company_id?: string } | null;
  return result?.company_id ? { ok: true, data: { companyId: result.company_id } } : { ok: false, reason: "failed" };
}
/** Evidence rows shown in the drawer (most recent first); the total is reported separately. */
const EVIDENCE_SHOWN = 25;

/**
 * Everything the company drawer shows, or null when the company is not visible
 * (unknown, archived, another workspace, or not authorized — indistinguishable).
 */
export const getCompanyDetail = cache(async (workspaceId: string, companyId: string): Promise<CompanyDetail | null> => {
  if (!isUuid(companyId)) return null;
  await requireUser();
  const { data: c, error } = await (await supabase())
    .from("companies")
    .select(
      "id, canonical_name, website_url, primary_domain, primary_phone, location, employee_count_min, employee_count_max, industry, description, qualification_state, qualification_reason, notes, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", companyId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new DataAccessError("getCompanyDetail", error);
  if (!c) return null;

  const contacts = await contactsForCompanies(workspaceId, [c.id]);
  const [suppressions, evidence, scores] = await Promise.all([
    activeSuppressions(workspaceId, [c.id]),
    evidenceFor(workspaceId, [c.id], contacts.map((x) => x.id)),
    scoresForCompanies(workspaceId, [c.id]),
  ]);
  // P1-E6: currentness = current profile revision + current input fingerprint.
  const scoreViews: ScoreView[] = await Promise.all(
    scores.map(async (s) => {
      const cur = await scoreCurrentness(workspaceId, s);
      return {
        id: s.id,
        profileId: s.profileId,
        profileName: s.profileName,
        profileIsDefault: s.profileIsDefault,
        revision: s.revision,
        outdated: !cur.current,
        outdatedReason: cur.reason,
        excluded: s.status === "excluded",
        coveragePercent: s.coveragePercent,
        status: s.status,
        score: s.score,
        grade: s.grade,
        scoredAt: s.scoredAt,
      };
    }),
  );
  const fit = await fitSummary(workspaceId, c.id, scoreViews);
  const location = parseLocation(c.location);
  const contactName = new Map(contacts.map((x) => [x.id, x.full_name]));
  const companyRestriction = suppressions.find((s) => s.scope === "company");

  return {
    id: c.id,
    name: c.canonical_name,
    websiteUrl: c.website_url,
    domain: c.primary_domain,
    phone: c.primary_phone,
    location: formatLocation(location),
    address: formatAddress(location),
    employees: formatEmployees(c.employee_count_min, c.employee_count_max),
    industry: c.industry,
    description: c.description,
    qualification: asQualification(c.qualification_state),
    qualificationReason: c.qualification_reason,
    notes: c.notes,
    updatedAt: c.updated_at,
    restriction: companyRestriction ? { id: companyRestriction.id, reason: companyRestriction.reason } : null,
    contacts: contacts.map((x) => {
      const r = suppressions.find((s) => s.scope === "contact" && s.contactId === x.id);
      return {
        id: x.id,
        fullName: x.full_name,
        jobTitle: x.job_title,
        email: x.email,
        phone: x.phone,
        linkedinUrl: x.linkedin_url,
        isPrimary: x.is_primary,
        status: asContactStatus(x.status),
        restriction: r ? { id: r.id, reason: r.reason } : null,
      };
    }),
    evidence: evidence.slice(0, EVIDENCE_SHOWN).map((e) => ({
      id: e.id,
      subject: e.contact_id ? "contact" : "company",
      contactName: e.contact_id ? (contactName.get(e.contact_id) ?? null) : null,
      fieldKey: e.field_key,
      sourceKind: asSourceKind(e.source_kind),
      providerKey: e.provider_key,
      sourceUrl: e.source_url,
      value: formatObserved(e.observed_value),
      confidence: e.confidence,
      observedAt: e.observed_at ?? e.created_at,
    })),
    evidenceTotal: evidence.length,
    scores: scoreViews.sort((a, b) => Number(a.outdated) - Number(b.outdated) || b.revision - a.revision),
    fit,
  };
});

/**
 * Sets a company's operational qualification. Any workspace member may do this
 * (RLS: is_workspace_member). Only these two columns are written.
 */
export async function setCompanyQualification(
  workspaceId: string,
  companyId: string,
  update: { state: QualificationState; reason: string | null },
): Promise<MutationResult<{ id: string }>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("companies")
    .update({ qualification_state: update.state, qualification_reason: update.reason })
    .eq("workspace_id", workspaceId)
    .eq("id", companyId)
    .is("archived_at", null)
    .select("id");
  if (error) return { ok: false, reason: failureFromDbError("setCompanyQualification", error) };
  if (!data?.length) return { ok: false, reason: "forbidden" };
  return { ok: true, data: { id: data[0].id } };
}

/**
 * Fit against the workspace's DEFAULT profile for the drawer: the current
 * result (if any), why an older one is outdated, and how many of the
 * profile's enabled signals have an observation for its current revision.
 */
async function fitSummary(workspaceId: string, companyId: string, scores: ScoreView[]): Promise<FitSummary | null> {
  const { data, error } = await (await supabase())
    .from("icp_profiles")
    .select("id, name, revision")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .is("archived_at", null)
    .limit(1);
  if (error) throw new DataAccessError("fitSummary", error);
  const profile = data?.[0];
  if (!profile) return null;
  const input = await scoringInputFor(workspaceId, companyId, profile.id);
  const enabled = [...(input?.icp.buyingSignals ?? []), ...(input?.icp.exclusionSignals ?? [])].filter((s) => s.enabled);
  const confirmed = enabled.filter((s) => input?.signals.some((o) => o.id === s.id)).length;
  const mine = scores.filter((s) => s.profileId === profile.id && (s.status === "scored" || s.status === "excluded" || s.status === "stale"));
  const latest = mine.sort((a, b) => b.revision - a.revision)[0];
  const state: FitSummary["state"] = !latest ? "none" : latest.outdated ? "outdated" : latest.excluded ? "excluded" : "current";
  return {
    profileId: profile.id,
    profileName: profile.name,
    revision: profile.revision,
    state,
    grade: state === "current" ? latest!.grade : null,
    score: state === "current" ? latest!.score : null,
    coveragePercent: state === "current" || state === "excluded" ? latest!.coveragePercent : null,
    outdatedReason: state === "outdated" ? latest!.outdatedReason : null,
    signals: { confirmed, unknown: enabled.length - confirmed },
  };
}
