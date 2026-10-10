import type { Geography } from "@/lib/config/icp";
import { samePhrase } from "./text";
import type { ExplanationItem, ScoringInput } from "./types";

/**
 * Geography fit: structured comparison at each target's specificity (no
 * geocoding, no distances, no provider calls).
 *   country target → same country
 *   region target  → same country + region
 *   city target    → same country + city (+ region when the target has one)
 * Any match → 100. No match → 0. Missing company data → 0, unknown.
 */

type TargetResult = "match" | "no_match" | "unknown";

export function matchGeography(target: Geography, company: ScoringInput["company"]): TargetResult {
  if (!company.country) return "unknown";
  if (company.country.toUpperCase() !== target.countryCode) return "no_match";
  if (target.region) {
    if (!company.region) return "unknown";
    if (!samePhrase(company.region, target.region)) return "no_match";
  }
  if (target.city) {
    if (!company.city) return "unknown";
    if (!samePhrase(company.city, target.city)) return "no_match";
  }
  return "match";
}

const label = (g: Geography) => g.label || [g.city, g.region, g.countryName].filter(Boolean).join(", ");
const where = (c: ScoringInput["company"]) => [c.city, c.region, c.country].filter(Boolean).join(", ");

export type GeographyFit = { configured: boolean; raw: number; known: number; total: number; items: ExplanationItem[] };

export function geographyFit(input: ScoringInput): GeographyFit {
  const targets = input.icp.geographies ?? [];
  if (!targets.length) return { configured: false, raw: 0, known: 0, total: 0, items: [] };
  const c = input.company;
  if (!c.country) {
    return { configured: true, raw: 0, known: 0, total: 1, items: [{ criterion: "Location", result: "unknown", detail: "Company location unavailable" }] };
  }
  const results = targets.map((t) => ({ t, r: matchGeography(t, c) }));
  const hit = results.find((x) => x.r === "match");
  if (hit) return { configured: true, raw: 100, known: 1, total: 1, items: [{ criterion: "Location", result: "matched", detail: `Located in target geography ${label(hit.t)}` }] };
  const unknown = results.find((x) => x.r === "unknown");
  if (unknown) {
    return {
      configured: true,
      raw: 0,
      known: 0,
      total: 1,
      items: [{ criterion: "Location", result: "unknown", detail: `Location ${where(c)} is too general to compare with ${label(unknown.t)}` }],
    };
  }
  return { configured: true, raw: 0, known: 1, total: 1, items: [{ criterion: "Location", result: "not_matched", detail: `Location ${where(c)} is outside the target geographies` }] };
}
