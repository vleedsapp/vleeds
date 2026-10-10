import { SCORING_CATEGORIES, type ScoringCategory } from "@/lib/config/icp";
import { companyFit } from "./company-fit";
import { decisionMakerFit } from "./decision-maker-fit";
import { geographyFit } from "./geography-fit";
import { buyingSignalFit, exclusions } from "./signals";
import type { CategoryResult, Evaluation, MissingItem, ScoringInput } from "./types";

/**
 * evaluateCompanyAgainstIcp — the ONE scoring calculation (P1-E6). Pure and
 * deterministic: same input → same result.
 *
 *  1. Each category is CONFIGURED only if the ICP defines criteria for it;
 *     unconfigured categories are left out of the denominator (the user's
 *     weights are never rewritten).
 *  2. base = Σ raw_c × weight_c / Σ weight_c over configured categories.
 *  3. Enabled exclusions observed PRESENT: hard → outcome Excluded (no
 *     grade); penalty → points subtracted (summed, not weighted).
 *  4. final = clamp(base − penalties, 0, 100), rounded once with Math.round.
 *  5. Grade from the profile's saved thresholds: A ≥ a, B ≥ b, else C.
 *  6. Coverage (separate from fit) = known evaluation units / configured units.
 */

export function gradeFor(score: number, thresholds: { a: number; b: number }): "A" | "B" | "C" {
  return score >= thresholds.a ? "A" : score >= thresholds.b ? "B" : "C";
}

export function evaluateCompanyAgainstIcp(input: ScoringInput): Evaluation {
  const model = input.icp.scoringModel;
  if (!model) return { outcome: "not_evaluable", reason: "no_scoring_model", inputFingerprint: input.fingerprint };

  const parts = {
    company_fit: companyFit(input),
    geography_fit: geographyFit(input),
    decision_maker_fit: decisionMakerFit(input),
    buying_signal_fit: buyingSignalFit(input),
  } satisfies Record<ScoringCategory, { configured: boolean; raw: number; known: number; total: number; items: CategoryResult["items"] }>;

  const configured = SCORING_CATEGORIES.filter((k) => parts[k].configured);
  const denominator = configured.reduce((t, k) => t + model.categoryWeights[k], 0);
  if (!configured.length || denominator === 0) return { outcome: "not_evaluable", reason: "no_criteria", inputFingerprint: input.fingerprint };

  const categories = Object.fromEntries(
    SCORING_CATEGORIES.map((k) => {
      const p = parts[k];
      const w = model.categoryWeights[k];
      const result: CategoryResult = {
        key: k,
        configured: p.configured,
        raw: p.configured ? p.raw : null,
        configuredWeight: w,
        effectiveWeight: p.configured ? (w / denominator) * 100 : null,
        contribution: p.configured ? (p.raw * w) / denominator : 0,
        coverage: { known: p.known, total: p.total },
        items: p.items,
      };
      return [k, result];
    }),
  ) as Record<ScoringCategory, CategoryResult>;

  const ex = exclusions(input);
  const base = SCORING_CATEGORIES.reduce((t, k) => t + categories[k].contribution, 0);
  const final = Math.round(Math.min(100, Math.max(0, base - ex.penalty)));

  const units = SCORING_CATEGORIES.reduce((t, k) => ({ known: t.known + categories[k].coverage.known, total: t.total + categories[k].coverage.total }), { known: ex.known, total: ex.total });
  const coveragePercent = units.total ? Math.round((units.known / units.total) * 100) : 0;

  const hard = ex.hard.length > 0;
  return {
    outcome: hard ? "excluded" : "scored",
    score: hard ? null : final,
    baseScore: Math.round(base),
    grade: hard ? null : gradeFor(final, model.thresholds),
    coveragePercent,
    categories,
    exclusionPenalty: ex.penalty,
    penalties: ex.penalties,
    hardExclusions: ex.hard,
    exclusionItems: ex.items,
    missing: missingData(input, categories, ex.total - ex.known),
    thresholds: model.thresholds,
    inputFingerprint: input.fingerprint,
  };
}

/** What could not be evaluated, grouped into actionable phrases ("Improve data coverage"). */
function missingData(input: ScoringInput, c: Record<ScoringCategory, CategoryResult>, unknownExclusions: number) {
  const out: MissingItem[] = [];
  const unknown = (k: ScoringCategory, criterion: string) => c[k].items.some((i) => i.criterion === criterion && i.result === "unknown");
  if (unknown("company_fit", "Industry")) out.push({ key: "industry", label: "Company industry" });
  if (unknown("company_fit", "Company size")) out.push({ key: "size", label: "Company size" });
  if (unknown("company_fit", "Characteristic") || unknown("company_fit", "Keyword")) out.push({ key: "text", label: "Company description or category (for characteristics and keywords)" });
  if (unknown("geography_fit", "Location")) out.push({ key: "location", label: input.company.country ? "A more specific company location" : "Company location" });
  if (unknown("decision_maker_fit", "Decision makers")) out.push({ key: "contacts", label: "Decision-maker contacts" });
  const signals = c.buying_signal_fit.coverage.total - c.buying_signal_fit.coverage.known;
  if (signals) out.push({ key: "buying_signals", label: `${signals} buying-signal observation${signals === 1 ? "" : "s"}` });
  if (unknownExclusions) out.push({ key: "exclusions", label: `${unknownExclusions} exclusion observation${unknownExclusions === 1 ? "" : "s"}` });
  return out;
}
