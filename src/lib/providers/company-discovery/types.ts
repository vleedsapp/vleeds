/**
 * Generic company-discovery provider contract (P1-E3).
 *
 * The rest of Vleeds depends only on these types; provider-specific request
 * and response shapes stay inside each adapter (e.g. ./google-places/).
 *
 * Providers differ in what their licence lets Vleeds KEEP. Every candidate
 * therefore says, per field, whether it is durable (may be stored) or
 * transient (may be shown during the interaction only). Nothing here assumes
 * "anything a provider returns may be stored permanently".
 */

export type FieldRetention = "durable" | "transient";

/** Fields a discovery candidate can carry. Future durable-data providers may fill more of them. */
export const CANDIDATE_FIELDS = ["externalId", "name", "address", "category", "website", "domain", "phone"] as const;
export type CandidateField = (typeof CANDIDATE_FIELDS)[number];

export type ProviderCapabilities = {
  companyDiscovery: boolean;
  /** The provider's record id may be stored indefinitely (used as the durable external identity). */
  durableExternalId: boolean;
  /** Company fields (name, website, …) may be stored as Vleeds company data. */
  durableCompanyFields: boolean;
  supportsPagination: boolean;
  supportsTextQuery: boolean;
  /** Geography is applied as text in the query (vs. structured location filters). */
  supportsGeographyText: boolean;
  /** Largest page the provider accepts. */
  maxPageSize: number;
  /** Retention of each field this provider returns (unlisted fields are not returned). */
  fieldRetention: Partial<Record<CandidateField, FieldRetention>>;
};

/** Structured geography (from the ICP target geographies or entered by the user). */
export type DiscoveryGeography = {
  countryCode: string;
  countryName: string;
  region: string | null;
  city: string | null;
  label: string | null;
};

export type DiscoverySearchInput = {
  query: string;
  geography: DiscoveryGeography | null;
  pageSize: number;
  /** Opaque, short-lived continuation cursor from the previous page. Never stored. */
  cursor?: string | null;
  languageCode?: string | null;
  regionCode?: string | null;
};

/** Provider-required attribution for one result (e.g. third-party data sources). */
export type ResultAttribution = { provider: string; uri: string | null };

/**
 * A candidate as the rest of Vleeds sees it. `display` holds provider content
 * that may be TRANSIENT (see fieldRetention): it can live in server memory and
 * the browser's state for the active search, never in database columns unless
 * the field is durable.
 */
export type DiscoveryCandidate = {
  providerKey: string;
  externalId: string;
  display: {
    name: string | null;
    address: string | null;
    category: string | null;
  };
  sourceUrl: string | null;
  attributions: ResultAttribution[];
  fieldRetention: Partial<Record<CandidateField, FieldRetention>>;
};

/** Generic status categories for usage accounting and user-facing errors. */
export const PROVIDER_STATUSES = ["ok", "empty", "timeout", "rate_limited", "setup", "invalid_request", "unavailable", "malformed"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
export type ProviderErrorCode = Exclude<ProviderStatus, "ok" | "empty"> | "not_configured";

/** What one search call cost, in provider-neutral terms. Never contains keys or payloads. */
export type ProviderUsage = {
  operation: string;
  requestedFields: string[];
  requestCount: number;
  resultCount: number;
  status: ProviderStatus;
  skuHint: string | null;
  pricingReference: string | null;
};

export type DiscoverySearchResult =
  | { ok: true; candidates: DiscoveryCandidate[]; nextCursor: string | null; usage: ProviderUsage }
  /** usage is null when no request was made (e.g. not configured). */
  | { ok: false; code: ProviderErrorCode; usage: ProviderUsage | null };

/** Attribution the provider requires next to its content. */
export type ProviderAttribution = {
  /** Text shown with the results, e.g. "Google Maps". Must not be translated or altered. */
  text: string;
  /** Short explanation of how the provider ranks results (shown on demand). */
  rankingNote: string;
};

export interface CompanyDiscoveryProvider {
  readonly providerKey: string;
  readonly label: string;
  readonly attribution: ProviderAttribution;
  /** False when server configuration (e.g. an API key) is missing; no request is then made. */
  isConfigured(): boolean;
  getCapabilities(): ProviderCapabilities;
  searchCompanies(input: DiscoverySearchInput): Promise<DiscoverySearchResult>;
  /** Maps one provider-specific result into the generic candidate (null if it lacks a usable id). */
  normalizeCandidate(providerResult: unknown): DiscoveryCandidate | null;
}
