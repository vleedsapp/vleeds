import "server-only";

import { GRADES, SCORE_STATUSES, type Grade, type ScoreStatus } from "@/lib/lead-core/schemas";
import { DataAccessError, supabase } from "./core";
import { currentFingerprint } from "./scoring";

export type ScoreRow = {
  id: string;
  companyId: string;
  profileId: string;
  profileName: string;
  profileRevision: number | null;
  profileIsDefault: boolean;
  revision: number;
  status: ScoreStatus;
  score: number | null;
  grade: Grade | null;
  coveragePercent: number | null;
  inputFingerprint: string | null;
  scoredAt: string | null;
};

/**
 * Stored ICP score results for the given companies, joined (in code) with the
 * workspace's profiles so each result can say which profile and revision it
 * belongs to. Nothing here computes a score.
 */
export async function scoresForCompanies(workspaceId: string, companyIds: string[]): Promise<ScoreRow[]> {
  if (companyIds.length === 0) return [];
  const client = await supabase();
  const [scores, profiles] = await Promise.all([
    client
      .from("lead_scores")
      .select("id, company_id, icp_profile_id, icp_revision, score, grade, status, scored_at, coverage_percent, input_fingerprint")
      .eq("workspace_id", workspaceId)
      .in("company_id", companyIds),
    client.from("icp_profiles").select("id, name, revision, is_default, archived_at").eq("workspace_id", workspaceId),
  ]);
  if (scores.error) throw new DataAccessError("scoresForCompanies", scores.error);
  if (profiles.error) throw new DataAccessError("scoresForCompanies.profiles", profiles.error);

  const byId = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  return (scores.data ?? []).map((s) => {
    const p = byId.get(s.icp_profile_id);
    return {
      id: s.id,
      companyId: s.company_id,
      profileId: s.icp_profile_id,
      profileName: p?.name ?? "Unavailable profile",
      profileRevision: p && !p.archived_at ? p.revision : null,
      profileIsDefault: !!p && p.is_default && !p.archived_at,
      revision: s.icp_revision,
      status: (SCORE_STATUSES as readonly string[]).includes(s.status) ? (s.status as ScoreStatus) : "stale",
      score: s.score,
      grade: (GRADES as readonly string[]).includes(s.grade ?? "") ? (s.grade as Grade) : null,
      coveragePercent: s.coverage_percent,
      inputFingerprint: s.input_fingerprint,
      scoredAt: s.scored_at,
    };
  });
}

/**
 * Currentness (P1-E6): a result is current only if it is an evaluation
 * (scored or excluded) for the profile's CURRENT revision AND its input
 * fingerprint equals the fingerprint of the company's scoring inputs now.
 * The comparison is the source of truth; no mutation triggers maintain it.
 */
export async function scoreCurrentness(
  workspaceId: string,
  s: ScoreRow,
): Promise<{ current: boolean; reason: "profile" | "data" | null }> {
  if (s.profileRevision === null || s.revision !== s.profileRevision) return { current: false, reason: s.status === "pending" ? null : "profile" };
  if (s.status !== "scored" && s.status !== "excluded") return { current: false, reason: s.status === "pending" ? null : "data" };
  const now = await currentFingerprint(workspaceId, s.companyId, s.profileId);
  return now && now === s.inputFingerprint ? { current: true, reason: null } : { current: false, reason: "data" };
}
