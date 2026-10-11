import "server-only";

import type { EnrichmentDecision, EnrichmentInputKind, EnrichmentMatchState, EnrichmentRunStatus } from "@/lib/enrichment/model";
import type { IngestCall } from "@/lib/imports/commit";
import type { NormalizedCompany } from "@/lib/imports/rows";
import type { KnownCompany } from "@/lib/lead-core/dedupe";
import { locationSchema } from "@/lib/lead-core/schemas";
import { isUuid } from "@/lib/navigation";
import type { Json } from "@/lib/supabase/database.types";
import { companiesForMatching } from "./companies";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";

/**
 * Company enrichment runs and their single durable result (P1-E4). Only
 * Vleeds-owned data and normalized durable provider fields are read or
 * written here; transient discovery content never reaches this module.
 */

export type EnrichmentRunRecord = {
  id: string;
  providerKey: string;
  inputKind: EnrichmentInputKind;
  discoveryCandidateId: string | null;
  targetCompanyId: string | null;
  manualCompanyName: string | null;
  requestedDomain: string | null;
  status: EnrichmentRunStatus;
  errorCode: string | null;
  matchState: EnrichmentMatchState | null;
  matchReason: string | null;
  matchedCompanyId: string | null;
  decision: EnrichmentDecision | null;
  committedCompanyId: string | null;
  commitResult: "created" | "merged" | "skipped" | "failed" | null;
  commitNotes: string[];
  createdAt: string;
};

const RUN_COLUMNS =
  "id, provider_key, input_kind, discovery_candidate_id, target_company_id, manual_company_name, requested_domain, status, error_code, match_state, match_reason, matched_company_id, decision, committed_company_id, commit_result, commit_notes, created_at";

type RunRow = {
  id: string; provider_key: string; input_kind: string; discovery_candidate_id: string | null; target_company_id: string | null;
  manual_company_name: string | null; requested_domain: string | null; status: string; error_code: string | null; match_state: string | null;
  match_reason: string | null; matched_company_id: string | null; decision: string | null; committed_company_id: string | null;
  commit_result: string | null; commit_notes: Json | null; created_at: string;
};

const toRun = (r: RunRow): EnrichmentRunRecord => ({
  id: r.id,
  providerKey: r.provider_key,
  inputKind: r.input_kind as EnrichmentInputKind,
  discoveryCandidateId: r.discovery_candidate_id,
  targetCompanyId: r.target_company_id,
  manualCompanyName: r.manual_company_name,
  requestedDomain: r.requested_domain,
  status: r.status as EnrichmentRunStatus,
  errorCode: r.error_code,
  matchState: r.match_state as EnrichmentMatchState | null,
  matchReason: r.match_reason,
  matchedCompanyId: r.matched_company_id,
  decision: r.decision as EnrichmentDecision | null,
  committedCompanyId: r.committed_company_id,
  commitResult: r.commit_result as EnrichmentRunRecord["commitResult"],
  commitNotes: Array.isArray(r.commit_notes) ? r.commit_notes.map(String) : [],
  createdAt: r.created_at,
});

