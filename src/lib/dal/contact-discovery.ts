import "server-only";

import type { CandidateDecision, ContactMatchState, ContactRunStatus, RoleMatch, SelectedAction, TargetTitle } from "@/lib/contact-discovery/model";
import type { ContactCandidate, VerificationStatus } from "@/lib/providers/contact-discovery/types";
import { isUuid } from "@/lib/navigation";
import type { Json } from "@/lib/supabase/database.types";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";

/**
 * Contact-discovery runs and their candidates (P1-E5): staging/review records
 * for one company's professional-contact search. Minimal professional fields
 * only; never provider payloads.
 */

export type ContactRunRecord = {
  id: string;
  companyId: string;
  icpProfileId: string | null;
  icpRevision: number | null;
  providerKey: string;
  domain: string;
  status: ContactRunStatus;
  titles: TargetTitle[];
  decisionMakerOnly: boolean;
  requestedLimit: number;
  resultCount: number;
  selectedCount: number;
  savedCount: number;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

const RUN_COLUMNS =
  "id, company_id, icp_profile_id, icp_revision, provider_key, domain, status, selected_titles, decision_maker_only, requested_limit, result_count, selected_count, saved_count, error_code, created_at, completed_at";

type RunRow = {
  id: string; company_id: string; icp_profile_id: string | null; icp_revision: number | null; provider_key: string; domain: string;
  status: string; selected_titles: Json; decision_maker_only: boolean; requested_limit: number; result_count: number;
  selected_count: number; saved_count: number; error_code: string | null; created_at: string; completed_at: string | null;
};

const asTitles = (v: Json): TargetTitle[] =>
  Array.isArray(v)
    ? v.flatMap((t) => {
        const o = t as { title?: unknown; priority?: unknown };
        return typeof o?.title === "string" && ["primary", "secondary", "fallback", "search"].includes(String(o.priority))
          ? [{ title: o.title, priority: o.priority as TargetTitle["priority"] }]
          : [];
      })
    : [];

const toRun = (r: RunRow): ContactRunRecord => ({
  id: r.id,
  companyId: r.company_id,
  icpProfileId: r.icp_profile_id,
  icpRevision: r.icp_revision,
  providerKey: r.provider_key,
  domain: r.domain,
  status: r.status as ContactRunStatus,
  titles: asTitles(r.selected_titles),
  decisionMakerOnly: r.decision_maker_only,
  requestedLimit: r.requested_limit,
  resultCount: r.result_count,
  selectedCount: r.selected_count,
  savedCount: r.saved_count,
  errorCode: r.error_code,
  createdAt: r.created_at,
  completedAt: r.completed_at,
});

export async function getContactRun(workspaceId: string, runId: string): Promise<ContactRunRecord | null> {
  if (!isUuid(runId)) return null;
  await requireUser();
  const { data, error } = await (await supabase())
    .from("contact_discovery_runs")
    .select(RUN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new DataAccessError("getContactRun", error);
  return data ? toRun(data) : null;
}

/** The latest search of a company (for the drawer's "Last search" line), or null. */
export async function latestContactRun(workspaceId: string, companyId: string): Promise<(ContactRunRecord & { icpName: string | null }) | null> {
  await requireUser();
  const client = await supabase();
  const { data, error } = await client
    .from("contact_discovery_runs")
    .select(RUN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new DataAccessError("latestContactRun", error);
  const row = data?.[0];
  if (!row) return null;
  let icpName: string | null = null;
  if (row.icp_profile_id) {
    const { data: p } = await client.from("icp_profiles").select("name").eq("workspace_id", workspaceId).eq("id", row.icp_profile_id).maybeSingle();
    icpName = p?.name ?? null;
  }
  return { ...toRun(row), icpName };
}

export async function createContactRun(
  workspaceId: string,
  input: { companyId: string; icpProfileId: string | null; icpRevision: number | null; providerKey: string; domain: string; titles: TargetTitle[]; decisionMakerOnly: boolean; limit: number },
): Promise<MutationResult<{ id: string }>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("contact_discovery_runs")
    .insert({
      workspace_id: workspaceId,
      company_id: input.companyId,
      icp_profile_id: input.icpProfileId,
      icp_revision: input.icpRevision,
      provider_key: input.providerKey,
      domain: input.domain,
      status: "searching",
      selected_titles: input.titles as Json,
      decision_maker_only: input.decisionMakerOnly,
      requested_limit: input.limit,
    })
    .select("id");
  if (error || !data?.length) return { ok: false, reason: error ? failureFromDbError("createContactRun", error) : "forbidden" };
  return { ok: true, data: { id: data[0].id } };
}

/** Moves a run between states; only from one of `from` (double actions can't race). */
export async function updateContactRun(
  workspaceId: string,
  runId: string,
  from: ContactRunStatus[],
  patch: { status: ContactRunStatus; error_code?: string | null; completed_at?: string; cancelled_at?: string },
): Promise<MutationResult<null>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("contact_discovery_runs")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .in("status", from)
    .select("id");
  if (error) return { ok: false, reason: error.code === "55000" ? "stale" : failureFromDbError("updateContactRun", error) };
  return data?.length ? { ok: true, data: null } : { ok: false, reason: "stale" };
}

// -----------------------------------------------------------------------------
// Candidates
// -----------------------------------------------------------------------------

export type CandidateInsert = ContactCandidate & { position: number; roleMatch: RoleMatch; matchState: ContactMatchState; matchedContactId: string | null };

export async function insertContactCandidates(workspaceId: string, runId: string, companyId: string, rows: CandidateInsert[]): Promise<MutationResult<null>> {
  if (!rows.length) return { ok: true, data: null };
  await requireUser();
  const { error } = await (await supabase()).from("contact_discovery_candidates").insert(
    rows.map((c) => ({
      workspace_id: workspaceId,
      contact_discovery_run_id: runId,
      company_id: companyId,
      provider_key: c.providerKey,
      provider_external_id: c.externalId,
      position: c.position,
      full_name: c.fullName,
      first_name: c.firstName,
      last_name: c.lastName,
      job_title: c.jobTitle,
      email: c.email,
      normalized_email: c.normalizedEmail,
      phone: c.phone,
      linkedin_url: c.linkedinUrl,
      provider_seniority: c.providerSeniority,
      provider_department: c.providerDepartment,
      provider_decision_maker: c.providerDecisionMaker,
      verification_status: c.verificationStatus,
      confidence: c.confidence,
      source_count: c.sourceCount,
      last_seen_on: c.lastSeenOn,
      role_match: c.roleMatch,
      match_state: c.matchState,
      matched_contact_id: c.matchedContactId,
    })),
  );
  if (error) return { ok: false, reason: failureFromDbError("insertContactCandidates", error) };
  return { ok: true, data: null };
}

export type CandidateRecord = {
  id: string;
  position: number;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string;
  normalizedEmail: string;
  phone: string | null;
  linkedinUrl: string | null;
  providerSeniority: string | null;
  providerDepartment: string | null;
  providerDecisionMaker: boolean | null;
  verificationStatus: VerificationStatus | null;
  confidence: number | null;
  roleMatch: RoleMatch;
  matchState: ContactMatchState;
  matchedContactId: string | null;
  decision: CandidateDecision;
  selectedAction: SelectedAction | null;
  commitResult: "created" | "merged" | null;
  committedContactId: string | null;
};

const CANDIDATE_COLUMNS =
  "id, position, full_name, first_name, last_name, job_title, email, normalized_email, phone, linkedin_url, provider_seniority, provider_department, provider_decision_maker, verification_status, confidence, role_match, match_state, matched_contact_id, decision, selected_action, commit_result, committed_contact_id";

type CandidateRow = {
  id: string; position: number; full_name: string; first_name: string | null; last_name: string | null; job_title: string | null; email: string;
  normalized_email: string; phone: string | null; linkedin_url: string | null; provider_seniority: string | null; provider_department: string | null;
  provider_decision_maker: boolean | null; verification_status: string | null; confidence: number | null; role_match: string; match_state: string;
  matched_contact_id: string | null; decision: string; selected_action: string | null; commit_result: string | null; committed_contact_id: string | null;
};

const toCandidate = (r: CandidateRow): CandidateRecord => ({
  id: r.id,
  position: r.position,
  fullName: r.full_name,
  firstName: r.first_name,
  lastName: r.last_name,
  jobTitle: r.job_title,
  email: r.email,
  normalizedEmail: r.normalized_email,
  phone: r.phone,
  linkedinUrl: r.linkedin_url,
  providerSeniority: r.provider_seniority,
  providerDepartment: r.provider_department,
  providerDecisionMaker: r.provider_decision_maker,
  verificationStatus: r.verification_status as VerificationStatus | null,
  confidence: r.confidence,
  roleMatch: r.role_match as RoleMatch,
  matchState: r.match_state as ContactMatchState,
  matchedContactId: r.matched_contact_id,
  decision: r.decision as CandidateDecision,
  selectedAction: r.selected_action as SelectedAction | null,
  commitResult: r.commit_result as "created" | "merged" | null,
  committedContactId: r.committed_contact_id,
});

export async function listContactCandidates(workspaceId: string, runId: string): Promise<CandidateRecord[]> {
  const { data, error } = await (await supabase())
    .from("contact_discovery_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("contact_discovery_run_id", runId)
    .order("position", { ascending: true })
    .limit(100);
  if (error) throw new DataAccessError("listContactCandidates", error);
  return (data ?? []).map((r) => toCandidate(r as CandidateRow));
}

export async function setContactCandidateDecision(
  workspaceId: string,
  runId: string,
  candidateId: string,
  decision: CandidateDecision,
  selectedAction: SelectedAction | null,
): Promise<MutationResult<null>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("contact_discovery_candidates")
    .update({ decision, selected_action: selectedAction })
    .eq("workspace_id", workspaceId)
    .eq("contact_discovery_run_id", runId)
    .eq("id", candidateId)
    .is("commit_result", null)
    .select("id");
  if (error) return { ok: false, reason: error.code === "55000" ? "stale" : failureFromDbError("setContactCandidateDecision", error) };
  return data?.length ? { ok: true, data: null } : { ok: false, reason: "forbidden" };
}

/** Writes one selected candidate through public.commit_contact_candidate (→ ingest_lead); idempotent per candidate. */
export async function commitContactCandidate(
  workspaceId: string,
  candidateId: string,
  contact: { id?: string; fields: Record<string, unknown>; primary_if_none?: boolean },
  evidence: unknown[],
): Promise<MutationResult<{ commitResult: "created" | "merged"; contactId: string; alreadyCommitted: boolean }>> {
  await requireUser();
  const { data, error } = await (await supabase()).rpc("commit_contact_candidate", {
    p_workspace_id: workspaceId,
    p_candidate_id: candidateId,
    p_contact: contact as Json,
    p_evidence: evidence as Json,
  });
  if (error) return { ok: false, reason: error.code === "55000" ? "stale" : failureFromDbError("commitContactCandidate", error) };
  const r = data as { already_committed?: boolean; commit_result?: string; contact_id?: string } | null;
  if (!r?.contact_id || (r.commit_result !== "created" && r.commit_result !== "merged")) return { ok: false, reason: "failed" };
  return { ok: true, data: { commitResult: r.commit_result, contactId: r.contact_id, alreadyCommitted: !!r.already_committed } };
}

// -----------------------------------------------------------------------------
// Inputs re-read on the server
// -----------------------------------------------------------------------------

/** The company a search is for: name, stored domain and whether it is restricted (do not contact). */
export async function companyForContactDiscovery(
  workspaceId: string,
  companyId: string,
): Promise<{ id: string; name: string; domain: string | null; restricted: boolean } | null> {
  if (!isUuid(companyId)) return null;
  const client = await supabase();
  const { data, error } = await client
    .from("companies")
    .select("id, canonical_name, primary_domain")
    .eq("workspace_id", workspaceId)
    .eq("id", companyId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new DataAccessError("companyForContactDiscovery", error);
  if (!data) return null;
  const { data: s, error: e2 } = await client
    .from("suppression_records")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .eq("scope", "company")
    .eq("active", true)
    .limit(1);
  if (e2) throw new DataAccessError("companyForContactDiscovery.restriction", e2);
  return { id: data.id, name: data.canonical_name, domain: data.primary_domain, restricted: !!s?.length };
}

/** Active contacts anywhere in the workspace that have any of the given normalized emails. */
export async function contactsByEmails(workspaceId: string, emails: string[]): Promise<{ id: string; company_id: string; full_name: string; normalized_email: string | null }[]> {
  const unique = [...new Set(emails.filter(Boolean))];
  if (!unique.length) return [];
  const { data, error } = await (await supabase())
    .from("contacts")
    .select("id, company_id, full_name, normalized_email")
    .eq("workspace_id", workspaceId)
    .in("normalized_email", unique)
    .is("archived_at", null);
  if (error) throw new DataAccessError("contactsByEmails", error);
  return data ?? [];
}
