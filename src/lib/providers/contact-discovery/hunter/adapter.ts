import { hunterGet, type GetFetchLike } from "../../company-enrichment/hunter/client";
import type { ContactDiscoveryCapabilities, ContactDiscoveryProvider, ContactProviderStatus, ContactSearchInput, ContactSearchUsage } from "../types";
import { mapDomainSearchResponse, mapPerson } from "./mapper";
import {
  DOMAIN_SEARCH_CREDIT_MILLIS,
  DOMAIN_SEARCH_CREDIT_RULE,
  estimateDomainSearchCredits,
  HUNTER_API_BASE,
  HUNTER_CONTACT_LIMIT,
  HUNTER_DEPARTMENTS,
  HUNTER_DOMAIN_SEARCH_PATH,
  HUNTER_MAX_TITLES,
  HUNTER_PROVIDER_KEY,
  HUNTER_SENIORITIES,
} from "./usage";

/**
 * Hunter Domain Search as a ContactDiscoveryProvider. One page (≤ 10 people)
 * per explicit user action; no automatic pagination or fallback searches; no
 * Email Finder / Email Verifier / Email or Combined Enrichment / Multi-Domain
 * Search. Authentication, timeout, bounded retry and status mapping are the
 * shared P1-E4 Hunter client (key in a request header, never in the URL).
 */

export type HunterContactConfig = {
  apiKey: string | null;
  baseUrl?: string;
  fetch?: GetFetchLike;
  timeoutMs?: number;
  retries?: number;
};

const CAPABILITIES: ContactDiscoveryCapabilities = {
  contactDiscovery: true,
  titleFiltering: true,
  seniorityFiltering: true,
  departmentFiltering: true,
  decisionMakerFiltering: true,
  returnsProfessionalEmail: true,
  returnsPhoneSometimes: true,
  returnsLinkedInSometimes: true,
  usageCredits: true,
  maxResults: HUNTER_CONTACT_LIMIT,
  maxTitles: HUNTER_MAX_TITLES,
};

/** Hunter's job_titles is comma-separated: commas inside a title become spaces. */
const titleParam = (t: string) => t.replace(/,/g, " ").replace(/\s+/g, " ").trim();

/** Exactly the query Vleeds sends (exported for tests). Offset is always 0: no pagination in P1-E5. */
export function domainSearchParams(input: ContactSearchInput): Record<string, string> {
  const titles = [...new Set(input.titles.map(titleParam).filter(Boolean))].slice(0, HUNTER_MAX_TITLES);
  const params: Record<string, string> = {
    domain: input.domain,
    type: "personal",
    limit: String(Math.min(Math.max(Math.floor(input.limit) || HUNTER_CONTACT_LIMIT, 1), HUNTER_CONTACT_LIMIT)),
    offset: "0",
  };
  if (titles.length) params.job_titles = titles.join(",");
  // Not forced when titles are given: an ICP title may matter even if Hunter doesn't classify the person as a decision maker.
  if (input.decisionMakerOnly) params.decision_maker = "true";
  const seniority = (input.seniority ?? []).filter((s) => (HUNTER_SENIORITIES as readonly string[]).includes(s));
  if (seniority.length) params.seniority = seniority.join(",");
  const department = (input.department ?? []).filter((d) => (HUNTER_DEPARTMENTS as readonly string[]).includes(d));
  if (department.length) params.department = department.join(",");
  return params;
}

export function createHunterContactProvider(config: HunterContactConfig): ContactDiscoveryProvider {
  const usage = (requestCount: number, returned: number, kept: number, status: ContactProviderStatus): ContactSearchUsage => ({
    operation: "domain_search",
    requestCount,
    resultCount: kept,
    status,
    estimatedCreditMillis: estimateDomainSearchCredits(status, returned),
    creditRule: DOMAIN_SEARCH_CREDIT_RULE,
  });

  return {
    providerKey: HUNTER_PROVIDER_KEY,
    label: "Hunter",
    isConfigured: () => !!config.apiKey,
    getCapabilities: () => CAPABILITIES,
    searchCreditEstimate: () => ({ millis: DOMAIN_SEARCH_CREDIT_MILLIS, rule: DOMAIN_SEARCH_CREDIT_RULE }),
    normalizeCandidate: mapPerson,

    async searchContacts(input) {
      if (!config.apiKey) return { ok: false, code: "not_configured", usage: null };
      if (!input.titles.length && !input.decisionMakerOnly) return { ok: false, code: "invalid_request", usage: null };
      const res = await hunterGet(
        {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl ?? HUNTER_API_BASE,
          fetch: config.fetch ?? (globalThis.fetch as unknown as GetFetchLike),
          timeoutMs: config.timeoutMs ?? 10_000,
          retries: config.retries ?? 1,
        },
        HUNTER_DOMAIN_SEARCH_PATH,
        domainSearchParams(input),
      );
      if (!res.ok) {
        // Domain Search answers "nothing found" with 200 + empty list; a 404 is treated the same way.
        if (res.status === "not_found") return { ok: true, candidates: [], skipped: 0, usage: usage(res.requestCount, 0, 0, "empty") };
        return { ok: false, code: res.status, usage: usage(res.requestCount, 0, 0, res.status) };
      }
      const mapped = mapDomainSearchResponse(res.body, Math.min(input.limit, HUNTER_CONTACT_LIMIT));
      if (!mapped.ok) return { ok: false, code: "malformed", usage: usage(res.requestCount, 0, 0, "malformed") };
      const status = mapped.returned ? "ok" : "empty";
      return { ok: true, candidates: mapped.candidates, skipped: mapped.skipped, usage: usage(res.requestCount, mapped.returned, mapped.candidates.length, status) };
    },
  };
}
