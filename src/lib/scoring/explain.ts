import { SCORING_CATEGORIES } from "@/lib/config/icp";
import type { Evaluation, ExplanationItem } from "./types";

/**
 * The bounded, persisted form of an evaluation (lead_scores columns). Short
 * deterministic sentences only (no HTML, no AI prose); item counts and
 * lengths are capped so rows stay small.
 */

type Scored = Extract<Evaluation, { outcome: "scored" | "excluded" }>;

const MAX_ITEMS = 20;
const MAX_DETAIL = 200;
const clip = (items: ExplanationItem[]) =>
  items.slice(0, MAX_ITEMS).map((i) => ({ criterion: i.criterion.slice(0, 60), result: i.result, detail: i.detail.length > MAX_DETAIL ? `${i.detail.slice(0, MAX_DETAIL - 1)}…` : i.detail }));

export const CATEGORY_LABEL = {
  company_fit: "Company fit",
  geography_fit: "Geography",
  decision_maker_fit: "Decision makers",
  buying_signal_fit: "Buying signals",
} as const;

export type ScoreRecord = {
  status: "scored" | "excluded";
  score: number | null;
  grade: "A" | "B" | "C" | null;
  /** RAW category percentages (0–100, configured categories only) + exclusion_penalty in points. */
  breakdown: Record<string, number>;
  coveragePercent: number;
  explanation: {
    v: 1;
    base_score: number;
    categories: Record<string, ExplanationItem[]>;
    exclusions: ExplanationItem[];
    missing: string[];
  };
  /** Per configured category: configured weight and effective share (percent, 1 decimal). */
  effectiveWeights: Record<string, { configured: number; effective: number }>;
  exclusionReasons: { id: string; name: string }[] | null;
  inputFingerprint: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function toScoreRecord(e: Scored): ScoreRecord {
  const breakdown: Record<string, number> = {};
  const effectiveWeights: ScoreRecord["effectiveWeights"] = {};
  const categories: Record<string, ExplanationItem[]> = {};
  for (const k of SCORING_CATEGORIES) {
    const c = e.categories[k];
    if (!c.configured || c.raw === null) continue;
    breakdown[k] = Math.round(c.raw);
    effectiveWeights[k] = { configured: c.configuredWeight, effective: r1(c.effectiveWeight ?? 0) };
    categories[k] = clip(c.items);
  }
  if (e.exclusionPenalty) breakdown.exclusion_penalty = Math.min(100, e.exclusionPenalty);
  return {
    status: e.outcome,
    score: e.score,
    grade: e.grade,
    breakdown,
    coveragePercent: e.coveragePercent,
    explanation: { v: 1, base_score: e.baseScore, categories, exclusions: clip(e.exclusionItems), missing: e.missing.map((m) => m.label).slice(0, 10) },
    effectiveWeights,
    exclusionReasons: e.hardExclusions.length ? e.hardExclusions.map((h) => ({ id: h.id, name: h.name.slice(0, 120) })) : null,
    inputFingerprint: e.inputFingerprint,
  };
}
