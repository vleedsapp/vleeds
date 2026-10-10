import "server-only";

import { GRADES, type Grade } from "@/lib/lead-core/schemas";
import { isUuid } from "@/lib/navigation";
import type { ScoreRecord } from "@/lib/scoring/explain";
import { evaluateCompanyAgainstIcp } from "@/lib/scoring/evaluate";
import { toScoreRecord } from "@/lib/scoring/explain";
import { parseScoringInput } from "@/lib/scoring/input";
import type { ExplanationItem, ScoringInput } from "@/lib/scoring/types";
import type { Json } from "@/lib/supabase/database.types";
import { persistLeadScore, type TrustedWriteFailure } from "@/lib/supabase/trusted-score-writer";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";
import { listIcpProfilesForDiscovery } from "./discovery";

/**
 * ICP evaluation data access (P1-E6). The scoring INPUT is assembled by the
 * database (public.scoring_input: canonical document + SHA-256 fingerprint);
 * scores are written only through the trusted writer (public.save_lead_score_trusted,
 * P1-E7), which re-checks membership, revision and fingerprint. Nothing here
 * calculates a score.
 */

/** The canonical scoring input for a company × profile, or null if either isn't available. */
export async function scoringInputFor(workspaceId: string, companyId: string, profileId: string): Promise<ScoringInput | null> {
  if (!isUuid(companyId) || !isUuid(profileId)) return null;
  await requireUser();
  const { data, error } = await (await supabase()).rpc("scoring_input", { p_workspace_id: workspaceId, p_company_id: companyId, p_icp_profile_id: profileId });
  if (error) throw new DataAccessError("scoringInputFor", error);
  return data ? parseScoringInput(data) : null;
}

/**
 * Persists an evaluation (server-computed) through the trusted score writer
 * (P1-E7). The acting user comes from the verified session, never from the
 * browser. Fails with "stale" if the profile or inputs changed meanwhile, and
 * "not_configured" if this server has no trusted writer key.
 */
export async function saveLeadScore(
  workspaceId: string,
  companyId: string,
  profileId: string,
  revision: number,
  r: ScoreRecord,
): Promise<{ ok: true; data: { id: string } } | { ok: false; reason: TrustedWriteFailure }> {
  const user = await requireUser();
  const saved = await persistLeadScore(user.id, { workspaceId, companyId, profileId, revision }, r);
  return saved.ok ? { ok: true, data: { id: saved.id } } : saved;
}

// -----------------------------------------------------------------------------
// Stored results
// -----------------------------------------------------------------------------

export type StoredFit = {
  id: string;
  revision: number;
  status: "pending" | "scored" | "stale" | "excluded";
  score: number | null;
  grade: Grade | null;
  coveragePercent: number | null;
  breakdown: Record<string, number>;
  effectiveWeights: Record<string, { configured: number; effective: number }>;
  explanation: { base_score: number | null; categories: Record<string, ExplanationItem[]>; exclusions: ExplanationItem[]; missing: string[] } | null;
  exclusionReasons: { id: string; name: string }[];
  inputFingerprint: string | null;
  scoredAt: string | null;
};

const obj = (v: Json | null): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const items = (v: unknown): ExplanationItem[] =>
  Array.isArray(v)
    ? v.flatMap((i) => {
        const o = i as Record<string, unknown>;
        return typeof o?.detail === "string" && typeof o?.criterion === "string" && typeof o?.result === "string"
          ? [{ criterion: o.criterion, result: o.result as ExplanationItem["result"], detail: o.detail }]
          : [];
      })
    : [];

