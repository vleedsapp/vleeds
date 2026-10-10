import type { NormalizedCompany, NormalizedContact } from "./rows";

/**
 * Builds the column values and evidence that public.ingest_lead() writes.
 * Shared by manual entry (source "manual"), CSV commits (source "csv") and
 * provider enrichment (source "api", with the provider's identity).
 */

export type IngestSource = "manual" | "csv" | "api";

/** Provider identity stamped on evidence (provider_key + the provider's record id). */
export type EvidenceProvider = { providerKey: string; externalRecordId: string | null };

export type EvidenceItem = {
  subject: "company" | "contact";
  field_key: string;
  observed_value: unknown;
  source_kind: IngestSource;
  provider_key?: string;
  external_record_id?: string;
};

/** Insert values for a new company. Omits nulls so database defaults apply. */
export function companyColumns(c: NormalizedCompany): Record<string, unknown> {
  return dropNulls({
    canonical_name: c.canonicalName,
    normalized_name: c.normalizedName,
    website_url: c.websiteUrl,
    primary_domain: c.primaryDomain,
    primary_phone: c.primaryPhone,
    primary_phone_normalized: c.primaryPhoneNormalized,
    location: c.location,
    employee_count_min: c.employeeCountMin,
    employee_count_max: c.employeeCountMax,
    industry: c.industry,
    description: c.description,
    qualification_state: c.qualificationState ?? "unreviewed",
    notes: c.notes,
  });
}

export function contactColumns(c: NormalizedContact): Record<string, unknown> {
  return dropNulls({
    full_name: c.fullName,
    first_name: c.firstName,
    last_name: c.lastName,
    job_title: c.jobTitle,
    seniority: c.seniority,
    email: c.email,
    normalized_email: c.normalizedEmail,
    phone: c.phone,
    phone_normalized: c.phoneNormalized,
    linkedin_url: c.linkedinUrl,
    notes: c.notes,
  });
}

/**
 * One evidence item per non-empty observed field (never for empty values, and
 * never the whole row or provider payload). Values are the text as received,
 * kept small by the field length limits. With a provider, every item carries
 * its provider key and record id.
 */
export function evidenceFor(
  company: NormalizedCompany | null,
  contact: NormalizedContact | null,
  source: IngestSource,
  provider?: EvidenceProvider,
): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const add = (subject: EvidenceItem["subject"], field_key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    const item: EvidenceItem = { subject, field_key, observed_value: fitEvidence(value), source_kind: source };
    if (provider) {
      item.provider_key = provider.providerKey;
      if (provider.externalRecordId) item.external_record_id = provider.externalRecordId;
    }
    out.push(item);
  };
  if (company) {
    add("company", "company.name", company.canonicalName);
    add("company", "company.website", company.websiteUrl);
    add("company", "company.domain", company.primaryDomain);
    add("company", "company.phone", company.primaryPhone);
    add("company", "company.location", company.location);
    if (company.employeeCountMin !== null || company.employeeCountMax !== null) {
      add("company", "company.employee_range", dropNulls({ min: company.employeeCountMin, max: company.employeeCountMax }));
    }
    add("company", "company.industry", company.industry);
    add("company", "company.description", company.description);
  }
  if (contact) {
    add("contact", "contact.name", contact.fullName);
    add("contact", "contact.title", contact.jobTitle);
    add("contact", "contact.seniority", contact.seniority);
    add("contact", "contact.email", contact.email);
    add("contact", "contact.phone", contact.phone);
    add("contact", "contact.linkedin", contact.linkedinUrl);
  }
  return out;
}

/** Evidence values are capped at 2 KB (lead_sources CHECK); long text (e.g. descriptions) is shortened to fit. */
const EVIDENCE_BYTES = 2000;
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
export function fitEvidence(value: unknown): unknown {
  if (typeof value !== "string" || bytes(value) <= EVIDENCE_BYTES) return value;
  let s = value;
  while (s.length > 0 && bytes(`${s}…`) > EVIDENCE_BYTES) s = s.slice(0, Math.floor(s.length * 0.9));
  return `${s.trimEnd()}…`;
}

function dropNulls<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}
