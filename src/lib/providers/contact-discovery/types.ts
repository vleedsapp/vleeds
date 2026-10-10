/**
 * Generic professional CONTACT-DISCOVERY provider contract (P1-E5).
 *
 * Company discovery answers "what businesses exist?", company enrichment
 * "what is this company?"; contact discovery answers "who are the relevant
 * professional people at this company?". The rest of Vleeds depends only on
 * these types; provider request/response shapes stay inside each adapter
 * folder (e.g. ./hunter/).
 *
 * Everything a provider returns through this contract is minimal
 * professional data for review, deduplication and contact creation. No raw
 * payloads, no consumer data.
 */

export type ContactDiscoveryCapabilities = {
  contactDiscovery: boolean;
  titleFiltering: boolean;
  seniorityFiltering: boolean;
  departmentFiltering: boolean;
  decisionMakerFiltering: boolean;
  returnsProfessionalEmail: boolean;
  returnsPhoneSometimes: boolean;
  returnsLinkedInSometimes: boolean;
  usageCredits: boolean;
  /** Most results one search may return (Vleeds asks for at most this many). */
  maxResults: number;
  /** Most job titles one search may carry. */
  maxTitles: number;
};

export type ContactSearchInput = {
  /** The company's stored, normalized domain (re-read on the server). */
  domain: string;
  /** Job titles to search for (already selected, de-duplicated and ordered). */
  titles: string[];
  /** Ask the provider for people it classifies as decision makers only. */
  decisionMakerOnly: boolean;
  limit: number;
  /** Optional provider-neutral filters (passed through when the provider supports them). */
  seniority?: string[];
  department?: string[];
};

/** Email verification as the provider reported it (never upgraded or reinterpreted by Vleeds). */
export const VERIFICATION_STATUSES = ["valid", "accept_all", "unknown", "invalid"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** One professional person found by a search, in provider-neutral form. */
export type ContactCandidate = {
  providerKey: string;
  /** Only a real, stable provider record id; null when the provider has none. */
  externalId: string | null;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string;
  normalizedEmail: string;
  phone: string | null;
  linkedinUrl: string | null;
  /** The provider's own seniority label (context/evidence; not the Vleeds seniority model). */
  providerSeniority: string | null;
  providerDepartment: string | null;
  providerDecisionMaker: boolean | null;
  verificationStatus: VerificationStatus | null;
  /** Provider confidence in the EMAIL (0–100); not role fit. */
  confidence: number | null;
  /** Small summary of the provider's public sources (no URLs). */
  sourceCount: number | null;
  lastSeenOn: string | null;
};

export const CONTACT_PROVIDER_STATUSES = ["ok", "empty", "timeout", "rate_limited", "quota_exhausted", "setup", "invalid_request", "unavailable", "malformed", "restricted"] as const;
export type ContactProviderStatus = (typeof CONTACT_PROVIDER_STATUSES)[number];
export type ContactSearchErrorCode = Exclude<ContactProviderStatus, "ok" | "empty"> | "not_configured";

export type ContactSearchUsage = {
  operation: string;
  requestCount: number;
  resultCount: number;
  status: ContactProviderStatus;
  /** 1000 = one provider credit, ESTIMATED from the documented rule; 0 = not chargeable; null = unknown. */
  estimatedCreditMillis: number | null;
  creditRule: string | null;
};

export type ContactSearchResult =
  | {
      ok: true;
      candidates: ContactCandidate[];
      /** Results the provider returned that could not be used (no name or no usable email); not stored. */
      skipped: number;
      usage: ContactSearchUsage;
    }
  | { ok: false; code: ContactSearchErrorCode; usage: ContactSearchUsage | null };

export interface ContactDiscoveryProvider {
  readonly providerKey: string;
  readonly label: string;
  isConfigured(): boolean;
  getCapabilities(): ContactDiscoveryCapabilities;
  /** What one search with results is expected to cost (null if the provider doesn't charge credits). */
  searchCreditEstimate(): { millis: number; rule: string } | null;
  searchContacts(input: ContactSearchInput): Promise<ContactSearchResult>;
  /** Maps one provider-specific person into the generic candidate (null if unusable). */
  normalizeCandidate(raw: unknown): ContactCandidate | null;
}