/** The newest stored result of a company for a profile (any revision), or null. */
export async function latestFit(workspaceId: string, companyId: string, profileId: string): Promise<StoredFit | null> {
  const { data, error } = await (await supabase())
    .from("lead_scores")
    .select("id, icp_revision, status, score, grade, coverage_percent, breakdown, effective_weights, explanation, exclusion_reasons, input_fingerprint, scored_at")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .eq("icp_profile_id", profileId)
    .order("icp_revision", { ascending: false })
    .limit(1);
  if (error) throw new DataAccessError("latestFit", error);
  const s = data?.[0];
  if (!s) return null;
  const e = obj(s.explanation);
  const breakdown = Object.fromEntries(Object.entries(obj(s.breakdown)).filter(([, v]) => typeof v === "number")) as Record<string, number>;
  const weights = Object.fromEntries(
    Object.entries(obj(s.effective_weights)).flatMap(([k, v]) => {
      const w = v as { configured?: unknown; effective?: unknown };
      return typeof w?.configured === "number" && typeof w?.effective === "number" ? [[k, { configured: w.configured, effective: w.effective }]] : [];
    }),
  );
  return {
    id: s.id,
    revision: s.icp_revision,
    status: (["pending", "scored", "stale", "excluded"].includes(s.status) ? s.status : "stale") as StoredFit["status"],
    score: s.score,
    grade: (GRADES as readonly string[]).includes(s.grade ?? "") ? (s.grade as Grade) : null,
    coveragePercent: s.coverage_percent,
    breakdown,
    effectiveWeights: weights,
    explanation: s.explanation
      ? {
          base_score: typeof e.base_score === "number" ? e.base_score : null,
          categories: Object.fromEntries(Object.entries(obj(e.categories as Json)).map(([k, v]) => [k, items(v)])),
          exclusions: items(e.exclusions),
          missing: Array.isArray(e.missing) ? e.missing.map(String) : [],
        }
      : null,
    exclusionReasons: Array.isArray(s.exclusion_reasons)
      ? s.exclusion_reasons.flatMap((r) => {
          const o = r as { id?: unknown; name?: unknown };
          return typeof o?.name === "string" ? [{ id: String(o.id ?? ""), name: o.name }] : [];
        })
      : [],
    inputFingerprint: s.input_fingerprint,
    scoredAt: s.scored_at,
  };
}

/** Current fingerprint of a company's scoring inputs for a profile (null if unavailable). */
export async function currentFingerprint(workspaceId: string, companyId: string, profileId: string): Promise<string | null> {
  const { data, error } = await (await supabase()).rpc("scoring_input", { p_workspace_id: workspaceId, p_company_id: companyId, p_icp_profile_id: profileId });
  if (error) throw new DataAccessError("currentFingerprint", error);
  const fp = (data as { fingerprint?: unknown } | null)?.fingerprint;
  return typeof fp === "string" ? fp : null;
}

// -----------------------------------------------------------------------------
// Signal observations
// -----------------------------------------------------------------------------

export type SignalObservation = { kind: "buying" | "exclusion"; signalId: string; state: "present" | "absent"; note: string | null };

export async function signalObservations(workspaceId: string, companyId: string, profileId: string, revision: number): Promise<SignalObservation[]> {
  const { data, error } = await (await supabase())
    .from("company_signal_observations")
    .select("signal_kind, signal_id, state, note")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .eq("icp_profile_id", profileId)
    .eq("icp_revision", revision);
  if (error) throw new DataAccessError("signalObservations", error);
  return (data ?? []).map((o) => ({ kind: o.signal_kind as SignalObservation["kind"], signalId: o.signal_id, state: o.state as SignalObservation["state"], note: o.note }));
}

