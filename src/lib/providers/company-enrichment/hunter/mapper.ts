import { isCountryCode } from "@/lib/config/countries";
import { normalizeCompanyName, normalizeDomain } from "@/lib/lead-core/normalize";
import type { DomainSuggestion, EnrichedCompany, EnrichedLocation } from "../types";
import { companyResponseSchema, domainFinderResponseSchema, type HunterCompany } from "./schemas";
import { HUNTER_PROVIDER_KEY } from "./usage";

/**
 * Hunter responses → generic Vleeds shapes. Only the durable company-level
 * fields Vleeds uses are mapped; every other response field is dropped here
 * (see docs/providers/hunter.md "Ignored fields").
 */

const clip = (v: string | null | undefined, max: number): string | null => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max).trim() : null;
};

// -----------------------------------------------------------------------------
// Domain Finder (Beta)
// -----------------------------------------------------------------------------

export type MappedSuggestions = { ok: true; suggestions: DomainSuggestion[] } | { ok: false };

/** Maps Domain Finder results: normalized, de-duplicated domains, at most `limit`. */
export function mapDomainFinderResponse(body: unknown, companyName: string, limit: number): MappedSuggestions {
  const parsed = domainFinderResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  const wanted = normalizeCompanyName(companyName);
  const seen = new Set<string>();
  const suggestions: DomainSuggestion[] = [];
  for (const item of parsed.data.data) {
    const domain = normalizeDomain(item.domain);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    const name = clip(item.company_name, 200);
    suggestions.push({
      domain,
      companyName: name,
      confidenceLabel: name && normalizeCompanyName(name) === wanted ? "Exact name match" : null,
      emailCount: typeof item.email_count === "number" && Number.isFinite(item.email_count) && item.email_count >= 0 ? Math.floor(item.email_count) : null,
    });
    if (suggestions.length >= limit) break;
  }
  return { ok: true, suggestions };
}

// -----------------------------------------------------------------------------
// Company Enrichment
// -----------------------------------------------------------------------------

const count = (s: string) => {
  const digits = s.replace(/[\s,]/g, "");
  return /^\d{1,8}$/.test(digits) ? Number(digits) : null;
};

/**
 * Conservative employee mapping:
 *   exact count (number)          → min = max = count
 *   "11-50", "1,001–5,000"        → min 11, max 50
 *   "10001+" / "10,000+"          → min only
 *   anything else ("10K+", "", …) → nothing (never invented)
 */
export function parseEmployees(employees: unknown, employeesCount?: unknown): { min: number | null; max: number | null } {
  const exact = typeof employeesCount === "number" ? employeesCount : typeof employees === "number" ? employees : null;
  if (exact !== null && Number.isInteger(exact) && exact >= 0 && exact <= 10_000_000) return { min: exact, max: exact };
  if (typeof employees !== "string") return { min: null, max: null };
  const v = employees.trim();
  const range = v.match(/^([\d,\s]+?)\s*[-–]\s*([\d,\s]+)$/);
  if (range) {
    const min = count(range[1]);
    const max = count(range[2]);
    return min !== null && max !== null && min <= max ? { min, max } : { min: null, max: null };
  }
  const plus = v.match(/^([\d,\s]+?)\s*\+$/);
  if (plus) {
    const min = count(plus[1]);
    return { min, max: null };
  }
  return { min: null, max: null };
}

/** Hunter geo → generic location (structured parts only; no coordinates; no country assumed). */
export function mapLocation(geo: HunterCompany["geo"]): EnrichedLocation | null {
  if (!geo) return null;
  const code = clip(geo.countryCode, 2)?.toUpperCase() ?? null;
  const street = clip(geo.streetAddress, 200) ?? clip([geo.streetNumber, geo.streetName].filter(Boolean).join(" "), 200);
  const loc: EnrichedLocation = {
    countryCode: code && isCountryCode(code) ? code : null,
    region: clip(geo.state, 120) ?? clip(geo.stateCode, 120),
    city: clip(geo.city, 120),
    postalCode: clip(geo.postalCode, 20),
    addressLine1: street,
  };
  return Object.values(loc).some((v) => v !== null) ? loc : null;
}

function mapTags(tags: unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const t of tags ?? []) {
    const v = typeof t === "string" ? clip(t, 60) : null;
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length >= 10) break;
  }
  return out;
}

/** One company payload (the `data` object) → EnrichedCompany. `fallbackDomain` = the domain that was looked up. */
export function mapCompany(raw: unknown, fallbackDomain?: string | null): EnrichedCompany | null {
  const parsed = companyResponseSchema.shape.data.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const domain = normalizeDomain(d.domain) ?? normalizeDomain(fallbackDomain);
  if (!domain) return null;
  const employees = parseEmployees(d.metrics?.employees, d.metrics?.employeesCount);
  const phone = clip(d.phone, 40) ?? clip((d.site?.phoneNumbers ?? []).find((p): p is string => typeof p === "string"), 40);
  const id = d.id === null || d.id === undefined ? null : clip(String(d.id), 256);
  return {
    providerKey: HUNTER_PROVIDER_KEY,
    externalId: id,
    name: clip(d.name, 200) ?? clip(d.legalName, 200),
    domain,
    websiteUrl: `https://${domain}`,
    phone,
    location: mapLocation(d.geo),
    employeeCountMin: employees.min,
    employeeCountMax: employees.max,
    // One documented field: category.industry (not a concatenation of the taxonomy).
    industry: clip(d.category?.industry, 200),
    description: clip(d.description, 2000),
    tags: mapTags(d.tags),
  };
}

export type MappedCompany = { ok: true; company: EnrichedCompany } | { ok: false };

export function mapCompanyResponse(body: unknown, requestedDomain: string): MappedCompany {
  const parsed = companyResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  const company = mapCompany(parsed.data.data, requestedDomain);
  return company ? { ok: true, company } : { ok: false };
}
