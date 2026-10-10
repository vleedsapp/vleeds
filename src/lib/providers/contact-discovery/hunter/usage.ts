import type { ContactProviderStatus } from "../types";

/**
 * Hunter Domain Search constants and the credit ESTIMATE rule (checked against
 * Hunter's API v2 documentation on 2026-10-09; plans and rules change, so this
 * is provider metadata, never product logic). Shared Hunter constants
 * (base URL, provider key) come from the P1-E4 adapter.
 */
export { HUNTER_API_BASE, HUNTER_PROVIDER_KEY } from "../../company-enrichment/hunter/usage";

export const HUNTER_DOMAIN_SEARCH_PATH = "/domain-search";

/** P1-E5 MVP: one page of at most 10 people per explicit search; at most 10 job titles. */
export const HUNTER_CONTACT_LIMIT = 10;
export const HUNTER_MAX_TITLES = 10;

/** Documented: one Domain Search credit when the call returns 1–10 emails. */
export const DOMAIN_SEARCH_CREDIT_MILLIS = 1000;
export const DOMAIN_SEARCH_CREDIT_RULE = "1 credit per search returning 1–10 emails (Hunter documentation, 2026-10)";

/** Hunter's seniority filter values (its own taxonomy, not Vleeds' seniority hints). */
export const HUNTER_SENIORITIES = ["junior", "senior", "executive"] as const;
export const HUNTER_DEPARTMENTS = [
  "executive", "it", "finance", "management", "sales", "legal", "support", "hr", "marketing", "communication",
  "education", "design", "health", "operations", "product", "research", "consulting", "administrative", "procurement",
] as const;

/**
 * Estimated credits for one Domain Search:
 *   1–10 emails returned → 1000 (one credit)
 *   no emails / failure  → 0
 *   unreadable success   → NULL (Vleeds can't know)
 * `returned` counts the emails Hunter returned, including ones Vleeds then
 * skips (Hunter's charge doesn't depend on what Vleeds keeps).
 */
export function estimateDomainSearchCredits(status: ContactProviderStatus, returned: number): number | null {
  if (status === "malformed") return null;
  if (status !== "ok" || returned < 1) return 0;
  return DOMAIN_SEARCH_CREDIT_MILLIS * Math.ceil(returned / 10);
}
