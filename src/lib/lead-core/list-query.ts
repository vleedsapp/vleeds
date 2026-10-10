import { isCountryCode } from "@/lib/config/countries";
import { GRADES, QUALIFICATION_STATES, type QualificationState } from "./schemas";

/**
 * Leads list state lives in the URL (?page=&qualification=&grade=&restricted=
 * &contact=&country=&sort=&company=), so it is shareable and survives reloads.
 * Unknown or malformed values are ignored, never errors.
 */

export const LEADS_PAGE_SIZE = 25;

export const LEAD_SORTS = ["updated", "name", "qualification", "grade"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export type LeadListQuery = {
  page: number;
  qualification: QualificationState | null;
  /** A/B/C = current grade (default ICP); excluded; outdated; none = not scored. */
  grade: "A" | "B" | "C" | "excluded" | "outdated" | "none" | null;
  restricted: boolean | null;
  hasContact: boolean | null;
  country: string | null;
  sort: LeadSort;
};

export const DEFAULT_LEAD_QUERY: LeadListQuery = {
  page: 1,
  qualification: null,
  grade: null,
  restricted: null,
  hasContact: null,
  country: null,
  sort: "updated",
};

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const yesNo = (v: string) => (v === "yes" ? true : v === "no" ? false : null);

export function parseLeadQuery(params: Params): LeadListQuery {
  const page = Number.parseInt(one(params.page), 10);
  const qualification = one(params.qualification);
  const grade = one(params.grade);
  const country = one(params.country).toUpperCase();
  const sort = one(params.sort);
  return {
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
    qualification: (QUALIFICATION_STATES as readonly string[]).includes(qualification) ? (qualification as QualificationState) : null,
    grade: ["none", "excluded", "outdated"].includes(grade) || (GRADES as readonly string[]).includes(grade) ? (grade as LeadListQuery["grade"]) : null,
    restricted: yesNo(one(params.restricted)),
    hasContact: yesNo(one(params.contact)),
    country: country && isCountryCode(country) ? country : null,
    sort: (LEAD_SORTS as readonly string[]).includes(sort) ? (sort as LeadSort) : "updated",
  };
}

/** Builds the query string for a list state (defaults omitted), plus optional extras such as ?company=. */
export function leadQueryString(q: LeadListQuery, extra: Record<string, string | null> = {}): string {
  const p = new URLSearchParams();
  if (q.qualification) p.set("qualification", q.qualification);
  if (q.grade) p.set("grade", q.grade);
  if (q.restricted !== null) p.set("restricted", q.restricted ? "yes" : "no");
  if (q.hasContact !== null) p.set("contact", q.hasContact ? "yes" : "no");
  if (q.country) p.set("country", q.country);
  if (q.sort !== "updated") p.set("sort", q.sort);
  if (q.page > 1) p.set("page", String(q.page));
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilters(q: LeadListQuery): boolean {
  return q.qualification !== null || q.grade !== null || q.restricted !== null || q.hasContact !== null || q.country !== null;
}
