import { countryOptions, isCountryCode } from "@/lib/config/countries";
import { SENIORITY_HINTS, type SeniorityHint } from "@/lib/config/icp";
import {
  companyInputSchema,
  contactFieldsSchema,
  QUALIFICATION_STATES,
  type CompanyLocation,
  type QualificationState,
} from "@/lib/lead-core/schemas";
import { CONTACT_FIELD_KEYS, type ColumnMapping, type ImportFieldKey } from "./fields";
import { IMPORT_LIMITS } from "./limits";

/**
 * One staged row → normalized company/contact + issues. All normalization and
 * validation is delegated to the lead-core schemas (src/lib/lead-core), the
 * same ones manual entry uses; this file only maps CSV text onto them.
 */

export type NormalizedCompany = {
  canonicalName: string;
  normalizedName: string;
  websiteUrl: string | null;
  primaryDomain: string | null;
  primaryPhone: string | null;
  primaryPhoneNormalized: string | null;
  location: CompanyLocation | null;
  employeeCountMin: number | null;
  employeeCountMax: number | null;
  /** null = not provided (merges keep the existing state; creates use "unreviewed"). */
  qualificationState: QualificationState | null;
  notes: string | null;
  /** P1-E4 (enrichment). Optional so CSV/manual rows need not carry them. */
  industry?: string | null;
  description?: string | null;
};

export type NormalizedContact = {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  seniority: SeniorityHint | null;
  email: string | null;
  normalizedEmail: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  linkedinUrl: string | null;
  notes: string | null;
};

export type RowIssue = { level: "error" | "warning"; field: ImportFieldKey | "row"; message: string };

/** What is stored in import_rows.normalized_data. `mapped` keeps the mapped text for display. */
export type StagedRow = {
  mapped: Partial<Record<ImportFieldKey, string>>;
  company: NormalizedCompany | null;
  contact: NormalizedContact | null;
};

export type BuiltRow = StagedRow & { issues: RowIssue[]; valid: boolean };

const COMPANY_PATHS: Record<string, ImportFieldKey> = {
  canonicalName: "company_name",
  websiteUrl: "website",
  primaryDomain: "domain",
  primaryPhone: "phone",
  employeeCountMin: "employees_min",
  employeeCountMax: "employees_max",
  notes: "company_notes",
  "location.countryCode": "country",
  "location.region": "region",
  "location.city": "city",
  "location.postalCode": "postal_code",
  "location.addressLine1": "address_line1",
  "location.addressLine2": "address_line2",
};

const CONTACT_PATHS: Record<string, ImportFieldKey> = {
  fullName: "contact_name",
  firstName: "contact_first_name",
  lastName: "contact_last_name",
  jobTitle: "contact_title",
  email: "contact_email",
  phone: "contact_phone",
  linkedinUrl: "contact_profile",
  notes: "contact_notes",
};

let countryByName: Map<string, string> | null = null;

/** ISO code or English country name → ISO code (null if unknown). */
export function resolveCountry(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length === 2 && isCountryCode(v.toUpperCase())) return v.toUpperCase();
  countryByName ??= new Map(countryOptions().map((c) => [c.name.toLowerCase(), c.code]));
  return countryByName.get(v.toLowerCase()) ?? null;
}

const labelKey = (v: string) => v.trim().toLowerCase().replace(/[\s_-]+/g, "_");

/** Accepts state keys and their labels ("Needs review", "needs_review"). */
export function resolveQualification(value: string): QualificationState | null {
  const k = labelKey(value);
  return (QUALIFICATION_STATES as readonly string[]).includes(k) ? (k as QualificationState) : null;
}

export function resolveSeniority(value: string): SeniorityHint | null {
  const k = labelKey(value);
  return (SENIORITY_HINTS as readonly string[]).includes(k) ? (k as SeniorityHint) : null;
}

