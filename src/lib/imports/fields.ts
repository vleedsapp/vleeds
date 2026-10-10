import { z } from "zod";

/**
 * Vleeds fields a CSV column can be mapped to. Generic: no industry, title or
 * provider-specific columns. Every field is optional except the company name.
 */
export const IMPORT_FIELDS = [
  { key: "company_name", label: "Company name", group: "company" },
  { key: "website", label: "Website", group: "company" },
  { key: "domain", label: "Primary domain", group: "company" },
  { key: "phone", label: "Primary phone", group: "company" },
  { key: "country", label: "Country", group: "company" },
  { key: "region", label: "Region / state / province", group: "company" },
  { key: "city", label: "City", group: "company" },
  { key: "postal_code", label: "Postal code", group: "company" },
  { key: "address_line1", label: "Address line 1", group: "company" },
  { key: "address_line2", label: "Address line 2", group: "company" },
  { key: "employees_min", label: "Employee minimum", group: "company" },
  { key: "employees_max", label: "Employee maximum", group: "company" },
  { key: "qualification", label: "Qualification state", group: "company" },
  { key: "company_notes", label: "Company notes", group: "company" },
  { key: "contact_name", label: "Contact full name", group: "contact" },
  { key: "contact_first_name", label: "Contact first name", group: "contact" },
  { key: "contact_last_name", label: "Contact last name", group: "contact" },
  { key: "contact_title", label: "Job title", group: "contact" },
  { key: "contact_seniority", label: "Seniority", group: "contact" },
  { key: "contact_email", label: "Contact email", group: "contact" },
  { key: "contact_phone", label: "Contact phone", group: "contact" },
  { key: "contact_profile", label: "Profile URL", group: "contact" },
  { key: "contact_notes", label: "Contact notes", group: "contact" },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export const IMPORT_FIELD_KEYS = IMPORT_FIELDS.map((f) => f.key) as unknown as readonly [ImportFieldKey, ...ImportFieldKey[]];
export const CONTACT_FIELD_KEYS: ImportFieldKey[] = IMPORT_FIELDS.filter((f) => f.group === "contact").map((f) => f.key);

export function fieldLabelFor(key: ImportFieldKey | "row"): string {
  return key === "row" ? "Row" : (IMPORT_FIELDS.find((f) => f.key === key)?.label ?? key);
}

/**
 * Column mapping: one entry per CSV column (by position), a field key or
 * null for "Ignore". Each field may be used by at most one column, and the
 * company name must be mapped.
 */
export const columnMappingSchema = z
  .array(z.enum(IMPORT_FIELD_KEYS).nullable())
  .min(1)
  .max(100)
  .superRefine((mapping, ctx) => {
    const seen = new Map<string, number>();
    mapping.forEach((key, i) => {
      if (!key) return;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: [i], message: `${fieldLabelFor(key)} is already mapped to another column.` });
      }
      seen.set(key, i);
    });
    if (!mapping.includes("company_name")) {
      ctx.addIssue({ code: "custom", path: [], message: "Map a column to Company name. Every imported row needs a company." });
    }
  });

export type ColumnMapping = z.output<typeof columnMappingSchema>;

/** Generic header synonyms (lower-case, punctuation-insensitive). Suggestions only; the user confirms. */
const SYNONYMS: Record<ImportFieldKey, string[]> = {
  company_name: ["company", "company name", "companyname", "organization", "organisation", "business", "business name", "account", "account name", "name of company"],
  website: ["website", "web site", "url", "website url", "homepage", "web"],
  domain: ["domain", "primary domain", "company domain", "email domain"],
  phone: ["phone", "company phone", "main phone", "telephone", "tel", "phone number", "primary phone"],
  country: ["country", "country code", "nation"],
  region: ["region", "state", "province", "county", "state province", "state/province"],
  city: ["city", "town", "locality"],
  postal_code: ["postal code", "postcode", "zip", "zip code", "zipcode"],
  address_line1: ["address", "address 1", "address line 1", "street", "street address", "address1"],
  address_line2: ["address 2", "address line 2", "address2", "suite"],
  employees_min: ["employees min", "min employees", "employee minimum", "employees from"],
  employees_max: ["employees max", "max employees", "employee maximum", "employees to"],
  qualification: ["qualification", "qualification state", "status", "lead status"],
  company_notes: ["notes", "company notes", "comments"],
  contact_name: ["contact", "contact name", "full name", "person", "name"],
  contact_first_name: ["first name", "firstname", "given name", "contact first name"],
  contact_last_name: ["last name", "lastname", "surname", "family name", "contact last name"],
  contact_title: ["title", "job title", "position", "role", "contact title"],
  contact_seniority: ["seniority", "level"],
  contact_email: ["email", "e-mail", "email address", "contact email", "work email"],
  contact_phone: ["contact phone", "mobile", "direct phone", "cell", "direct dial"],
  contact_profile: ["linkedin", "linkedin url", "profile", "profile url", "social profile"],
  contact_notes: ["contact notes"],
};

const keyOf = (h: string) => h.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s*\(\d+\)$/, "").replace(/\s+/g, " ").trim();

/** Suggests a mapping from header names; every field is suggested at most once. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const used = new Set<ImportFieldKey>();
  return headers.map((h) => {
    const k = keyOf(h);
    const hit = (Object.keys(SYNONYMS) as ImportFieldKey[]).find((f) => !used.has(f) && SYNONYMS[f].includes(k));
    if (hit) used.add(hit);
    return hit ?? null;
  });
}
