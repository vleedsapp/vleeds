"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { issuesToFieldErrors, type FieldErrors } from "@/lib/config/icp";
import {
  addContactManual,
  addSuppression,
  canConfigureWorkspace,
  companiesForMatching,
  companySummaries,
  contactsByEmail,
  contactsForMerge,
  createCompanyManual,
  findWorkspace,
  getCurrentUser,
  liftSuppression,
  setCompanyQualification as setQualificationInDb,
  type MutationFailure,
  type WorkspaceDetail,
} from "@/lib/dal";
import type { NormalizedCompany, NormalizedContact } from "@/lib/imports/rows";
import { matchCompany, matchContact } from "@/lib/lead-core/dedupe";
import { companyInputSchema, contactFieldsSchema, qualificationUpdateSchema, suppressionInputSchema } from "@/lib/lead-core/schemas";
import type { CompanySummary } from "@/lib/lead-core/views";
import { isUuid } from "@/lib/navigation";

/**
 * Lead-core mutations from the Leads page and company drawer. Each action:
 * authenticates, re-authorizes the workspace (any member: collaborative
 * model), validates with the shared Zod schemas, writes through the DAL under
 * the user's session (RLS decides), returns safe messages, refreshes in place.
 */

export type LeadActionResult = { ok: true } | { ok: false; error: string; fieldErrors?: FieldErrors };

const NOT_AVAILABLE = "This company is not available.";

const MESSAGES: Record<MutationFailure, string> = {
  forbidden: NOT_AVAILABLE,
  conflict: "This conflicts with an existing record (for example the same domain, or a second primary contact).",
  stale: "This changed in the meantime. Close and try again.",
  invalid: "Some values aren't allowed. Check them and try again.",
  failed: "This couldn't be saved. Try again.",
};

async function authorize(workspaceId: unknown): Promise<WorkspaceDetail | null> {
  if (typeof workspaceId !== "string" || !isUuid(workspaceId)) return null;
  if (!(await getCurrentUser())) redirect("/login");
  return findWorkspace(workspaceId);
}

const validationError = (issues: { path: readonly PropertyKey[]; message: string }[]): LeadActionResult => ({
  ok: false,
  error: "Check the highlighted fields.",
  fieldErrors: issuesToFieldErrors(issues),
});

// -----------------------------------------------------------------------------
export async function setCompanyQualification(workspaceId: string, companyId: string, input: unknown): Promise<LeadActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws || typeof companyId !== "string" || !isUuid(companyId)) return { ok: false, error: NOT_AVAILABLE };
  const parsed = qualificationUpdateSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error.issues);
  const result = await setQualificationInDb(ws.id, companyId, parsed.data);
  if (!result.ok) return { ok: false, error: MESSAGES[result.reason] };
  refresh();
  return { ok: true };
}

// -----------------------------------------------------------------------------
const manualCompanySchema = z.strictObject({
  company: z.unknown(),
  contact: z.unknown().nullable(),
  /** The user saw the duplicate warning and chose to create anyway. */
  confirmCreate: z.boolean().default(false),
});

export type CreateCompanyResult =
  | { ok: true; companyId: string }
  | { ok: false; error: string; fieldErrors?: FieldErrors }
  | { ok: false; duplicate: { matches: CompanySummary[]; strong: boolean; reason: string } };

const REASONS: Record<string, string> = {
  domain: "has the same domain",
  external_id: "is the same provider record",
  phone: "has the same phone number",
  name_location: "has the same name in the same place",
};

/**
 * Creates a company manually, after the same duplicate check CSV imports use.
 * A strong match (same domain) can't be created again; a weaker one can after
 * the user confirms.
 */
export async function createCompany(workspaceId: string, input: unknown): Promise<CreateCompanyResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return { ok: false, error: "This workspace is not available." };
  const envelope = manualCompanySchema.safeParse(input);
  if (!envelope.success) return { ok: false, error: "Check the form and try again." };

  const companyParsed = companyInputSchema.safeParse(envelope.data.company);
  const contactInput = envelope.data.contact;
  const contactParsed = contactInput ? contactFieldsSchema.safeParse(contactInput) : null;
  if (!companyParsed.success || (contactParsed && !contactParsed.success)) {
    const issues = [
      ...(companyParsed.success ? [] : companyParsed.error.issues.map((i) => ({ ...i, path: ["company", ...i.path] }))),
      ...(contactParsed && !contactParsed.success ? contactParsed.error.issues.map((i) => ({ ...i, path: ["contact", ...i.path] })) : []),
    ];
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: issuesToFieldErrors(issues) };
  }

  const c = companyParsed.data;
  const company: NormalizedCompany = {
    canonicalName: c.canonicalName,
    normalizedName: c.normalizedName,
    websiteUrl: c.websiteUrl,
    primaryDomain: c.primaryDomain,
    primaryPhone: c.primaryPhone,
    primaryPhoneNormalized: c.primaryPhoneNormalized,
    location: c.location,
    employeeCountMin: c.employeeCountMin,
    employeeCountMax: c.employeeCountMax,
    qualificationState: c.qualificationState,
    notes: c.notes,
    industry: c.industry,
    description: c.description,
  };

  const known = await companiesForMatching(ws.id, {
    domains: [company.primaryDomain ?? ""],
    phones: [company.primaryPhoneNormalized ?? ""],
    names: [company.normalizedName],
  });
  const match = matchCompany({ name: company.canonicalName, domain: company.primaryDomain, phone: company.primaryPhone, location: company.location }, known);
  if (match.outcome !== "new" && !(match.outcome === "review" && envelope.data.confirmCreate)) {
    const ids = match.outcome === "match" ? [match.id] : match.ids;
    const summaries = await companySummaries(ws.id, ids);
    return {
      ok: false,
      duplicate: {
        matches: ids.map((id) => summaries.get(id)).filter((s): s is CompanySummary => !!s),
        strong: match.outcome === "match",
        reason: REASONS[match.reason] ?? "looks similar",
      },
    };
  }

  let contact: NormalizedContact | null = null;
  if (contactParsed?.success) {
    const k = contactParsed.data;
    if (k.normalizedEmail) {
      const owners = await contactsByEmail(ws.id, k.normalizedEmail);
      if (owners.length) {
        return { ok: false, error: `${k.email} already belongs to ${owners[0].full_name}.`, fieldErrors: { "contact.email": "This email already belongs to another contact." } };
      }
    }
    contact = { fullName: k.fullName!, firstName: k.firstName, lastName: k.lastName, jobTitle: k.jobTitle, seniority: k.seniority, email: k.email, normalizedEmail: k.normalizedEmail, phone: k.phone, phoneNormalized: k.phoneNormalized, linkedinUrl: k.linkedinUrl, notes: k.notes };
  }

  const result = await createCompanyManual(ws.id, company, contact);
  if (!result.ok) {
    return { ok: false, error: result.reason === "conflict" ? "Another active company already has this domain." : MESSAGES[result.reason] };
  }
  refresh();
  return { ok: true, companyId: result.data.companyId };
}

