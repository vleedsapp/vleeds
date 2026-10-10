import { normalizeCompanyName, normalizeDomain, normalizeEmail, normalizePersonName, normalizePhone } from "./normalize";

/**
 * Deterministic identity rules for future ingestion (P1-E2 manual/CSV,
 * P1-E3 discovery). No fuzzy or ML matching: only exact comparisons of
 * normalized values, ranked by how strongly each identifies a record.
 *
 * Callers pass the records of ONE workspace. The same real-world company in
 * two workspaces is two independent records, by design.
 *
 * Outcomes:
 *   match  — a strong identifier agrees; safe to attach to the existing record
 *   review — a weaker signal agrees; a person should decide (merge/skip/create)
 *   new    — nothing agrees; create a new record
 */

export type ExternalIdentity = { providerKey: string; externalRecordId: string };

export type MatchOutcome<Reason extends string> =
  | { outcome: "match"; id: string; reason: Reason }
  | { outcome: "review"; ids: string[]; reason: Reason }
  | { outcome: "new" };

const sameExternal = (a: ExternalIdentity, b: ExternalIdentity) =>
  a.providerKey === b.providerKey && a.externalRecordId === b.externalRecordId;

const unique = (ids: string[]) => [...new Set(ids)];

// -----------------------------------------------------------------------------
// Companies
// -----------------------------------------------------------------------------

export type KnownCompany = {
  id: string;
  primaryDomain: string | null;
  primaryPhoneNormalized: string | null;
  normalizedName: string;
  location: { countryCode?: string | null; region?: string | null; city?: string | null } | null;
  externalIds: ExternalIdentity[];
};

export type CompanyCandidate = {
  name: string;
  domain?: string | null;
  websiteUrl?: string | null;
  phone?: string | null;
  location?: { countryCode?: string | null; region?: string | null; city?: string | null } | null;
  external?: ExternalIdentity | null;
};

export type CompanyMatchReason = "external_id" | "domain" | "phone" | "name_location";

/** Same country and the same city (or, without cities, the same region). */
function sameLocation(a: CompanyCandidate["location"], b: KnownCompany["location"]): boolean {
  if (!a?.countryCode || !b?.countryCode || a.countryCode.toUpperCase() !== b.countryCode.toUpperCase()) return false;
  const k = (v?: string | null) => (v ? normalizeCompanyName(v) : "");
  if (k(a.city) && k(b.city)) return k(a.city) === k(b.city);
  if (k(a.region) && k(b.region)) return k(a.region) === k(b.region);
  return false;
}

/**
 * Hierarchy: 1 provider identity → 2 domain → 3 phone → 4 name + location → new.
 * Only 1 and 2 are automatic matches. A shared phone or the same name in the
 * same place are strong hints but not proof (switchboards, franchises,
 * namesakes), so they go to review. A similar name alone never matches.
 */
export function matchCompany(candidate: CompanyCandidate, known: KnownCompany[]): MatchOutcome<CompanyMatchReason> {
  if (candidate.external) {
    const hit = known.find((c) => c.externalIds.some((e) => sameExternal(e, candidate.external!)));
    if (hit) return { outcome: "match", id: hit.id, reason: "external_id" };
  }

  const domain = normalizeDomain(candidate.domain) ?? normalizeDomain(candidate.websiteUrl);
  if (domain) {
    const hit = known.find((c) => c.primaryDomain === domain);
    if (hit) return { outcome: "match", id: hit.id, reason: "domain" };
  }

  const phone = normalizePhone(candidate.phone);
  if (phone) {
    const hits = known.filter((c) => c.primaryPhoneNormalized === phone);
    if (hits.length) return { outcome: "review", ids: unique(hits.map((c) => c.id)), reason: "phone" };
  }

  const name = normalizeCompanyName(candidate.name);
  const hits = known.filter((c) => c.normalizedName === name && sameLocation(candidate.location, c.location));
  if (hits.length) return { outcome: "review", ids: unique(hits.map((c) => c.id)), reason: "name_location" };

  return { outcome: "new" };
}

// -----------------------------------------------------------------------------
// Contacts
// -----------------------------------------------------------------------------

export type KnownContact = {
  id: string;
  companyId: string;
  fullName: string;
  normalizedEmail: string | null;
  externalIds: ExternalIdentity[];
};

export type ContactCandidate = {
  fullName: string;
  companyId: string;
  email?: string | null;
  phone?: string | null;
  external?: ExternalIdentity | null;
};

export type ContactMatchReason = "email" | "external_id" | "name_company";

/**
 * Hierarchy: 1 email → 2 provider identity → 3 same name at the same company
 * (review) → new. Phone numbers are never used: colleagues share lines.
 */
export function matchContact(candidate: ContactCandidate, known: KnownContact[]): MatchOutcome<ContactMatchReason> {
  const email = normalizeEmail(candidate.email);
  if (email) {
    const hit = known.find((c) => c.normalizedEmail === email);
    if (hit) return { outcome: "match", id: hit.id, reason: "email" };
  }

  if (candidate.external) {
    const hit = known.find((c) => c.externalIds.some((e) => sameExternal(e, candidate.external!)));
    if (hit) return { outcome: "match", id: hit.id, reason: "external_id" };
  }

  const name = normalizePersonName(candidate.fullName);
  const hits = known.filter((c) => c.companyId === candidate.companyId && normalizePersonName(c.fullName) === name);
  if (hits.length) return { outcome: "review", ids: unique(hits.map((c) => c.id)), reason: "name_company" };

  return { outcome: "new" };
}
