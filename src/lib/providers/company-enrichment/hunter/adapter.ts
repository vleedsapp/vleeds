import type { CompanyEnrichmentProvider, EnrichmentCapabilities, EnrichmentStatus, EnrichmentUsage } from "../types";
import { hunterGet, type GetFetchLike } from "./client";
import { mapCompany, mapCompanyResponse, mapDomainFinderResponse } from "./mapper";
import {
  COMPANY_ENRICHMENT_CREDIT_MILLIS,
  COMPANY_ENRICHMENT_CREDIT_RULE,
  DOMAIN_FINDER_CREDIT_RULE,
  estimateCreditMillis,
  HUNTER_API_BASE,
  HUNTER_COMPANY_ENRICHMENT_PATH,
  HUNTER_DOMAIN_FINDER_PATH,
  HUNTER_DOMAIN_SUGGESTION_LIMIT,
  HUNTER_MIN_COMPANY_NAME,
  HUNTER_PROVIDER_KEY,
} from "./usage";

/**
 * Hunter API v2 as a CompanyEnrichmentProvider: Domain Finder (Beta) and
 * Company Enrichment only. No email/people/combined enrichment, no Domain
 * Search, no Email Finder, no Discover (by design, P1-E4).
 *
 * Interactive only: one call per explicit user action, no batch loops.
 */

export type HunterConfig = {
  apiKey: string | null;
  /** Defaults to Hunter's API; a loopback override exists only for local UI review (see registry). */
  baseUrl?: string;
  fetch?: GetFetchLike;
  timeoutMs?: number;
  retries?: number;
};

const CAPABILITIES: EnrichmentCapabilities = {
  companyEnrichment: true,
  domainResolution: true,
  durableCompanyFields: true,
  durableExternalId: true,
  usageCredits: true,
};

export function createHunterProvider(config: HunterConfig): CompanyEnrichmentProvider {
  const options = () => ({
    apiKey: config.apiKey!,
    baseUrl: config.baseUrl ?? HUNTER_API_BASE,
    fetch: config.fetch ?? (globalThis.fetch as unknown as GetFetchLike),
    timeoutMs: config.timeoutMs ?? 10_000,
    retries: config.retries ?? 1,
  });

  const usage = (operation: EnrichmentUsage["operation"], requestCount: number, resultCount: number, status: EnrichmentStatus): EnrichmentUsage => ({
    operation,
    requestCount,
    resultCount,
    status,
    estimatedCreditMillis: estimateCreditMillis(operation, status),
    creditRule: operation === "domain_finder" ? DOMAIN_FINDER_CREDIT_RULE : COMPANY_ENRICHMENT_CREDIT_RULE,
  });

  return {
    providerKey: HUNTER_PROVIDER_KEY,
    label: "Hunter",
    isConfigured: () => !!config.apiKey,
    getCapabilities: () => CAPABILITIES,
    enrichmentCreditEstimate: () => ({ millis: COMPANY_ENRICHMENT_CREDIT_MILLIS, rule: COMPANY_ENRICHMENT_CREDIT_RULE }),
    normalizeCompany: (raw) => mapCompany(raw),

    async resolveDomain({ companyName, limit }) {
      if (!config.apiKey) return { ok: false, code: "not_configured", usage: null };
      const name = companyName.replace(/\s+/g, " ").trim();
      // Hunter rejects shorter names; don't spend a request on them.
      if (name.length < HUNTER_MIN_COMPANY_NAME) return { ok: false, code: "invalid_request", usage: null };
      const max = Math.min(Math.max(limit ?? HUNTER_DOMAIN_SUGGESTION_LIMIT, 1), HUNTER_DOMAIN_SUGGESTION_LIMIT);
      const res = await hunterGet(options(), HUNTER_DOMAIN_FINDER_PATH, { company: name, limit: String(max) });
      if (!res.ok) {
        // A 404 from Domain Finder simply means "no suggestion".
        if (res.status === "not_found") return { ok: false, code: "no_suggestions", usage: usage("domain_finder", res.requestCount, 0, "empty") };
        return { ok: false, code: res.status, usage: usage("domain_finder", res.requestCount, 0, res.status) };
      }
      const mapped = mapDomainFinderResponse(res.body, name, max);
      if (!mapped.ok) return { ok: false, code: "malformed", usage: usage("domain_finder", res.requestCount, 0, "malformed") };
      if (!mapped.suggestions.length) return { ok: false, code: "no_suggestions", usage: usage("domain_finder", res.requestCount, 0, "empty") };
      return { ok: true, suggestions: mapped.suggestions, usage: usage("domain_finder", res.requestCount, mapped.suggestions.length, "ok") };
    },

    async enrichCompany({ domain }) {
      if (!config.apiKey) return { ok: false, code: "not_configured", usage: null };
      const res = await hunterGet(options(), HUNTER_COMPANY_ENRICHMENT_PATH, { domain });
      if (!res.ok) {
        // 404 = Hunter has no company data for this domain: a normal outcome, not chargeable.
        if (res.status === "not_found") return { ok: false, code: "not_found", usage: usage("company_enrichment", res.requestCount, 0, "empty") };
        return { ok: false, code: res.status, usage: usage("company_enrichment", res.requestCount, 0, res.status) };
      }
      const mapped = mapCompanyResponse(res.body, domain);
      if (!mapped.ok) return { ok: false, code: "malformed", usage: usage("company_enrichment", res.requestCount, 0, "malformed") };
      return { ok: true, company: mapped.company, usage: usage("company_enrichment", res.requestCount, 1, "ok") };
    },
  };
}
