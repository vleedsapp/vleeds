import { z } from "zod";
import { SCORING_CATEGORIES, type ScoringCategory } from "@/lib/config/icp";
import { CATEGORY_LABEL } from "./explain";
import type { ExplanationItem } from "./types";

/**
 * What the browser sends and receives for fit evaluation (P1-E6). The browser
 * sends IDS and observation choices only; score, grade, breakdown, coverage,
 * fingerprint and explanation are always computed on the server from durable
 * data (the schemas below are strict, so extra keys are rejected).
 */

export const evaluateFitSchema = z.strictObject({ companyId: z.uuid(), icpProfileId: z.uuid() });

export const signalChangeSchema = z.strictObject({
  kind: z.enum(["buying", "exclusion"]),
  signalId: z.uuid(),
  state: z.enum(["present", "absent", "unknown"]),
  note: z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(500, "Use 500 characters or fewer."))
    .nullable()
    .transform((v) => v || null),
});

export const saveSignalsSchema = z.strictObject({
  companyId: z.uuid(),
  icpProfileId: z.uuid(),
  revision: z.number().int().min(1),
  changes: z.array(signalChangeSchema).max(100),
});

export type SignalChange = z.output<typeof signalChangeSchema>;

export type FitCategoryView = {
  key: ScoringCategory;
  label: string;
  raw: number;
  configuredWeight: number;
  effectiveWeight: number;
  /** Points added to the base score (raw × effective share), one decimal. */
  points: number;
};

export type FitResultView = {
  status: "scored" | "excluded";
  revision: number;
  current: boolean;
  outdatedReason: "profile" | "data" | null;
  score: number | null;
  baseScore: number | null;
  grade: "A" | "B" | "C" | null;
  coveragePercent: number | null;
  categories: FitCategoryView[];
  penalty: number;
  exclusionReasons: string[];
  why: { label: string; items: ExplanationItem[] }[];
  exclusions: ExplanationItem[];
  missing: string[];
  scoredAt: string | null;
};

export type FitSignalView = {
  kind: "buying" | "exclusion";
  id: string;
  name: string;
  description: string | null;
  /** "Weight 30" / "If present: −20" / "If present: Excludes company". */
  effect: string;
  state: "present" | "absent" | "unknown";
  note: string | null;
};

export type FitSheetData = {
  profiles: { id: string; name: string; isDefault: boolean }[];
  profile: {
    id: string;
    name: string;
    revision: number;
    weights: { key: ScoringCategory; label: string; weight: number; configured: boolean }[];
    thresholds: { a: number; b: number } | null;
  };
  /** Set when the profile can't produce a meaningful score. */
  notEvaluable: string | null;
  signals: FitSignalView[];
  result: FitResultView | null;
};

export type FitActionResult = { ok: true; data: FitSheetData } | { ok: false; error: string; data: FitSheetData | null };

/** Stored row (DAL StoredFit) → result view. */
export function toFitResultView(
  s: {
    status: string;
    revision: number;
    score: number | null;
    grade: "A" | "B" | "C" | null;
    coveragePercent: number | null;
    breakdown: Record<string, number>;
    effectiveWeights: Record<string, { configured: number; effective: number }>;
    explanation: { base_score: number | null; categories: Record<string, ExplanationItem[]>; exclusions: ExplanationItem[]; missing: string[] } | null;
    exclusionReasons: { name: string }[];
    scoredAt: string | null;
  },
  currentness: { current: boolean; reason: "profile" | "data" | null },
): FitResultView | null {
  if (s.status !== "scored" && s.status !== "excluded" && s.status !== "stale") return null;
  const categories: FitCategoryView[] = SCORING_CATEGORIES.filter((k) => typeof s.breakdown[k] === "number" && s.effectiveWeights[k]).map((k) => {
    const w = s.effectiveWeights[k];
    return {
      key: k,
      label: CATEGORY_LABEL[k],
      raw: s.breakdown[k],
      configuredWeight: w.configured,
      effectiveWeight: w.effective,
      points: Math.round(s.breakdown[k] * w.effective) / 100,
    };
  });
  return {
    status: s.status === "excluded" ? "excluded" : "scored",
    revision: s.revision,
    current: currentness.current,
    outdatedReason: currentness.reason,
    score: s.score,
    baseScore: s.explanation?.base_score ?? null,
    grade: s.grade,
    coveragePercent: s.coveragePercent,
    categories,
    penalty: s.breakdown.exclusion_penalty ?? 0,
    exclusionReasons: s.exclusionReasons.map((r) => r.name),
    why: SCORING_CATEGORIES.filter((k) => s.explanation?.categories[k]?.length).map((k) => ({ label: CATEGORY_LABEL[k], items: s.explanation!.categories[k] })),
    exclusions: s.explanation?.exclusions ?? [],
    missing: s.explanation?.missing ?? [],
    scoredAt: s.scoredAt,
  };
}

export const NOT_EVALUABLE_MESSAGE = "This ICP does not have enough criteria configured to evaluate companies.";
