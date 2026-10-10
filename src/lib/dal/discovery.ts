import "server-only";

import { decisionMakersSchema, geographiesSchema, idealCustomerSchema, type DecisionMaker, type Geography } from "@/lib/config/icp";
import type { CandidateDecision, CandidateMatchState, RunStatus } from "@/lib/discovery/model";
import type { DiscoveryGeography } from "@/lib/providers/company-discovery/types";
import { isUuid } from "@/lib/navigation";
import type { Json } from "@/lib/supabase/database.types";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";

/**
 * Discovery runs and candidate REFERENCES (P1-E3). Only Vleeds-owned data and
 * durable provider ids are read or written here; provider display content
 * never reaches this module.
 */

export type DiscoveryIcpOption = {
  id: string;
  name: string;
  revision: number;
  isDefault: boolean;
  industries: string[];
  keywords: string[];
  geographies: Geography[];
  /** Configured decision-maker roles (P1-E5 contact discovery). */
  decisionMakers: DecisionMaker[];
};

/** Active ICP profiles of the workspace (default first), with the parts discovery uses as starting points. */
export async function listIcpProfilesForDiscovery(workspaceId: string): Promise<DiscoveryIcpOption[]> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("icp_profiles")
    .select("id, name, revision, is_default, ideal_customer, target_geographies, decision_maker_titles")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null);
  if (error) throw new DataAccessError("listIcpProfilesForDiscovery", error);
  return (data ?? [])
    .map((p) => {
      const ideal = p.ideal_customer ? idealCustomerSchema.safeParse(p.ideal_customer) : null;
      const geos = p.target_geographies ? geographiesSchema.safeParse(p.target_geographies) : null;
      const roles = p.decision_maker_titles ? decisionMakersSchema.safeParse(p.decision_maker_titles) : null;
      return {
        id: p.id,
        name: p.name,
        revision: p.revision,
        isDefault: p.is_default,
        industries: ideal?.success ? ideal.data.industries : [],
        keywords: ideal?.success ? ideal.data.keywords : [],
        geographies: geos?.success ? geos.data : [],
        decisionMakers: roles?.success ? roles.data : [],
      };
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

export type DiscoveryRunView = {
  id: string;
  providerKey: string;
  query: string;
  geography: DiscoveryGeography | null;
  icpProfileId: string | null;
  status: RunStatus;
  pageSize: number | null;
  pagesLoaded: number;
  hasMore: boolean;
  errorCode: string | null;
  candidateCount: number;
  selectedCount: number;
  dismissedCount: number;
  createdAt: string;
};

const RUN_COLUMNS =
  "id, provider_key, query, geography, icp_profile_id, status, requested_result_count, pages_loaded, has_more, error_code, candidate_count, selected_count, dismissed_count, created_at";

type RunRow = {
  id: string; provider_key: string; query: string; geography: Json | null; icp_profile_id: string | null; status: string;
  requested_result_count: number | null; pages_loaded: number; has_more: boolean; error_code: string | null;
  candidate_count: number; selected_count: number; dismissed_count: number; created_at: string;
};

function asGeography(v: Json | null): DiscoveryGeography | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const g = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x ? x : null);
  const countryCode = str(g.countryCode);
  if (!countryCode) return null;
  return { countryCode, countryName: str(g.countryName) ?? countryCode, region: str(g.region), city: str(g.city), label: str(g.label) };
}

const toRun = (r: RunRow): DiscoveryRunView => ({
  id: r.id,
  providerKey: r.provider_key,
  query: r.query,
  geography: asGeography(r.geography),
  icpProfileId: r.icp_profile_id,
  status: r.status as RunStatus,
  pageSize: r.requested_result_count,
  pagesLoaded: r.pages_loaded,
  hasMore: r.has_more,
  errorCode: r.error_code,
  candidateCount: r.candidate_count,
  selectedCount: r.selected_count,
  dismissedCount: r.dismissed_count,
  createdAt: r.created_at,
});

export async function listRecentDiscoveryRuns(workspaceId: string, limit = 10): Promise<DiscoveryRunView[]> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("discovery_runs")
    .select(RUN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new DataAccessError("listRecentDiscoveryRuns", error);
  return (data ?? []).map(toRun);
}

export async function getDiscoveryRun(workspaceId: string, runId: string): Promise<DiscoveryRunView | null> {
  if (!isUuid(runId)) return null;
  await requireUser();
  const { data, error } = await (await supabase())
    .from("discovery_runs")
    .select(RUN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new DataAccessError("getDiscoveryRun", error);
  return data ? toRun(data) : null;
}

export async function createDiscoveryRun(
  workspaceId: string,
  input: {
    providerKey: string;
    icpProfileId: string | null;
    icpRevision: number | null;
    query: string;
    geography: DiscoveryGeography | null;
    regionCode: string | null;
    pageSize: number;
  },
): Promise<MutationResult<{ id: string }>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("discovery_runs")
    .insert({
      workspace_id: workspaceId,
      provider_key: input.providerKey,
      icp_profile_id: input.icpProfileId,
      icp_revision: input.icpRevision,
      query: input.query,
      geography: input.geography as Json | null,
      region_code: input.regionCode,
      requested_result_count: input.pageSize,
      status: "running",
    })
    .select("id");
  if (error || !data?.length) return { ok: false, reason: error ? failureFromDbError("createDiscoveryRun", error) : "forbidden" };
  return { ok: true, data: { id: data[0].id } };
}