/** "1,200" / "1 200" / "250" → number; "" → null; anything else → NaN (reported as an error). */
export function parseCount(value: string | undefined): number | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const digits = v.replace(/[\s,'’]/g, "");
  return /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
}

/** Maps the cells of one row to field texts (only mapped, non-empty columns). */
export function mapCells(cells: string[], mapping: ColumnMapping): Partial<Record<ImportFieldKey, string>> {
  const out: Partial<Record<ImportFieldKey, string>> = {};
  mapping.forEach((key, i) => {
    if (!key) return;
    const v = (cells[i] ?? "").trim();
    if (v) out[key] = v;
  });
  return out;
}

export function buildRow(cells: string[], mapping: ColumnMapping): BuiltRow {
  const m = mapCells(cells, mapping);
  const issues: RowIssue[] = [];
  const err = (field: ImportFieldKey | "row", message: string) => issues.push({ level: "error", field, message });
  const warn = (field: ImportFieldKey | "row", message: string) => issues.push({ level: "warning", field, message });

  for (const [key, value] of Object.entries(m) as [ImportFieldKey, string][]) {
    if (value.length > IMPORT_LIMITS.maxCellChars) err(key, `Value is longer than ${IMPORT_LIMITS.maxCellChars} characters.`);
  }

  // ---- company ---------------------------------------------------------------
  let company: NormalizedCompany | null = null;
  const hasContactData = CONTACT_FIELD_KEYS.some((k) => m[k]);
  if (!m.company_name) {
    err("company_name", hasContactData ? "Missing company name. Contacts must belong to a company." : "Missing company name.");
  } else {
    let countryCode: string | null = null;
    if (m.country) {
      countryCode = resolveCountry(m.country);
      if (!countryCode) warn("country", `Unknown country “${m.country}”; it was left out.`);
    }
    let qualification: QualificationState | null = null;
    if (m.qualification) {
      qualification = resolveQualification(m.qualification);
      if (!qualification) warn("qualification", `Unsupported qualification “${m.qualification}”; it was left out.`);
    }
    const parsed = companyInputSchema.safeParse({
      canonicalName: m.company_name,
      websiteUrl: m.website ?? null,
      primaryDomain: m.domain ?? null,
      primaryPhone: m.phone ?? null,
      location: {
        countryCode,
        region: m.region ?? null,
        city: m.city ?? null,
        postalCode: m.postal_code ?? null,
        addressLine1: m.address_line1 ?? null,
        addressLine2: m.address_line2 ?? null,
      },
      employeeCountMin: parseCount(m.employees_min),
      employeeCountMax: parseCount(m.employees_max),
      qualificationState: qualification ?? undefined,
      notes: m.company_notes ?? null,
    });
    if (parsed.success) {
      const c = parsed.data;
      if (m.website && m.domain && c.primaryDomain && !m.website.toLowerCase().includes(c.primaryDomain)) {
        warn("website", "Website and domain point to different hosts; the domain is used for matching.");
      }
      if (m.phone && !c.primaryPhoneNormalized) {
        warn("phone", "Phone kept as entered; it can't be compared for duplicates without an international prefix (+…).");
      }
      company = {
        canonicalName: c.canonicalName,
        normalizedName: c.normalizedName,
        websiteUrl: c.websiteUrl,
        primaryDomain: c.primaryDomain,
        primaryPhone: c.primaryPhone,
        primaryPhoneNormalized: c.primaryPhoneNormalized,
        location: c.location,
        employeeCountMin: c.employeeCountMin,
        employeeCountMax: c.employeeCountMax,
        qualificationState: qualification,
        notes: c.notes,
      };
    } else {
      for (const issue of parsed.error.issues) {
        const path = issue.path.map(String).join(".");
        const field = COMPANY_PATHS[path] ?? COMPANY_PATHS[path.split(".")[0]] ?? "row";
        const message =
          field === "employees_min" || field === "employees_max"
            ? issue.message === "Enter a number."
              ? "Use a whole number of employees."
              : issue.message
            : issue.message;
        err(field, message);
      }
    }
  }

  // ---- contact ---------------------------------------------------------------
  let contact: NormalizedContact | null = null;
  if (hasContactData) {
    let seniority: SeniorityHint | null = null;
    if (m.contact_seniority) {
      seniority = resolveSeniority(m.contact_seniority);
      if (!seniority) warn("contact_seniority", `Unsupported seniority “${m.contact_seniority}”; it was left out.`);
    }
    const parsed = contactFieldsSchema.safeParse({
      fullName: m.contact_name ?? null,
      firstName: m.contact_first_name ?? null,
      lastName: m.contact_last_name ?? null,
      jobTitle: m.contact_title ?? null,
      seniority,
      email: m.contact_email ?? null,
      phone: m.contact_phone ?? null,
      linkedinUrl: m.contact_profile ?? null,
      notes: m.contact_notes ?? null,
    });
    if (parsed.success) {
      const c = parsed.data;
      contact = {
        fullName: c.fullName!,
        firstName: c.firstName,
        lastName: c.lastName,
        jobTitle: c.jobTitle,
        seniority: c.seniority,
        email: c.email,
        normalizedEmail: c.normalizedEmail,
        phone: c.phone,
        phoneNormalized: c.phoneNormalized,
        linkedinUrl: c.linkedinUrl,
        notes: c.notes,
      };
    } else {
      for (const issue of parsed.error.issues) {
        const path = issue.path.map(String).join(".");
        const field = CONTACT_PATHS[path] ?? "row";
        err(field, field === "contact_name" ? "Contact has no name (map a full name or first/last name)." : issue.message);
      }
    }
  }

  const valid = !issues.some((i) => i.level === "error");
  return { mapped: m, company: valid ? company : null, contact: valid ? contact : null, issues, valid };
}
