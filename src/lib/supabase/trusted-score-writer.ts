import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { ScoreRecord } from "@/lib/scoring/explain";
import type { Database, Json } from "@/lib/supabase/database.types";

/**
 * The ONLY use of SUPABASE_SERVICE_ROLE_KEY in Vleeds (P1-E7).
 *
 * Score persistence is not executable by the normal authenticated API role,
 * so a workspace member can't submit fabricated score values. Server actions
 * authenticate the user, re-read the inputs, run the pure P1-E6 evaluator and
 * then call this writer, which executes exactly one function
 * (public.save_lead_score_trusted). That function still checks that the
 * acting user is a member, and that the revision, fingerprint, outcome and
 * grade are consistent with the database's current state.
 *
 * The client is private to this module and is never returned. The key is read
 * from the server environment only (never NEXT_PUBLIC_), and it is never
 * logged: failures are reported by error code only.
 */

let client: ReturnType<typeof createClient<Database>> | null = null;

function serviceRoleKey(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return key && key.length >= 20 ? key : null;
}

/** Whether this server can persist scores (the trusted key is configured). */
export function trustedScoreWriterConfigured(): boolean {
  return serviceRoleKey() !== null;
}

function writer() {
  const key = serviceRoleKey();
  if (!key) return null;
  // A publishable key here would silently fail every write; refuse it.
  if (key.startsWith("sb_publishable_")) return null;
  client ??= createClient<Database>(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

export type TrustedWriteFailure = "not_configured" | "forbidden" | "stale" | "invalid" | "failed";

/**
 * Persists a server-computed evaluation for `actorUserId` (taken from the
 * authenticated session by the caller, never from browser input).
 */
export async function persistLeadScore(
  actorUserId: string,
  target: { workspaceId: string; companyId: string; profileId: string; revision: number },
  r: ScoreRecord,
): Promise<{ ok: true; id: string } | { ok: false; reason: TrustedWriteFailure }> {
  const db = writer();
  if (!db) return { ok: false, reason: "not_configured" };
  const { data, error } = await db.rpc("save_lead_score_trusted", {
    p_actor_user_id: actorUserId,
    p_workspace_id: target.workspaceId,
    p_company_id: target.companyId,
    p_icp_profile_id: target.profileId,
    p_icp_revision: target.revision,
    p_input_fingerprint: r.inputFingerprint,
    p_status: r.status,
    p_score: r.score,
    p_grade: r.grade,
    p_breakdown: r.breakdown as Json,
    p_coverage_percent: r.coveragePercent,
    p_explanation: r.explanation as unknown as Json,
    p_effective_weights: r.effectiveWeights as unknown as Json,
    p_exclusion_reasons: r.exclusionReasons as unknown as Json,
  });
  if (error) {
    if (error.code === "55000") return { ok: false, reason: "stale" };
    if (error.code === "42501") return { ok: false, reason: "forbidden" };
    if (error.code === "23514" || error.code === "22023") return { ok: false, reason: "invalid" };
    console.error("persistLeadScore failed", { code: error.code ?? "unknown" });
    return { ok: false, reason: "failed" };
  }
  return typeof data === "string" ? { ok: true, id: data } : { ok: false, reason: "failed" };
}