/** Moves a run between states; only succeeds from one of `from` (so double actions can't race). */
export async function updateDiscoveryRun(
  workspaceId: string,
  runId: string,
  from: RunStatus[],
  patch: { status: RunStatus; pages_loaded?: number; has_more?: boolean; error_code?: string | null; completed_at?: string; cancelled_at?: string },
): Promise<MutationResult<null>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("discovery_runs")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .in("status", from)
    .select("id");
  if (error) return { ok: false, reason: failureFromDbError("updateDiscoveryRun", error) };
  return data?.length ? { ok: true, data: null } : { ok: false, reason: "stale" };
}

/** Provider ids already linked to a company of this workspace through durable source evidence. */
export async function companiesLinkedToProviderIds(workspaceId: string, providerKey: string, externalIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!externalIds.length) return out;
  const { data, error } = await (await supabase())
    .from("lead_sources")
    .select("company_id, external_record_id")
    .eq("workspace_id", workspaceId)
    .eq("provider_key", providerKey)
    .in("external_record_id", externalIds);
  if (error) throw new DataAccessError("companiesLinkedToProviderIds", error);
  for (const r of data ?? []) if (r.company_id && r.external_record_id && !out.has(r.external_record_id)) out.set(r.external_record_id, r.company_id);
  if (!out.size) return out;
  // Only active companies count as "existing".
  const { data: active, error: e2 } = await (await supabase())
    .from("companies")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .in("id", [...new Set(out.values())]);
  if (e2) throw new DataAccessError("companiesLinkedToProviderIds.active", e2);
  const live = new Set((active ?? []).map((c) => c.id));
  for (const [k, v] of out) if (!live.has(v)) out.delete(k);
  return out;
}

/** Provider ids found by OTHER runs of this workspace. */
export async function providerIdsSeenBefore(workspaceId: string, providerKey: string, externalIds: string[], exceptRunId: string): Promise<Set<string>> {
  if (!externalIds.length) return new Set();
  const { data, error } = await (await supabase())
    .from("discovery_candidates")
    .select("external_record_id, discovery_run_id")
    .eq("workspace_id", workspaceId)
    .eq("provider_key", providerKey)
    .in("external_record_id", externalIds);
  if (error) throw new DataAccessError("providerIdsSeenBefore", error);
  return new Set((data ?? []).filter((r) => r.discovery_run_id !== exceptRunId).map((r) => r.external_record_id));
}

export type StoredCandidate = {
  id: string;
  external_record_id: string;
  match_state: CandidateMatchState | null;
  match_company_id: string | null;
  decision: CandidateDecision;
};

/**
 * Stores candidate references for a run (id + Vleeds match data only). A
 * reference the run already has is kept as is (the provider may repeat a
 * place across pages); the stored rows are returned for every id.
 */
export async function addCandidateReferences(
  workspaceId: string,
  runId: string,
  providerKey: string,
  items: { externalId: string; position: number; matchState: CandidateMatchState; matchCompanyId: string | null }[],
): Promise<MutationResult<StoredCandidate[]>> {
  await requireUser();
  const client = await supabase();
  if (items.length) {
    const { error } = await client.from("discovery_candidates").upsert(
      items.map((i) => ({
        workspace_id: workspaceId,
        discovery_run_id: runId,
        provider_key: providerKey,
        external_record_id: i.externalId,
        position: i.position,
        match_state: i.matchState,
        match_company_id: i.matchCompanyId,
      })),
      { onConflict: "discovery_run_id,provider_key,external_record_id", ignoreDuplicates: true },
    );
    if (error) return { ok: false, reason: failureFromDbError("addCandidateReferences", error) };
  }
  const { data, error } = await client
    .from("discovery_candidates")
    .select("id, external_record_id, match_state, match_company_id, decision")
    .eq("workspace_id", workspaceId)
    .eq("discovery_run_id", runId)
    .in("external_record_id", items.map((i) => i.externalId));
  if (error) return { ok: false, reason: failureFromDbError("addCandidateReferences.read", error) };
  return { ok: true, data: (data ?? []) as StoredCandidate[] };
}

export async function getCandidate(workspaceId: string, runId: string, candidateId: string): Promise<StoredCandidate | null> {
  if (!isUuid(candidateId)) return null;
  const { data, error } = await (await supabase())
    .from("discovery_candidates")
    .select("id, external_record_id, match_state, match_company_id, decision")
    .eq("workspace_id", workspaceId)
    .eq("discovery_run_id", runId)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new DataAccessError("getCandidate", error);
  return (data as StoredCandidate | null) ?? null;
}

export async function setCandidateDecision(workspaceId: string, runId: string, candidateId: string, decision: CandidateDecision): Promise<MutationResult<null>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("discovery_candidates")
    .update({ decision })
    .eq("workspace_id", workspaceId)
    .eq("discovery_run_id", runId)
    .eq("id", candidateId)
    .select("id");
  if (error) return { ok: false, reason: error.code === "55000" ? "stale" : failureFromDbError("setCandidateDecision", error) };
  return data?.length ? { ok: true, data: null } : { ok: false, reason: "forbidden" };
}
