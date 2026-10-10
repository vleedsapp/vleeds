import { z } from "zod";
import { isCountryCode } from "@/lib/config/countries";
import { SENIORITY_HINTS } from "@/lib/config/icp";
import { normalizeCompanyName, normalizeDomain, normalizeEmail, normalizePhone } from "./normalize";

/**
 * Lead-core validation (companies, contacts, evidence, scores, suppression).
 * Business-neutral: no industry, country, title or provider is known here.
 * Mirrors the CHECK constraints in 20261009000000_lead_core_foundation.sql;
 * input schemas also derive the normalized columns, so callers can't supply
 * them inconsistently.
 */

// -----------------------------------------------------------------------------
// Enumerations (generic product states)
// -----------------------------------------------------------------------------

export const QUALIFICATION_STATES = ["unreviewed", "needs_review", "qualified", "unqualified"] as const;
export type QualificationState = (typeof QUALIFICATION_STATES)[number];

export const CONTACT_STATUSES = ["active", "left_company", "unknown"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const SOURCE_KINDS = ["manual", "csv", "public_dataset", "website", "api", "other"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SCORE_STATUSES = ["pending", "scored", "stale", "excluded"] as const;
export type ScoreStatus = (typeof SCORE_STATUSES)[number];

export const GRADES = ["A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];

export const SUPPRESSION_SCOPES = ["company", "contact"] as const;
export type SuppressionScope = (typeof SUPPRESSION_SCOPES)[number];

/**
 * Documented evidence field identifiers. Others are allowed if they match
 * FIELD_KEY_RE (e.g. a future "company.category"); this list drives labels only.
 */
export const KNOWN_FIELD_KEYS = {
  "company.name": "Company name",
  "company.website": "Website",
  "company.domain": "Domain",
  "company.phone": "Phone",
  "company.location": "Location",
  "company.employee_range": "Employees",
  "company.industry": "Industry",
  "company.description": "Description",
  "company.tags": "Tags",
  "company.provider_reference": "Provider reference",
  "contact.name": "Contact name",
  "contact.title": "Job title",
  "contact.email": "Email",
  "contact.phone": "Contact phone",
  "contact.linkedin": "Profile URL",
  "contact.seniority": "Seniority",
  "contact.department": "Department",
  "contact.verification_status": "Email status",
  "contact.provider_decision_maker": "Decision maker (provider)",
} as const;

export const FIELD_KEY_RE = /^(company|contact)\.[a-z][a-z0-9_]{0,62}$/;
export const PROVIDER_KEY_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

// -----------------------------------------------------------------------------
// Building blocks
// -----------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .nullish()
    .transform((v) => (v ? v : null));

const httpUrl = (max = 2048) =>
  optionalText(max).refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), "Enter a full URL starting with https://");

const httpsUrl = (max = 2048) =>
  optionalText(max).refine((v) => v === null || /^https:\/\/[^\s]+$/i.test(v), "Enter a full URL starting with https://");

/** Display phone: kept as entered, within reason (any country format, extensions allowed). */
export const phoneField = optionalText(40).refine(
  (v) => v === null || (v.length >= 3 && /^[0-9+().\-\s/#*a-zA-Z]+$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 3),
  "Enter a phone number.",
);

const count = z.number("Enter a number.").int("Use a whole number.").min(0, "Use 0 or more.").max(10_000_000, "Too large.");

// -----------------------------------------------------------------------------
// Location
// -----------------------------------------------------------------------------

/** Generic structured location. Every field is optional; no country is assumed. */
export const locationSchema = z
  .strictObject({
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCountryCode, "Choose a country.")
      .nullish()
      .transform((v) => v ?? null),
    region: optionalText(120),
    city: optionalText(120),
    postalCode: optionalText(20),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
  })
  .transform((l) => (Object.values(l).every((v) => v === null) ? null : l));

export type CompanyLocation = NonNullable<z.output<typeof locationSchema>>;

// -----------------------------------------------------------------------------
// Company
// -----------------------------------------------------------------------------

export const companyInputSchema = z
  .strictObject({
    canonicalName: z.string().trim().min(1, "Enter a company name.").max(200, "Use 200 characters or fewer."),
    websiteUrl: httpUrl(),
    primaryDomain: optionalText(253),
    primaryPhone: phoneField,
    location: locationSchema.nullish().transform((v) => v ?? null),
    employeeCountMin: count.nullish().transform((v) => v ?? null),
    employeeCountMax: count.nullish().transform((v) => v ?? null),
    qualificationState: z.enum(QUALIFICATION_STATES).default("unreviewed"),
    qualificationReason: optionalText(500),
    notes: optionalText(5000),
    // P1-E4: provider-neutral descriptive fields (filled by enrichment providers or by hand).
    industry: optionalText(200),
    description: optionalText(2000),
  })
  .superRefine((c, ctx) => {
    if (c.employeeCountMin !== null && c.employeeCountMax !== null && c.employeeCountMin > c.employeeCountMax) {
      ctx.addIssue({ code: "custom", path: ["employeeCountMax"], message: "Maximum must be at least the minimum." });
    }
    if (c.primaryDomain !== null && normalizeDomain(c.primaryDomain) === null) {
      ctx.addIssue({ code: "custom", path: ["primaryDomain"], message: "Enter a domain like example.com." });
    }
    if (c.canonicalName && normalizeCompanyName(c.canonicalName) === "") {
      ctx.addIssue({ code: "custom", path: ["canonicalName"], message: "Enter a company name." });
    }
  })
  .transform((c) => ({
    ...c,
    normalizedName: normalizeCompanyName(c.canonicalName),
    // The domain comes from the explicit field, else from the website.
    primaryDomain: normalizeDomain(c.primaryDomain) ?? normalizeDomain(c.websiteUrl),
    primaryPhoneNormalized: normalizePhone(c.primaryPhone),
  }));

export type CompanyInput = z.output<typeof companyInputSchema>;

export const qualificationUpdateSchema = z.strictObject({
  state: z.enum(QUALIFICATION_STATES, "Choose a qualification state."),
  reason: optionalText(500),
});

// -----------------------------------------------------------------------------
// Contact
// -----------------------------------------------------------------------------

const contactShape = {
  firstName: optionalText(100),
  lastName: optionalText(100),
  fullName: optionalText(200),
  jobTitle: optionalText(200),
  seniority: z.enum(SENIORITY_HINTS, "Choose a seniority level.").nullish().transform((v) => v ?? null),
  email: optionalText(320).refine((v) => v === null || normalizeEmail(v) !== null, "Enter a valid email address."),
  phone: phoneField,
  linkedinUrl: httpsUrl(),
  isPrimary: z.boolean().default(false),
  status: z.enum(CONTACT_STATUSES).default("active"),
  notes: optionalText(5000),
};

function finishContact<T extends { firstName: string | null; lastName: string | null; fullName: string | null; email: string | null; phone: string | null }>(c: T) {
  return {
    ...c,
    // A contact needs a name; build it from parts when only parts are given.
    fullName: c.fullName ?? ([c.firstName, c.lastName].filter(Boolean).join(" ") || null),
    normalizedEmail: normalizeEmail(c.email),
    phoneNormalized: normalizePhone(c.phone),
  };
}

const NEEDS_NAME = { path: ["fullName"], message: "Enter the contact's name." };

/** A contact's own fields (no company yet): used by CSV rows, which resolve the company at commit. */
export const contactFieldsSchema = z
  .strictObject(contactShape)
  .transform(finishContact)
  .refine((c) => c.fullName !== null, NEEDS_NAME);

/** A contact for a known company (manual entry). */
export const contactInputSchema = z
  .strictObject({ companyId: z.uuid(), ...contactShape })
  .transform(finishContact)
  .refine((c) => c.fullName !== null, NEEDS_NAME);

export type ContactFields = z.output<typeof contactFieldsSchema>;
export type ContactInput = z.output<typeof contactInputSchema>;

// -----------------------------------------------------------------------------
// Source evidence
// -----------------------------------------------------------------------------

/** Small JSON only: the value as observed, not a provider payload. */
export const observedValueSchema = z
  .json()
  .refine((v) => JSON.stringify(v).length <= 2048, "Observed value is too large (2 KB max).");

export const leadSourceInputSchema = z
  .strictObject({
    companyId: z.uuid().nullish().transform((v) => v ?? null),
    contactId: z.uuid().nullish().transform((v) => v ?? null),
    sourceKind: z.enum(SOURCE_KINDS, "Choose a source kind."),
    providerKey: z
      .string()
      .trim()
      .toLowerCase()
      .regex(PROVIDER_KEY_RE, "Use lower-case letters, digits, '.', '_' or '-'.")
      .nullish()
      .transform((v) => v ?? null),
    externalRecordId: optionalText(256),
    sourceUrl: httpUrl(),
    fieldKey: z
      .string()
      .regex(FIELD_KEY_RE, "Use a field key like company.phone or contact.email.")
      .nullish()
      .transform((v) => v ?? null),
    observedValue: observedValueSchema.nullish().transform((v) => v ?? null),
    confidence: z.number().int().min(0, "Use 0 to 100.").max(100, "Use 0 to 100.").nullish().transform((v) => v ?? null),
    observedAt: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
  })
  .superRefine((s, ctx) => {
    if (!s.companyId && !s.contactId) {
      ctx.addIssue({ code: "custom", path: ["companyId"], message: "Evidence must belong to a company or a contact." });
    }
    if (s.externalRecordId && !s.providerKey) {
      ctx.addIssue({ code: "custom", path: ["providerKey"], message: "An external record id needs a provider key." });
    }
  });

export type LeadSourceInput = z.output<typeof leadSourceInputSchema>;

// -----------------------------------------------------------------------------
// Score storage
// -----------------------------------------------------------------------------

const part = z.number().min(0).max(100);

/** Optional explanation of a score. Small and fixed-shape; computed by the future scoring engine. */
export const scoreBreakdownSchema = z
  .strictObject({
    company_fit: part.optional(),
    geography_fit: part.optional(),
    decision_maker_fit: part.optional(),
    buying_signal_fit: part.optional(),
    exclusion_penalty: part.optional(),
  })
  .refine((b) => JSON.stringify(b).length <= 4096, "Breakdown is too large.");

export const leadScoreSchema = z
  .strictObject({
    companyId: z.uuid(),
    icpProfileId: z.uuid(),
    icpRevision: z.number().int().min(1),
    score: z.number().int().min(0, "Scores are 0 to 100.").max(100, "Scores are 0 to 100.").nullable(),
    grade: z.enum(GRADES, "Grades are A, B or C.").nullable(),
    breakdown: scoreBreakdownSchema.nullable(),
    status: z.enum(SCORE_STATUSES),
    scoredAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine((s, ctx) => {
    if (s.status === "scored" && (s.score === null || s.grade === null || s.scoredAt === null)) {
      ctx.addIssue({ code: "custom", path: ["status"], message: "A scored result needs a score, a grade and a time." });
    }
    if (s.status === "pending" && (s.score !== null || s.grade !== null)) {
      ctx.addIssue({ code: "custom", path: ["status"], message: "A pending result has no score or grade yet." });
    }
  });

export type LeadScore = z.output<typeof leadScoreSchema>;

// -----------------------------------------------------------------------------
// Suppression
// -----------------------------------------------------------------------------

export const suppressionInputSchema = z
  .strictObject({
    scope: z.enum(SUPPRESSION_SCOPES, "Choose company or contact."),
    companyId: z.uuid(),
    contactId: z.uuid().nullish().transform((v) => v ?? null),
    reason: optionalText(500),
  })
  .superRefine((s, ctx) => {
    if (s.scope === "company" && s.contactId !== null) {
      ctx.addIssue({ code: "custom", path: ["contactId"], message: "A company restriction applies to the whole company." });
    }
    if (s.scope === "contact" && s.contactId === null) {
      ctx.addIssue({ code: "custom", path: ["contactId"], message: "Choose the contact to restrict." });
    }
  });

export type SuppressionInput = z.output<typeof suppressionInputSchema>;