/** Records present/absent (upsert) or clears the observation (unknown). The database validates the signal against the profile. */
export async function setSignalObservation(
  workspaceId: string,
  companyId: string,
  profileId: string,
  revision: number,
  o: { kind: "buying" | "exclusion"; signalId: string; state: "present" | "absent" | "unknown"; note: string | null },
): Promise<MutationResult<null>> {
  await requireUser();
  const client = await supabase();
  if (o.state === "unknown") {
    const { error } = await client
      .from("company_signal_observations")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId)
      .eq("icp_profile_id", profileId)
      .eq("icp_revision", revision)
      .eq("signal_kind", o.kind)
      .eq("signal_id", o.signalId);
    if (error) return { ok: false, reason: failureFromDbError("clearSignalObservation", error) };
    return { ok: true, data: null };
  }
  // Update the existing observation (only state/note are updatable), else insert one.
  const { data: updated, error: updateError } = await client
    .from("company_signal_observations")
    .update({ state: o.state, note: o.note })
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .eq("icp_profile_id", profileId)
    .eq("icp_revision", revision)
    .eq("signal_kind", o.kind)
    .eq("signal_id", o.signalId)
    .select("id");
  if (updateError) return { ok: false, reason: updateError.code === "55000" ? "stale" : failureFromDbError("setSignalObservation.update", updateError) };
  if (updated?.length) return { ok: true, data: null };
  const { error } = await client.from("company_signal_observations").insert({
    workspace_id: workspaceId,
    company_id: companyId,
    icp_profile_id: profileId,
    icp_revision: revision,
    signal_kind: o.kind,
    signal_id: o.signalId,
    state: o.state,
    note: o.note,
  });
  if (error) return { ok: false, reason: error.code === "55000" ? "stale" : failureFromDbError("setSignalObservation", error) };
  return { ok: true, data: null };
}

/** Active ICP profiles a company can be evaluated against (default first). */
export async function listIcpProfilesForScoring(workspaceId: string): Promise<{ id: string; name: string; isDefault: boolean; revision: number }[]> {
  const profiles = await listIcpProfilesForDiscovery(workspaceId);
  return profiles.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault, revision: p.revision }));
}

// -----------------------------------------------------------------------------
// Evaluate + persist (single company and the explicit batch refresh)
// -----------------------------------------------------------------------------

export type EvaluateOutcome =
  | { ok: true; outcome: "scored" | "excluded"; grade: Grade | null }
  | { ok: false; reason: "unavailable" | "not_evaluable" | TrustedWriteFailure };

/**
 * Reads the canonical scoring input, runs the pure P1-E6 evaluator and saves
 * the result through the trusted writer. Used by "Evaluate fit" and by
 * "Refresh lead scores"; there is no other scoring path.
 */
export async function evaluateAndSaveFit(workspaceId: string, companyId: string, profileId: string): Promise<EvaluateOutcome> {
  const scoring = await scoringInputFor(workspaceId, companyId, profileId);
  if (!scoring) return { ok: false, reason: "unavailable" };
  const evaluation = evaluateCompanyAgainstIcp(scoring);
  if (evaluation.outcome === "not_evaluable") return { ok: false, reason: "not_evaluable" };
  const record = toScoreRecord(evaluation);
  const saved = await saveLeadScore(workspaceId, companyId, profileId, scoring.icp.revision, record);
  if (!saved.ok) return saved;
  return { ok: true, outcome: record.status, grade: (record.grade as Grade | null) ?? null };
}

/**
 * Active companies whose default-ICP result is missing or outdated, for the
 * explicit "Refresh lead scores" batch: unscored first, then outdated; plus
 * how many need evaluation in total. Bounded by `limit`.
 */
export async function companiesNeedingEvaluation(workspaceId: string, limit: number): Promise<{ ids: string[]; total: number }> {
  await requireUser();
  const client = await supabase();
  const page = async (state: "none" | "outdated") => {
    const { data, error } = await client.rpc("list_companies", { p_workspace_id: workspaceId, p_grade: state, p_sort: "name", p_limit: Math.min(limit, 100), p_offset: 0 });
    if (error) throw new DataAccessError("companiesNeedingEvaluation", error);
    return { ids: (data ?? []).map((r) => r.id), total: Number(data?.[0]?.total_count ?? 0) };
  };
  const [none, outdated] = await Promise.all([page("none"), page("outdated")]);
  return { ids: [...none.ids, ...outdated.ids].slice(0, limit), total: none.total + outdated.total };
}
