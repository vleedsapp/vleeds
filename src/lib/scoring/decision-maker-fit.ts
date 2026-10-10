import type { DecisionMakerPriority } from "@/lib/config/icp";
import { containsPhrase } from "./text";
import type { ExplanationItem, ScoringInput } from "./types";

/**
 * Decision-maker fit from SAVED contacts only (provider candidates that were
 * never saved don't count; "left company" contacts are excluded upstream).
 * Same whole-word title matching as contact discovery (P1-E5). The highest
 * priority found decides: primary 100 · secondary 70 · fallback 40 · none 0.
 * No contacts → 0, unknown. Provider decision-maker flags, seniority or the
 * number of contacts add nothing in P1-E6.
 */

export const ROLE_POINTS: Record<DecisionMakerPriority, number> = { primary: 100, secondary: 70, fallback: 40 };
const RANK: Record<DecisionMakerPriority, number> = { primary: 0, secondary: 1, fallback: 2 };

/**
 * The highest-priority configured role a job title matches (whole-word phrase
 * match), or null. Shared by scoring, and by the Today queue's recommended
 * contact (P1-E7), so both rank people the same way.
 */
export function bestRoleFor(title: string | null, roles: readonly { title: string; priority: DecisionMakerPriority }[]): { priority: DecisionMakerPriority; role: string } | null {
  if (!title) return null;
  let best: { priority: DecisionMakerPriority; role: string } | null = null;
  for (const r of roles) {
    if (containsPhrase(title, r.title) && (!best || RANK[r.priority] < RANK[best.priority])) best = { priority: r.priority, role: r.title };
  }
  return best;
}

export const ROLE_RANK = RANK;

export type DecisionMakerFit = { configured: boolean; raw: number; known: number; total: number; items: ExplanationItem[] };

export function decisionMakerFit(input: ScoringInput): DecisionMakerFit {
  const roles = input.icp.decisionMakers ?? [];
  if (!roles.length) return { configured: false, raw: 0, known: 0, total: 0, items: [] };
  if (!input.contacts.length) {
    return { configured: true, raw: 0, known: 0, total: 1, items: [{ criterion: "Decision makers", result: "unknown", detail: "No contacts saved for this company" }] };
  }
  let best: { priority: DecisionMakerPriority; role: string; title: string } | null = null;
  for (const c of input.contacts) {
    const match = bestRoleFor(c.title, roles);
    if (match && c.title && (!best || RANK[match.priority] < RANK[best.priority])) best = { ...match, title: c.title };
  }
  if (!best) {
    return {
      configured: true,
      raw: 0,
      known: 1,
      total: 1,
      items: [{ criterion: "Decision makers", result: "not_matched", detail: `${input.contacts.length} contact${input.contacts.length === 1 ? "" : "s"}, none in a configured role` }],
    };
  }
  const word = { primary: "Primary", secondary: "Secondary", fallback: "Fallback" }[best.priority];
  return {
    configured: true,
    raw: ROLE_POINTS[best.priority],
    known: 1,
    total: 1,
    items: [{ criterion: "Decision makers", result: best.priority === "primary" ? "matched" : "partial", detail: `${word} decision-maker found: “${best.title}” (role “${best.role}”)` }],
  };
}
