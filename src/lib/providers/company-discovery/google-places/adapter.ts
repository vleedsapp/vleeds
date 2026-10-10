import { clampPageSize, composeTextQuery } from "../query";
import type { CompanyDiscoveryProvider, DiscoverySearchInput, DiscoverySearchResult, ProviderCapabilities, ProviderUsage } from "../types";
import { textSearch, type FetchLike, type TextSearchBody } from "./client";
import {
  GOOGLE_MAX_PAGE_SIZE,
  GOOGLE_PLACES_FIELD_RETENTION,
  GOOGLE_PLACES_PROVIDER_KEY,
  GOOGLE_PRICING_REFERENCE,
  GOOGLE_TEXT_SEARCH_SKU_HINT,
  GOOGLE_TEXT_SEARCH_URL,
  googlePlacesDiscoveryFields,
} from "./fields";
import { mapPlace, mapTextSearchResponse } from "./mapper";

/**
 * Google Places API (New) Text Search as a CompanyDiscoveryProvider.
 *
 * Interactive discovery only: one page per explicit user action, no
 * background sweeps, no Place Details calls. Place IDs are the durable
 * identity; every other field is transient (see fields.ts).
 */

export type GooglePlacesConfig = {
  apiKey: string | null;
  /** Defaults to Google's endpoint; a loopback override exists only for local UI review (see registry). */
  endpoint?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  retries?: number;
};

const CAPABILITIES: ProviderCapabilities = {
  companyDiscovery: true,
  durableExternalId: true,
  durableCompanyFields: false,
  supportsPagination: true,
  supportsTextQuery: true,
  supportsGeographyText: true,
  maxPageSize: GOOGLE_MAX_PAGE_SIZE,
  fieldRetention: GOOGLE_PLACES_FIELD_RETENTION,
};

/** The Text Search body for an input (exported for tests). */
export function textSearchBody(input: DiscoverySearchInput): TextSearchBody {
  const body: TextSearchBody = {
    textQuery: composeTextQuery(input.query, input.geography),
    pageSize: clampPageSize(input.pageSize, GOOGLE_MAX_PAGE_SIZE),
  };
  if (input.cursor) body.pageToken = input.cursor;
  if (input.languageCode) body.languageCode = input.languageCode;
  const region = input.regionCode ?? input.geography?.countryCode ?? null;
  if (region && /^[A-Z]{2}$/.test(region)) body.regionCode = region;
  return body;
}

export function createGooglePlacesProvider(config: GooglePlacesConfig): CompanyDiscoveryProvider {
  const usage = (requestCount: number, resultCount: number, status: ProviderUsage["status"]): ProviderUsage => ({
    operation: "text_search",
    requestedFields: [...googlePlacesDiscoveryFields],
    requestCount,
    resultCount,
    status,
    skuHint: GOOGLE_TEXT_SEARCH_SKU_HINT,
    pricingReference: GOOGLE_PRICING_REFERENCE,
  });

  return {
    providerKey: GOOGLE_PLACES_PROVIDER_KEY,
    label: "Google Places",
    attribution: {
      text: "Google Maps",
      rankingNote:
        "Results and their order come from Google Maps. Google ranks local results using several factors, primarily relevance, distance and prominence. Vleeds does not change this order.",
    },
    isConfigured: () => !!config.apiKey,
    getCapabilities: () => CAPABILITIES,
    normalizeCandidate: mapPlace,

    async searchCompanies(input): Promise<DiscoverySearchResult> {
      if (!config.apiKey) return { ok: false, code: "not_configured", usage: null };
      const fetchImpl = config.fetch ?? (globalThis.fetch as unknown as FetchLike);
      const result = await textSearch(
        {
          apiKey: config.apiKey,
          endpoint: config.endpoint ?? GOOGLE_TEXT_SEARCH_URL,
          fetch: fetchImpl,
          timeoutMs: config.timeoutMs ?? 10_000,
          retries: config.retries ?? 1,
        },
        textSearchBody(input),
      );
      if (!result.ok) return { ok: false, code: result.status, usage: usage(result.requestCount, 0, result.status) };

      const page = mapTextSearchResponse(result.body);
      if (!page.ok) return { ok: false, code: "malformed", usage: usage(result.requestCount, 0, "malformed") };
      const status = page.candidates.length ? "ok" : "empty";
      return { ok: true, candidates: page.candidates, nextCursor: page.nextCursor, usage: usage(result.requestCount, page.candidates.length, status) };
    },
  };
}
