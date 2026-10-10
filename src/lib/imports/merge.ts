import { normalizeCompanyName, normalizePersonName } from "@/lib/lead-core/normalize";
import type { NormalizedCompany, NormalizedContact } from "./rows";

/**
 * Conservative merge rules (shared by CSV merges; documented in
 * docs/product/vleeds-imports.md §6):
 *   1. A blank imported value never changes anything.
 *   2. An imported value fills a field that is empty on the existing record.
 *   3. Equal values (after normalization) need no change.
 *   4. Two different populated values: the EXISTING value is kept and the
 *      difference is reported as a conflict. The imported value is still
 *      recorded as evidence.
 *   5. Names are never changed by a merge (a different name is a conflict).
 *   6. Qualification counts as empty while it is "unreviewed".
 */

export type ExistingCompany = {
  canonical_name: string;
  normalized_name: string;
  website_url: string | null;
  primary_domain: string | null;
  primary_phone: string | null;
  primary_phone_normalized: string | null;
  location: unknown;
  employee_count_min: number | null;
  employee_count_max: number | null;
  qualification_state: string;
  notes: string | null;
  /** P1-E4 */
  industry?: string | null;
  description?: string | null;
};

export type ExistingContact = {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  seniority: string | null;
  email: string | null;
  normalized_email: string | null;
  phone: string | null;
  phone_normalized: string | null;
  linkedin_url: string | null;
  notes: string | null;
};

export type MergePlan = { patch: Record<string, unknown>; conflicts: string[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ci = (v: string | null) => (v ?? "").trim().toLowerCase();

/** Long values are shortened in conflict notes (the full value stays in evidence). */
const short = (v: string) => (v.length > 120 ? `${v.slice(0, 117)}…` : v);

function fill(
  plan: MergePlan,
  column: string,
  label: string,
  existing: string | null,
  incoming: string | null,
  equal: (a: string, b: string) => boolean = (a, b) => ci(a) === ci(b),
  extra?: Record<string, unknown>,
  source = "import",
) {
  if (!incoming) return;
  if (!existing) {
    plan.patch[column] = incoming;
    if (extra) Object.assign(plan.patch, extra);
  } else if (!equal(existing, incoming)) {
    plan.conflicts.push(`Kept existing ${label} “${short(existing)}” (${source} had “${short(incoming)}”).`);
  }
}

/**
 * `source` names where the incoming values came from in conflict notes
 * ("import" for CSV; a provider label for enrichment). The rules are the same.
 */
export function planCompanyMerge(existing: ExistingCompany, incoming: NormalizedCompany, source = "import"): MergePlan {
  const plan: MergePlan = { patch: {}, conflicts: [] };

  if (normalizeCompanyName(existing.canonical_name) !== incoming.normalizedName) {
    plan.conflicts.push(`Kept company name “${existing.canonical_name}” (${source} had “${incoming.canonicalName}”).`);
  }
  fill(plan, "website_url", "website", existing.website_url, incoming.websiteUrl, (a, b) => ci(a).replace(/\/$/, "") === ci(b).replace(/\/$/, ""), undefined, source);
  fill(plan, "primary_domain", "domain", existing.primary_domain, incoming.primaryDomain, undefined, undefined, source);
  fill(
    plan,
    "primary_phone",
    "phone",
    existing.primary_phone,
    incoming.primaryPhone,
    (a, b) =>
      existing.primary_phone_normalized && incoming.primaryPhoneNormalized
        ? existing.primary_phone_normalized === incoming.primaryPhoneNormalized
        : a.replace(/\D/g, "") === b.replace(/\D/g, ""),
    { primary_phone_normalized: incoming.primaryPhoneNormalized },
    source,
  );

  if (incoming.location) {
    if (!existing.location) plan.patch.location = incoming.location;
    else if (!same(existing.location, incoming.location)) plan.conflicts.push(`Kept the existing location (${source} had a different one).`);
  }

  const min = existing.employee_count_min ?? incoming.employeeCountMin;
  const max = existing.employee_count_max ?? incoming.employeeCountMax;
  if (min !== null && max !== null && min > max) {
    plan.conflicts.push(`Kept the existing employee range (${source} would make it inconsistent).`);
  } else {
    if (existing.employee_count_min === null && incoming.employeeCountMin !== null) plan.patch.employee_count_min = incoming.employeeCountMin;
    if (existing.employee_count_max === null && incoming.employeeCountMax !== null) plan.patch.employee_count_max = incoming.employeeCountMax;
    if (existing.employee_count_min !== null && incoming.employeeCountMin !== null && existing.employee_count_min !== incoming.employeeCountMin) {
      plan.conflicts.push(`Kept existing employee minimum ${existing.employee_count_min} (${source} had ${incoming.employeeCountMin}).`);
    }
    if (existing.employee_count_max !== null && incoming.employeeCountMax !== null && existing.employee_count_max !== incoming.employeeCountMax) {
      plan.conflicts.push(`Kept existing employee maximum ${existing.employee_count_max} (${source} had ${incoming.employeeCountMax}).`);
    }
  }

  if (incoming.qualificationState && incoming.qualificationState !== existing.qualification_state) {
    if (existing.qualification_state === "unreviewed") plan.patch.qualification_state = incoming.qualificationState;
    else plan.conflicts.push("Kept the existing qualification decision.");
  }

  // P1-E4: descriptive fields fill empty values only; a populated value is never overwritten.
  fill(plan, "industry", "industry", existing.industry ?? null, incoming.industry ?? null, undefined, undefined, source);
  fill(plan, "description", "description", existing.description ?? null, incoming.description ?? null, (a, b) => a.trim() === b.trim(), undefined, source);

  fill(plan, "notes", "notes", existing.notes, incoming.notes, (a, b) => a.trim() === b.trim(), undefined, source);
  return plan;
}

export function planContactMerge(existing: ExistingContact, incoming: NormalizedContact): MergePlan {
  const plan: MergePlan = { patch: {}, conflicts: [] };
  if (normalizePersonName(existing.full_name) !== normalizePersonName(incoming.fullName)) {
    plan.conflicts.push(`Kept contact name “${existing.full_name}” (import had “${incoming.fullName}”).`);
  }
  fill(plan, "first_name", "first name", existing.first_name, incoming.firstName);
  fill(plan, "last_name", "last name", existing.last_name, incoming.lastName);
  fill(plan, "job_title", "job title", existing.job_title, incoming.jobTitle);
  fill(plan, "seniority", "seniority", existing.seniority, incoming.seniority);
  fill(plan, "email", "email", existing.email, incoming.email, undefined, { normalized_email: incoming.normalizedEmail });
  fill(
    plan,
    "phone",
    "contact phone",
    existing.phone,
    incoming.phone,
    (a, b) =>
      existing.phone_normalized && incoming.phoneNormalized ? existing.phone_normalized === incoming.phoneNormalized : a.replace(/\D/g, "") === b.replace(/\D/g, ""),
    { phone_normalized: incoming.phoneNormalized },
  );
  fill(plan, "linkedin_url", "profile URL", existing.linkedin_url, incoming.linkedinUrl);
  fill(plan, "notes", "contact notes", existing.notes, incoming.notes, (a, b) => a.trim() === b.trim());
  return plan;
}