export async function getEnrichmentRun(workspaceId: string, runId: string): Promise<EnrichmentRunRecord | null> {
  if (!isUuid(runId)) return null;
  await requireUser();
  const { data, error } = await (await supabase())
    .from("company_enrichment_runs")
    .select(RUN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new DataAccessError("getEnrichmentRun", error);
  return data ? toRun(data) : null;
}

/** The OPEN run of a discovery reference, if any (at most one exists: unique index, P1-E5). */
export async function openEnrichmentRunForCandidate(workspaceId: string, candidateId: string): Promise<EnrichmentRunRecord | null> {
  const { data, error } = await (await supabase())
    .from("company_enrichment_runs")
    .select(RUN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("discovery_candidate_id", candidateId)
    .in("status", ["draft", "resolving_domain", "domain_review", "enriching", "review", "processing", "failed"])
    .limit(1);
  if (error) throw new DataAccessError("openEnrichmentRunForCandidate", error);
  return data?.[0] ? toRun(data[0]) : null;
}

export async function createEnrichmentRun(
  workspaceId: string,
  input: {
    providerKey: string;
    inputKind: EnrichmentInputKind;
    discoveryCandidateId: string | null;
    targetCompanyId: string | null;
    manualCompanyName: string | null;
    requestedDomain: string | null;
    status: EnrichmentRunStatus;
  },
): Promise<MutationResult<{ id: string }>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("company_enrichment_runs")
    .insert({
      workspace_id: workspaceId,
      provider_key: input.providerKey,
      input_kind: input.inputKind,
      discovery_candidate_id: input.discoveryCandidateId,
      target_company_id: input.targetCompanyId,
      manual_company_name: input.manualCompanyName,
      requested_domain: input.requestedDomain,
      status: input.status,
    })
    .select("id");
  if (error || !data?.length) return { ok: false, reason: error ? failureFromDbError("createEnrichmentRun", error) : "forbidden" };
  return { ok: true, data: { id: data[0].id } };
}

export type EnrichmentRunPatch = {
  status: EnrichmentRunStatus;
  requested_domain?: string | null;
  resolved_domain?: string | null;
  error_code?: string | null;
  match_state?: EnrichmentMatchState | null;
  match_reason?: string | null;
  matched_company_id?: string | null;
  decision?: EnrichmentDecision | null;
  commit_result?: "skipped" | "failed" | null;
  commit_notes?: string[] | null;
  completed_at?: string;
  cancelled_at?: string;
};

/** Moves a run between states; only succeeds from one of `from` (double actions can't race). */
export async function updateEnrichmentRun(workspaceId: string, runId: string, from: EnrichmentRunStatus[], patch: EnrichmentRunPatch): Promise<MutationResult<null>> {
  await requireUser();
  const { commit_notes, ...rest } = patch;
  const { data, error } = await (await supabase())
    .from("company_enrichment_runs")
    .update({ ...rest, ...(commit_notes !== undefined ? { commit_notes: commit_notes as Json } : {}) })
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .in("status", from)
    .select("id");
  if (error) return { ok: false, reason: error.code === "55000" ? "stale" : failureFromDbError("updateEnrichmentRun", error) };
  return data?.length ? { ok: true, data: null } : { ok: false, reason: "stale" };
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export type StoredEnrichmentResult = {
  externalRecordId: string | null;
  company: NormalizedCompany;
  tags: string[];
  matchState: EnrichmentMatchState;
  matchedCompanyId: string | null;
};

/** Records the run's one durable result (normalized values only). */
export async function insertEnrichmentResult(
  workspaceId: string,
  runId: string,
  providerKey: string,
  r: StoredEnrichmentResult,
): Promise<MutationResult<null>> {
  await requireUser();
  const c = r.company;
  const { error } = await (await supabase()).from("company_enrichment_results").insert({
    workspace_id: workspaceId,
    enrichment_run_id: runId,
    provider_key: providerKey,
    external_record_id: r.externalRecordId,
    canonical_name: c.canonicalName,
    primary_domain: c.primaryDomain!,
    website_url: c.websiteUrl,
    primary_phone: c.primaryPhone,
    location: c.location as Json | null,
    employee_count_min: c.employeeCountMin,
    employee_count_max: c.employeeCountMax,
    industry: c.industry ?? null,
    description: c.description ?? null,
    tags: r.tags.length ? (r.tags as Json) : null,
    match_state: r.matchState,
    matched_company_id: r.matchedCompanyId,
  });
  if (error) return { ok: false, reason: failureFromDbError("insertEnrichmentResult", error) };
  return { ok: true, data: null };
}

export type EnrichmentResultRecord = {
  externalRecordId: string | null;
  canonicalName: string;
  primaryDomain: string;
  websiteUrl: string | null;
  primaryPhone: string | null;
  location: Json | null;
  employeeCountMin: number | null;
  employeeCountMax: number | null;
  industry: string | null;
  description: string | null;
  tags: string[];
  matchState: EnrichmentMatchState;
  matchedCompanyId: string | null;
};

export async function getEnrichmentResult(workspaceId: string, runId: string): Promise<EnrichmentResultRecord | null> {
  const { data, error } = await (await supabase())
    .from("company_enrichment_results")
    .select("external_record_id, canonical_name, primary_domain, website_url, primary_phone, location, employee_count_min, employee_count_max, industry, description, tags, match_state, matched_company_id")
    .eq("workspace_id", workspaceId)
    .eq("enrichment_run_id", runId)
    .maybeSingle();
  if (error) throw new DataAccessError("getEnrichmentResult", error);
  if (!data) return null;
  return {
    externalRecordId: data.external_record_id,
    canonicalName: data.canonical_name,
    primaryDomain: data.primary_domain,
    websiteUrl: data.website_url,
    primaryPhone: data.primary_phone,
    location: data.location,
    employeeCountMin: data.employee_count_min,
    employeeCountMax: data.employee_count_max,
    industry: data.industry,
    description: data.description,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    matchState: data.match_state as EnrichmentMatchState,
    matchedCompanyId: data.matched_company_id,
  };
}

/** A stored result back as lead-core input (location re-validated). */
export function resultLocation(v: Json | null) {
  if (!v) return null;
  const parsed = locationSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

// -----------------------------------------------------------------------------
// Matching inputs
// -----------------------------------------------------------------------------

/**
 * Active companies that could be the incoming one, with their provider
 * identities: the usual domain/phone/name candidates PLUS companies linked to
 * any of the given provider identities through lead_sources. Workspace-local.
 */
export async function companiesForEnrichmentMatching(
  workspaceId: string,
  company: NormalizedCompany,
  identities: { providerKey: string; externalRecordId: string }[],
): Promise<KnownCompany[]> {
  const known = await companiesForMatching(workspaceId, {
    domains: [company.primaryDomain ?? ""],
    phones: [company.primaryPhoneNormalized ?? ""],
    names: [company.normalizedName],
  });
  const client = await supabase();
  const byId = new Map(known.map((k) => [k.id, k]));
  for (const ident of identities) {
    const { data, error } = await client
      .from("lead_sources")
      .select("company_id")
      .eq("workspace_id", workspaceId)
      .eq("provider_key", ident.providerKey)
      .eq("external_record_id", ident.externalRecordId)
      .limit(20);
    if (error) throw new DataAccessError("companiesForEnrichmentMatching", error);
    const ids = [...new Set((data ?? []).map((r) => r.company_id).filter((x): x is string => !!x))];
    if (!ids.length) continue;
    const { data: active, error: e2 } = await client
      .from("companies")
      .select("id, primary_domain, primary_phone_normalized, normalized_name, location")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .in("id", ids);
    if (e2) throw new DataAccessError("companiesForEnrichmentMatching.active", e2);
    for (const c of active ?? []) {
      const existing = byId.get(c.id);
      const external = { providerKey: ident.providerKey, externalRecordId: ident.externalRecordId };
      if (existing) existing.externalIds.push(external);
      else {
        const loc = resultLocation(c.location);
        byId.set(c.id, {
          id: c.id,
          primaryDomain: c.primary_domain,
          primaryPhoneNormalized: c.primary_phone_normalized,
          normalizedName: c.normalized_name,
          location: loc ? { countryCode: loc.countryCode, region: loc.region, city: loc.city } : null,
          externalIds: [external],
        });
      }
    }
  }
  return [...byId.values()];
}

/** An active company of this workspace that already uses `domain` (other than `exceptId`). */
export async function companyWithDomain(workspaceId: string, domain: string, exceptId: string | null): Promise<{ id: string; name: string } | null> {
  const { data, error } = await (await supabase())
    .from("companies")
    .select("id, canonical_name")
    .eq("workspace_id", workspaceId)
    .eq("primary_domain", domain)
    .is("archived_at", null)
    .limit(2);
  if (error) throw new DataAccessError("companyWithDomain", error);
  const hit = (data ?? []).find((c) => c.id !== exceptId);
  return hit ? { id: hit.id, name: hit.canonical_name } : null;
}

/** The discovery reference an enrichment may start from (this workspace, this run). Durable fields only. */
export async function discoveryReference(
  workspaceId: string,
  discoveryRunId: string,
  candidateId: string,
): Promise<{ id: string; providerKey: string; externalRecordId: string; decision: string; matchCompanyId: string | null } | null> {
  const { data, error } = await (await supabase())
    .from("discovery_candidates")
    .select("id, provider_key, external_record_id, decision, match_company_id")
    .eq("workspace_id", workspaceId)
    .eq("discovery_run_id", discoveryRunId)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new DataAccessError("discoveryReference", error);
  return data
    ? { id: data.id, providerKey: data.provider_key, externalRecordId: data.external_record_id, decision: data.decision, matchCompanyId: data.match_company_id }
    : null;
}

export async function discoveryReferenceById(workspaceId: string, candidateId: string) {
  const { data, error } = await (await supabase())
    .from("discovery_candidates")
    .select("id, provider_key, external_record_id")
    .eq("workspace_id", workspaceId)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new DataAccessError("discoveryReferenceById", error);
  return data ? { id: data.id, providerKey: data.provider_key, externalRecordId: data.external_record_id } : null;
}

/**
 * References selected in earlier searches that still wait for company data
 * (decision needs_enrichment), newest first, with the search they came from.
 * Durable fields only: there are no provider names to show.
 */
export async function waitingReferences(workspaceId: string, limit = 10): Promise<{ id: string; runId: string; query: string; providerKey: string; decidedAt: string | null }[]> {
  await requireUser();
  const client = await supabase();
  const { data, error } = await client
    .from("discovery_candidates")
    .select("id, discovery_run_id, provider_key, decided_at")
    .eq("workspace_id", workspaceId)
    .eq("decision", "needs_enrichment")
    .order("decided_at", { ascending: false })
    .limit(limit);
  if (error) throw new DataAccessError("waitingReferences", error);
  const rows = data ?? [];
  if (!rows.length) return [];
  const { data: runs, error: e2 } = await client
    .from("discovery_runs")
    .select("id, query")
    .eq("workspace_id", workspaceId)
    .in("id", [...new Set(rows.map((r) => r.discovery_run_id))]);
  if (e2) throw new DataAccessError("waitingReferences.runs", e2);
  const query = new Map((runs ?? []).map((r) => [r.id, r.query]));
  return rows.map((r) => ({ id: r.id, runId: r.discovery_run_id, query: query.get(r.discovery_run_id) ?? "", providerKey: r.provider_key, decidedAt: r.decided_at }));
}

// -----------------------------------------------------------------------------
// Commit
// -----------------------------------------------------------------------------

export type EnrichmentCommitOutcome = { commitResult: "created" | "merged"; companyId: string; identityLinked: boolean; alreadyCommitted: boolean };

/** Writes the planned company + evidence through public.ingest_lead (one transaction, idempotent per run). */
export async function commitEnrichment(
  workspaceId: string,
  runId: string,
  call: IngestCall,
  notes: string[],
): Promise<MutationResult<EnrichmentCommitOutcome>> {
  await requireUser();
  const { data, error } = await (await supabase()).rpc("ingest_lead", {
    p_workspace_id: workspaceId,
    p_company: call.company as Json,
    p_evidence: call.evidence as Json,
    p_enrichment_run_id: runId,
    p_notes: notes as Json,
  });
  if (error) return { ok: false, reason: error.code === "55000" ? "stale" : failureFromDbError("commitEnrichment", error) };
  const r = data as { already_committed?: boolean; commit_result?: string; company_id?: string; identity_linked?: boolean } | null;
  if (!r?.company_id || (r.commit_result !== "created" && r.commit_result !== "merged")) return { ok: false, reason: "failed" };
  return { ok: true, data: { commitResult: r.commit_result, companyId: r.company_id, identityLinked: !!r.identity_linked, alreadyCommitted: !!r.already_committed } };
}
