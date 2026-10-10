"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { SCORING_CATEGORIES } from "@/lib/config/icp";
import {
  evaluateAndSaveFit,
  findWorkspace,
  getCurrentUser,
  latestFit,
  listIcpProfilesForScoring,
  scoringInputFor,
  setSignalObservation,
  signalObservations,
  type WorkspaceDetail,
} from "@/lib/dal";
import { isUuid } from "@/lib/navigation";
import { evaluateCompanyAgainstIcp } from "@/lib/scoring/evaluate";
import { CATEGORY_LABEL } from "@/lib/scoring/explain";
import {
  evaluateFitSchema,
  NOT_EVALUABLE_MESSAGE,
  saveSignalsSchema,
  toFitResultView,
  type FitActionResult,
  type FitSheetData,
} from "@/lib/scoring/view";

/**
 * Fit evaluation (P1-E6). The browser sends ids and signal choices only. The
 * server re-reads the company, contacts, evidence, observations and ICP
 * (public.scoring_input), runs the pure evaluator, and persists the result
 * through the server-only trusted writer (public.save_lead_score_trusted, P1-E7),
 * which re-checks membership, revision and fingerprint.
 * No provider is ever called; nothing changes qualification or suppression.
 */

const NOT_AVAILABLE = "This company is not available.";
const GENERIC = "The fit couldn't be evaluated. Try again.";
const SCORE_STORAGE_UNAVAILABLE = "Scores can't be saved on this server yet: the trusted score writer isn't configured.";

async function authorize(workspaceId: unknown): Promise<WorkspaceDetail | null> {
  if (typeof workspaceId !== "string" || !isUuid(workspaceId)) return null;
  if (!(await getCurrentUser())) redirect("/login");
  return findWorkspace(workspaceId);
}

const fail = (error: string, data: FitSheetData | null = null): FitActionResult => ({ ok: false, error, data });

/** Everything the evaluation sheet shows for one company × profile (no calculation is persisted here). */
async function sheetData(ws: WorkspaceDetail, companyId: string, profileId: string): Promise<FitSheetData | null> {
  const profiles = await listIcpProfilesForScoring(ws.id);
  const input = await scoringInputFor(ws.id, companyId, profileId);
  if (!input) return null;
  const model = input.icp.scoringModel;
  const preview = evaluateCompanyAgainstIcp(input); // pure, local; used only to know which categories are configured
  const configured = preview.outcome === "not_evaluable" ? [] : SCORING_CATEGORIES.filter((k) => preview.categories[k].configured);
  const observations = await signalObservations(ws.id, companyId, profileId, input.icp.revision);
  const obs = (kind: "buying" | "exclusion", id: string) => observations.find((o) => o.kind === kind && o.signalId === id);

  const stored = await latestFit(ws.id, companyId, profileId);
  const current = !!stored && stored.revision === input.icp.revision && stored.inputFingerprint === input.fingerprint && (stored.status === "scored" || stored.status === "excluded");
  const reason = !stored || current ? null : stored.revision !== input.icp.revision ? "profile" : "data";

  return {
    profiles: profiles.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault })),
    profile: {
      id: input.icp.id,
      name: profiles.find((p) => p.id === profileId)?.name ?? "Profile",
      revision: input.icp.revision,
      weights: SCORING_CATEGORIES.map((k) => ({ key: k, label: CATEGORY_LABEL[k], weight: model?.categoryWeights[k] ?? 0, configured: configured.includes(k) })),
      thresholds: model?.thresholds ?? null,
    },
    notEvaluable: preview.outcome === "not_evaluable" ? NOT_EVALUABLE_MESSAGE : null,
    signals: [
      ...(input.icp.buyingSignals ?? []).filter((s) => s.enabled).map((s) => ({
        kind: "buying" as const, id: s.id, name: s.name, description: s.description, effect: `Weight ${s.weight}`,
        state: obs("buying", s.id)?.state ?? ("unknown" as const), note: obs("buying", s.id)?.note ?? null,
      })),
      ...(input.icp.exclusionSignals ?? []).filter((s) => s.enabled).map((s) => ({
        kind: "exclusion" as const, id: s.id, name: s.name, description: s.description,
        effect: s.behavior === "hard_exclude" ? "If present: Excludes company" : `If present: −${s.penalty ?? 0}`,
        state: obs("exclusion", s.id)?.state ?? ("unknown" as const), note: obs("exclusion", s.id)?.note ?? null,
      })),
    ],
    result: stored ? toFitResultView(stored, { current, reason }) : null,
  };
}

