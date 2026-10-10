import { normalizeEmail } from "@/lib/lead-core/normalize";
import { VERIFICATION_STATUSES, type ContactCandidate, type VerificationStatus } from "../types";
import { domainSearchResponseSchema, personSchema } from "./schemas";
import { HUNTER_PROVIDER_KEY } from "./usage";

/**
 * Hunter Domain Search → generic contact candidates. Only professional fields
 * Vleeds uses are mapped; the rest of the response (company pattern and
 * organization data, twitter, source URLs/pages, aggregations) is dropped here.
 */

const clip = (v: string | null | undefined, max: number): string | null => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t && t.length <= max ? t : t ? t.slice(0, max).trim() : null;
};

const label = (v: string | null | undefined, max: number): string | null => {
  const t = v?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return t && new RegExp(`^[a-z_]{1,${max}}$`).test(t) ? t : null;
};

/** Hunter's verification status as reported; anything else is "not provided" (never upgraded). */
export function verificationStatus(v: string | null | undefined): VerificationStatus | null {
  const t = v?.trim().toLowerCase();
  return (VERIFICATION_STATUSES as readonly string[]).includes(t ?? "") ? (t as VerificationStatus) : null;
}

/** A professional profile URL only if it is already a full https URL (nothing is built or fetched). */
export function profileUrl(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t && t.length <= 2048 && /^https:\/\/[^\s]+$/i.test(t) ? t : null;
}

/** A display phone in a plausible shape (normalized later by the lead-core rules; never an identity). */
export function displayPhone(v: string | null | undefined): string | null {
  const t = clip(v, 40);
  return t && /^[0-9+().\-\s/#*a-zA-Z]+$/.test(t) && (t.match(/\d/g)?.length ?? 0) >= 3 ? t : null;
}

export function mapPerson(raw: unknown): ContactCandidate | null {
  const parsed = personSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.type && p.type !== "personal") return null; // generic inboxes are not people
  const email = clip(p.value, 320);
  const normalizedEmail = normalizeEmail(email);
  if (!email || !normalizedEmail) return null;
  const firstName = clip(p.first_name, 100);
  const lastName = clip(p.last_name, 100);
  const fullName = clip([firstName, lastName].filter(Boolean).join(" "), 200);
  if (!fullName) return null; // a contact needs a name; Vleeds never invents one from the email
  const confidence = typeof p.confidence === "number" && Number.isFinite(p.confidence) && p.confidence >= 0 && p.confidence <= 100 ? Math.round(p.confidence) : null;
  const seen = (p.sources ?? []).map((s) => s.last_seen_on ?? "").filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return {
    providerKey: HUNTER_PROVIDER_KEY,
    // Domain Search has no stable per-person record id; never derived from array positions.
    externalId: null,
    fullName,
    firstName,
    lastName,
    jobTitle: clip(p.position, 200),
    email,
    normalizedEmail,
    phone: displayPhone(p.phone_number),
    linkedinUrl: profileUrl(p.linkedin),
    providerSeniority: label(p.seniority, 40),
    providerDepartment: label(p.department, 60),
    providerDecisionMaker: typeof p.decision_maker === "boolean" ? p.decision_maker : null,
    verificationStatus: verificationStatus(p.verification?.status),
    confidence,
    sourceCount: p.sources ? Math.min(p.sources.length, 10000) : null,
    lastSeenOn: seen.length ? seen[seen.length - 1] : null,
  };
}

export type MappedSearch = { ok: true; candidates: ContactCandidate[]; returned: number; skipped: number } | { ok: false };

/** Maps a parsed body: unusable people are skipped (counted), duplicate emails removed, at most `limit` kept. */
export function mapDomainSearchResponse(body: unknown, limit: number): MappedSearch {
  const parsed = domainSearchResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  const all = parsed.data.data.emails ?? [];
  const seen = new Set<string>();
  const candidates: ContactCandidate[] = [];
  let skipped = 0;
  for (const raw of all) {
    const c = mapPerson(raw);
    if (!c || seen.has(c.normalizedEmail) || candidates.length >= limit) {
      skipped++;
      continue;
    }
    seen.add(c.normalizedEmail);
    candidates.push(c);
  }
  return { ok: true, candidates, returned: all.length, skipped };
}
