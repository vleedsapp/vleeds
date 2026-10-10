import type { ExclusionHit, ExplanationItem, ScoringInput } from "./types";

/**
 * Buying signals and exclusions, from STRUCTURED observations only (never
 * inferred from text). Unknown = no observation: it scores nothing, lowers
 * coverage and never triggers an exclusion.
 */

const stateOf = (input: ScoringInput, kind: "buying" | "exclusion", id: string) => input.signals.find((s) => s.kind === kind && s.id === id)?.state ?? null;

export type BuyingFit = { configured: boolean; raw: number; known: number; total: number; items: ExplanationItem[] };

/** sum(weights of present signals) / sum(weights of all enabled signals) × 100. */
export function buyingSignalFit(input: ScoringInput): BuyingFit {
  const enabled = (input.icp.buyingSignals ?? []).filter((s) => s.enabled);
  if (!enabled.length) return { configured: false, raw: 0, known: 0, total: 0, items: [] };
  const totalWeight = enabled.reduce((t, s) => t + s.weight, 0);
  let present = 0;
  let known = 0;
  const items: ExplanationItem[] = enabled.map((s) => {
    const state = stateOf(input, "buying", s.id);
    if (state === "present") {
      present += s.weight;
      known++;
      return { criterion: "Buying signal", result: "matched", detail: `“${s.name}” confirmed (weight ${s.weight})` };
    }
    if (state === "absent") {
      known++;
      return { criterion: "Buying signal", result: "not_matched", detail: `“${s.name}” not present` };
    }
    return { criterion: "Buying signal", result: "unknown", detail: `“${s.name}” not reviewed` };
  });
  return { configured: true, raw: totalWeight ? (present / totalWeight) * 100 : 0, known, total: enabled.length, items };
}

export type ExclusionOutcome = { hard: ExclusionHit[]; penalties: ExclusionHit[]; penalty: number; known: number; total: number; items: ExplanationItem[] };

/** Only PRESENT observations of ENABLED exclusions count: hard → Excluded; penalty → points subtracted (summed). */
export function exclusions(input: ScoringInput): ExclusionOutcome {
  const enabled = (input.icp.exclusionSignals ?? []).filter((s) => s.enabled);
  const out: ExclusionOutcome = { hard: [], penalties: [], penalty: 0, known: 0, total: enabled.length, items: [] };
  for (const s of enabled) {
    const state = stateOf(input, "exclusion", s.id);
    const hit: ExclusionHit = { id: s.id, name: s.name, behavior: s.behavior, penalty: s.penalty };
    if (state === "present") {
      out.known++;
      if (s.behavior === "hard_exclude") {
        out.hard.push(hit);
        out.items.push({ criterion: "Exclusion", result: "matched", detail: `“${s.name}” present: excludes the company` });
      } else {
        out.penalties.push(hit);
        out.penalty += s.penalty ?? 0;
        out.items.push({ criterion: "Exclusion", result: "matched", detail: `“${s.name}” present: −${s.penalty ?? 0} points` });
      }
    } else if (state === "absent") {
      out.known++;
      out.items.push({ criterion: "Exclusion", result: "not_matched", detail: `“${s.name}” not present` });
    } else {
      out.items.push({ criterion: "Exclusion", result: "unknown", detail: `“${s.name}” not reviewed` });
    }
  }
  return out;
}