async function resolveProfile(ws: WorkspaceDetail, requested: unknown): Promise<string | null> {
  const profiles = await listIcpProfilesForScoring(ws.id);
  if (typeof requested === "string" && profiles.some((p) => p.id === requested)) return requested;
  return (profiles.find((p) => p.isDefault) ?? profiles[0] ?? null)?.id ?? null;
}

/** Opens the evaluation sheet: the chosen (or default) profile, its signals with this company's observations, the latest result. */
export async function loadFitEvaluation(workspaceId: string, companyId: string, icpProfileId: unknown): Promise<FitActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws || typeof companyId !== "string" || !isUuid(companyId)) return fail(NOT_AVAILABLE);
  const profileId = await resolveProfile(ws, icpProfileId);
  if (!profileId) return fail("Set up an ideal customer profile in Settings to evaluate fit.");
  const data = await sheetData(ws, companyId, profileId);
  return data ? { ok: true, data } : fail(NOT_AVAILABLE);
}

/** Records present / not present / unknown for configured signals (validated against the profile's current revision). */
export async function saveSignalObservations(workspaceId: string, input: unknown): Promise<FitActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail(NOT_AVAILABLE);
  const parsed = saveSignalsSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the signals and try again.");
  const req = parsed.data;
  const scoring = await scoringInputFor(ws.id, req.companyId, req.icpProfileId);
  if (!scoring) return fail(NOT_AVAILABLE);
  if (scoring.icp.revision !== req.revision) return fail("The profile changed since this sheet was opened. Close it and try again.", await sheetData(ws, req.companyId, req.icpProfileId));
  const known = new Set([
    ...(scoring.icp.buyingSignals ?? []).filter((s) => s.enabled).map((s) => `buying:${s.id}`),
    ...(scoring.icp.exclusionSignals ?? []).filter((s) => s.enabled).map((s) => `exclusion:${s.id}`),
  ]);
  if (req.changes.some((c) => !known.has(`${c.kind}:${c.signalId}`))) return fail("A signal isn't part of this profile.", await sheetData(ws, req.companyId, req.icpProfileId));
  for (const c of req.changes) {
    const r = await setSignalObservation(ws.id, req.companyId, req.icpProfileId, req.revision, c);
    if (!r.ok) return fail(r.reason === "stale" ? "The profile changed since this sheet was opened. Close it and try again." : "The signals couldn't be saved. Try again.", await sheetData(ws, req.companyId, req.icpProfileId));
  }
  refresh();
  const data = await sheetData(ws, req.companyId, req.icpProfileId);
  return data ? { ok: true, data } : fail(NOT_AVAILABLE);
}

/** Evaluates fit and stores the result. Inputs are re-read on the server; nothing computed by the browser is accepted. */
export async function evaluateCompanyFit(workspaceId: string, input: unknown): Promise<FitActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail(NOT_AVAILABLE);
  const parsed = evaluateFitSchema.safeParse(input);
  if (!parsed.success) return fail(NOT_AVAILABLE);
  const { companyId, icpProfileId } = parsed.data;
  const saved = await evaluateAndSaveFit(ws.id, companyId, icpProfileId);
  if (!saved.ok) {
    if (saved.reason === "unavailable") return fail(NOT_AVAILABLE);
    const message =
      saved.reason === "not_evaluable"
        ? NOT_EVALUABLE_MESSAGE
        : saved.reason === "stale"
          ? "The company or profile changed while evaluating. Evaluate again."
          : saved.reason === "not_configured"
            ? SCORE_STORAGE_UNAVAILABLE
            : GENERIC;
    return fail(message, await sheetData(ws, companyId, icpProfileId));
  }
  refresh();
  const data = await sheetData(ws, companyId, icpProfileId);
  return data ? { ok: true, data } : fail(GENERIC);
}
