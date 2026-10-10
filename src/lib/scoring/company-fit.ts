import { containsPhrase } from "./text";
import type { ExplanationItem, ScoringInput } from "./types";

/**
 * Company fit = the average of its CONFIGURED groups (industry, size,
 * characteristics, keywords), each 0–100, so twenty keywords can't outweigh
 * the other groups. ICP notes are explanatory only and never scored.
 */

export type GroupResult = { raw: number; known: number; total: number; items: ExplanationItem[] };

const quote = (s: string) => `“${s.length > 80 ? `${s.slice(0, 77)}…` : s}”`;

/**
 * Searchable company text: name, industry, description and provider-neutral
 * tag evidence. Never contact data, transient discovery content or payloads.
 * "Evaluable" requires more than the name (a name alone can't tell whether a
 * characteristic applies).
 */
export function companyCorpus(input: Pick<ScoringInput, "company" | "tags">): { text: string; evaluable: boolean } {
  const parts = [input.company.industry, input.company.description, ...input.tags].filter((v): v is string => !!v && !!v.trim());
  return { text: [input.company.name, ...parts].join(" \n "), evaluable: parts.length > 0 };
}

/** Industry: any configured industry phrase appears (whole words) in the company industry or tag evidence. */
export function industryGroup(industries: string[], input: Pick<ScoringInput, "company" | "tags">): GroupResult {
  const values = [input.company.industry, ...input.tags].filter((v): v is string => !!v && !!v.trim());
  if (!values.length) {
    return { raw: 0, known: 0, total: 1, items: [{ criterion: "Industry", result: "unknown", detail: "Industry data unavailable" }] };
  }
  for (const industry of industries) {
    const hit = values.find((v) => containsPhrase(v, industry));
    if (hit) return { raw: 100, known: 1, total: 1, items: [{ criterion: "Industry", result: "matched", detail: `Industry matches ${quote(industry)}` }] };
  }
  const shown = input.company.industry ? `Industry ${quote(input.company.industry)}` : "Company categories";
  return { raw: 0, known: 1, total: 1, items: [{ criterion: "Industry", result: "not_matched", detail: `${shown} doesn't match a target industry` }] };
}

const fmt = (n: number) => n.toLocaleString("en");
const rangeText = (lo: number | null, hi: number | null) =>
  lo !== null && hi !== null ? (lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`) : lo !== null ? `${fmt(lo)}+` : hi !== null ? `up to ${fmt(hi)}` : "any";

/**
 * Size: interval comparison. Fully inside the target → 100; overlapping → 50;
 * outside → 0. Open-ended bounds are respected; a company range with only a
 * maximum ("up to 50") starts at 0. No company data → 0, unknown.
 */
export function sizeGroup(target: { minEmployees: number | null; maxEmployees: number | null }, input: Pick<ScoringInput, "company">): GroupResult {
  const { employeeMin, employeeMax } = input.company;
  const targetText = `target ${rangeText(target.minEmployees, target.maxEmployees)}`;
  if (employeeMin === null && employeeMax === null) {
    return { raw: 0, known: 0, total: 1, items: [{ criterion: "Company size", result: "unknown", detail: "Employee count unavailable" }] };
  }
  const cLo = employeeMin ?? 0;
  const cHi = employeeMax ?? Number.POSITIVE_INFINITY;
  const tLo = target.minEmployees ?? 0;
  const tHi = target.maxEmployees ?? Number.POSITIVE_INFINITY;
  const companyText = `Employee range ${rangeText(employeeMin, employeeMax)}`;
  if (cLo >= tLo && cHi <= tHi) return { raw: 100, known: 1, total: 1, items: [{ criterion: "Company size", result: "matched", detail: `${companyText} fits ${targetText}` }] };
  if (cLo <= tHi && cHi >= tLo) return { raw: 50, known: 1, total: 1, items: [{ criterion: "Company size", result: "partial", detail: `${companyText} overlaps ${targetText}` }] };
  return { raw: 0, known: 1, total: 1, items: [{ criterion: "Company size", result: "not_matched", detail: `${companyText} is outside ${targetText}` }] };
}

/** Characteristics / keywords: each phrase present or not in the company text; unknown when there's no searchable text. */
export function phraseGroup(label: "Characteristic" | "Keyword", phrases: string[], input: Pick<ScoringInput, "company" | "tags">): GroupResult {
  const corpus = companyCorpus(input);
  const items: ExplanationItem[] = [];
  let matched = 0;
  for (const p of phrases) {
    if (!corpus.evaluable) items.push({ criterion: label, result: "unknown", detail: `${quote(p)} couldn't be checked (no company description or category)` });
    else if (containsPhrase(corpus.text, p)) {
      matched++;
      items.push({ criterion: label, result: "matched", detail: `${quote(p)} found in company details` });
    } else items.push({ criterion: label, result: "not_matched", detail: `${quote(p)} not found in company details` });
  }
  return { raw: phrases.length ? (matched / phrases.length) * 100 : 0, known: corpus.evaluable ? phrases.length : 0, total: phrases.length, items };
}

export type CompanyFit = { configured: boolean; raw: number; known: number; total: number; items: ExplanationItem[] };

export function companyFit(input: ScoringInput): CompanyFit {
  const ic = input.icp.idealCustomer;
  const groups: GroupResult[] = [];
  if (ic) {
    if (ic.industries.length) groups.push(industryGroup(ic.industries, input));
    if (ic.companySize.minEmployees !== null || ic.companySize.maxEmployees !== null) groups.push(sizeGroup(ic.companySize, input));
    if (ic.characteristics.length) groups.push(phraseGroup("Characteristic", ic.characteristics, input));
    if (ic.keywords.length) groups.push(phraseGroup("Keyword", ic.keywords, input));
  }
  if (!groups.length) return { configured: false, raw: 0, known: 0, total: 0, items: [] };
  return {
    configured: true,
    raw: groups.reduce((t, g) => t + g.raw, 0) / groups.length,
    known: groups.reduce((t, g) => t + g.known, 0),
    total: groups.reduce((t, g) => t + g.total, 0),
    items: groups.flatMap((g) => g.items),
  };
}
