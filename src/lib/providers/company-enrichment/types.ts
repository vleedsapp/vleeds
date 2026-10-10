/**
 * Generic company-ENRICHMENT provider contract (P1-E4).
 *
 * Discovery providers answer "what businesses exist?"; enrichment providers
 * answer "what durable company data may Vleeds keep about this business?".
 * The rest of Vleeds depends only on these types: provider request/response
 * shapes stay inside each adapter folder (e.g. ./hunter/).
 *
 * Everything an enrichment provider returns through this contract is meant to
 * be DURABLE company-level data (the adapter decides which provider fields
 * qualify). No personal data, no contact records, no raw payloads.
 */

export type EnrichmentCapabilities = {
  companyEnrichment: boolean;
  /** Can suggest a company's domain from its name. */
  domainResolution: boolean;
  /** Returned company fields may be stored as Vleeds company data. */
  durableCompanyFields: boolean;
  /** The provider's company id may be stored as a durable external identity. */
  durableExternalId: boolean;
  /** The provider charges in credits (Vleeds records an ESTIMATE per call). */
  usageCredits: boolean;
};

/** One suggested domain for a company name (not stored; shown for the user to choose). */
export type DomainSuggestion = {
  domain: string;
  companyName: string | null;
  /** Short, provider-neutral hint such as "Exact name match". Optional. */
  confidenceLabel?: string | null;
  /** Number of public addresses the provider knows for the domain (a size hint only; never the addresses). */
  emailCount?: number | null;
};

/** Structured location in the generic Vleeds shape (no country assumed). */
export type EnrichedLocation = {
  countryCode: string | null;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  addressLine1: string | null;
};

/**
 * Durable company data, already mapped to Vleeds' provider-neutral fields
 * (still to be validated/normalized by the lead-core schemas before use).
 */
export type EnrichedCompany = {
  providerKey: string;
  /** Provider's stable company id, if it returned one (stored only as lead_sources identity). */
  externalId: string | null;
  name: string | null;
  domain: string;
  websiteUrl: string | null;
  phone: string | null;
  location: EnrichedLocation | null;
  employeeCountMin: number | null;
  employeeCountMax: number | null;
  industry: string | null;
  description: string | null;
  /** Short descriptive tags; kept as source evidence only. */
  tags: string[];
};

/** Generic status categories (usage accounting + user-facing messages). */
export const ENRICHMENT_STATUSES = [
  "ok",
  "empty",
  "timeout",
  "rate_limited",
  "quota_exhausted",
  "setup",
  "invalid_request",
  "unavailable",
  "malformed",
  "restricted",
] as const;
export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number];

/** Why a call produced no data. "not_found" = the provider has no record (not an application failure). */
export type EnrichmentErrorCode = Exclude<EnrichmentStatus, "ok" | "empty"> | "not_found" | "no_suggestions" | "not_configured";

/** What one provider call cost, in provider-neutral terms. Never contains keys or payloads. */
export type EnrichmentUsage = {
  operation: "domain_finder" | "company_enrichment";
  requestCount: number;
  resultCount: number;
  status: EnrichmentStatus;
  /** 1000 = one provider credit, ESTIMATED from the documented rule; 0 = not chargeable; null = unknown. */
  estimatedCreditMillis: number | null;
  /** Human-readable charge rule the estimate came from (documentation, may change). */
  creditRule: string | null;
};

export type DomainResolutionResult =
  | { ok: true; suggestions: DomainSuggestion[]; usage: EnrichmentUsage }
  | { ok: false; code: EnrichmentErrorCode; usage: EnrichmentUsage | null };

export type CompanyEnrichmentResult =
  | { ok: true; company: EnrichedCompany; usage: EnrichmentUsage }
  | { ok: false; code: EnrichmentErrorCode; usage: EnrichmentUsage | null };

/** Estimated credits for one successful, chargeable company enrichment (for the confirm button). */
export type CreditEstimate = { millis: number; rule: string };

export interface CompanyEnrichmentProvider {
  readonly providerKey: string;
  readonly label: string;
  /** False when server configuration (e.g. an API key) is missing; no request is then made. */
  isConfigured(): boolean;
  getCapabilities(): EnrichmentCapabilities;
  /** What a successful company enrichment is expected to cost (null if the provider doesn't charge credits). */
  enrichmentCreditEstimate(): CreditEstimate | null;
  resolveDomain(input: { companyName: string; limit?: number }): Promise<DomainResolutionResult>;
  enrichCompany(input: { domain: string }): Promise<CompanyEnrichmentResult>;
  /** Maps one provider-specific company payload into the generic shape (null if unusable). */
  normalizeCompany(raw: unknown): EnrichedCompany | null;
}
