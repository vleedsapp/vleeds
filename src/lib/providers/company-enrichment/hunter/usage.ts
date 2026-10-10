import type { EnrichmentStatus } from "../types";

/**
 * Hunter API v2 constants and the credit ESTIMATE rule (the one place that
 * knows them). Checked against Hunter's API documentation on 2026-10-09;
 * plans and charge rules can change, so they are provider metadata, never
 * product logic. Hunter's own account page is the authority on real usage.
 */
export const HUNTER_PROVIDER_KEY = "hunter";
export const HUNTER_API_BASE = "https://api.hunter.io/v2";
export const HUNTER_DOMAIN_FINDER_PATH = "/domain-finder";
export const HUNTER_COMPANY_ENRICHMENT_PATH = "/companies/find";

/** Domain Finder (Beta): "company" needs at least 3 characters; limit 1–10. */
export const HUNTER_MIN_COMPANY_NAME = 3;
export const HUNTER_DOMAIN_SUGGESTION_LIMIT = 5;

/** Documented: Company Enrichment costs 0.2 credit when the core company data is returned. */
export const COMPANY_ENRICHMENT_CREDIT_MILLIS = 200;
export const COMPANY_ENRICHMENT_CREDIT_RULE = "0.2 credit per company returned (Hunter documentation, 2026-10)";
export const DOMAIN_FINDER_CREDIT_RULE = "Free (Domain Finder Beta, Hunter documentation, 2026-10)";

/**
 * Estimated credits for one call:
 *   Domain Finder        → 0 (currently free of credit charge)
 *   Company Enrichment   → 200 when company data came back (the charge
 *                          condition), 0 when nothing was returned or the call
 *                          failed, NULL when Vleeds can't tell (unreadable
 *                          success response).
 */
export function estimateCreditMillis(operation: "domain_finder" | "company_enrichment", status: EnrichmentStatus): number | null {
  if (operation === "domain_finder") return 0;
  if (status === "ok") return COMPANY_ENRICHMENT_CREDIT_MILLIS;
  if (status === "malformed") return null;
  return 0;
}