// -----------------------------------------------------------------------------
const addContactSchema = z.strictObject({
  contact: z.unknown(),
  isPrimary: z.boolean().default(false),
  confirmCreate: z.boolean().default(false),
});

export type AddContactResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: FieldErrors }
  | { ok: false; duplicate: { name: string } };

/** Adds a contact to a company after the contact matching rules (email blocks; same name asks). */
export async function addContact(workspaceId: string, companyId: string, input: unknown): Promise<AddContactResult> {
  const ws = await authorize(workspaceId);
  if (!ws || typeof companyId !== "string" || !isUuid(companyId)) return { ok: false, error: NOT_AVAILABLE };
  const envelope = addContactSchema.safeParse(input);
  if (!envelope.success) return { ok: false, error: "Check the form and try again." };
  const parsed = contactFieldsSchema.safeParse(envelope.data.contact);
  if (!parsed.success) return validationError(parsed.error.issues);
  const k = parsed.data;

  const existing = await contactsForMerge(ws.id, companyId);
  if (envelope.data.isPrimary && existing.some((x) => x.is_primary)) {
    return { ok: false, error: "This company already has a primary contact.", fieldErrors: { isPrimary: "This company already has a primary contact." } };
  }
  if (k.normalizedEmail) {
    const owners = await contactsByEmail(ws.id, k.normalizedEmail);
    if (owners.length) {
      const here = owners.find((o) => o.company_id === companyId);
      return {
        ok: false,
        error: here ? `${here.full_name} already has this email at this company.` : `This email already belongs to ${owners[0].full_name} at another company.`,
        fieldErrors: { email: "This email already belongs to a contact." },
      };
    }
  }
  const m = matchContact(
    { fullName: k.fullName!, companyId, email: k.email },
    existing.map((x) => ({ id: x.id, companyId: x.company_id, fullName: x.full_name, normalizedEmail: x.normalized_email, externalIds: [] })),
  );
  if (m.outcome === "review" && !envelope.data.confirmCreate) {
    return { ok: false, duplicate: { name: existing.find((x) => x.id === m.ids[0])?.full_name ?? k.fullName! } };
  }

  const result = await addContactManual(
    ws.id,
    companyId,
    { fullName: k.fullName!, firstName: k.firstName, lastName: k.lastName, jobTitle: k.jobTitle, seniority: k.seniority, email: k.email, normalizedEmail: k.normalizedEmail, phone: k.phone, phoneNormalized: k.phoneNormalized, linkedinUrl: k.linkedinUrl, notes: k.notes },
    envelope.data.isPrimary,
  );
  if (!result.ok) return { ok: false, error: MESSAGES[result.reason] };
  refresh();
  return { ok: true };
}

// -----------------------------------------------------------------------------
/** Any member may restrict a company or contact ("do not contact"). */
export async function addRestriction(workspaceId: string, input: unknown): Promise<LeadActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return { ok: false, error: NOT_AVAILABLE };
  const parsed = suppressionInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error.issues);
  const result = await addSuppression(ws.id, parsed.data);
  if (!result.ok) return { ok: false, error: MESSAGES[result.reason] };
  refresh();
  return { ok: true };
}

/** Lifting a restriction is for owners and admins (checked here for the message; RLS enforces it). */
export async function liftRestriction(workspaceId: string, suppressionId: string): Promise<LeadActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws || typeof suppressionId !== "string" || !isUuid(suppressionId)) return { ok: false, error: NOT_AVAILABLE };
  if (!canConfigureWorkspace(ws.role)) return { ok: false, error: "Only owners and admins can lift a restriction." };
  const result = await liftSuppression(ws.id, suppressionId);
  if (!result.ok) return { ok: false, error: result.reason === "forbidden" ? "This restriction was already lifted, or you can't lift it." : MESSAGES[result.reason] };
  refresh();
  return { ok: true };
}
