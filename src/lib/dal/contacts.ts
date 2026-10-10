import "server-only";

import { contactColumns, evidenceFor } from "@/lib/imports/ingest";
import type { ExistingContact } from "@/lib/imports/merge";
import type { NormalizedContact } from "@/lib/imports/rows";
import type { Database, Json } from "@/lib/supabase/database.types";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";

export type ContactRow = Pick<
  Database["public"]["Tables"]["contacts"]["Row"],
  "id" | "company_id" | "full_name" | "job_title" | "email" | "phone" | "linkedin_url" | "is_primary" | "status" | "created_at"
>;

/**
 * Active (non-archived) contacts of the given companies, primary first.
 * Callers must have authorized the workspace; RLS filters again.
 */
export async function contactsForCompanies(workspaceId: string, companyIds: string[]): Promise<ContactRow[]> {
  if (companyIds.length === 0) return [];
  const { data, error } = await (await supabase())
    .from("contacts")
    .select("id, company_id, full_name, job_title, email, phone, linkedin_url, is_primary, status, created_at")
    .eq("workspace_id", workspaceId)
    .in("company_id", companyIds)
    .is("archived_at", null);
  if (error) throw new DataAccessError("contactsForCompanies", error);
  return (data ?? []).sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.full_name.localeCompare(b.full_name),
  );
}

export type MergeableContact = ExistingContact & { id: string; company_id: string; is_primary: boolean };

const MERGE_COLUMNS =
  "id, company_id, is_primary, full_name, first_name, last_name, job_title, seniority, email, normalized_email, phone, phone_normalized, linkedin_url, notes";

/** Active contacts of one company with every mergeable column. */
export async function contactsForMerge(workspaceId: string, companyId: string): Promise<MergeableContact[]> {
  const { data, error } = await (await supabase())
    .from("contacts")
    .select(MERGE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .is("archived_at", null);
  if (error) throw new DataAccessError("contactsForMerge", error);
  return data ?? [];
}

/** Active contacts anywhere in the workspace with the given (normalized) email. */
export async function contactsByEmail(workspaceId: string, normalizedEmail: string): Promise<{ id: string; company_id: string; full_name: string }[]> {
  const { data, error } = await (await supabase())
    .from("contacts")
    .select("id, company_id, full_name")
    .eq("workspace_id", workspaceId)
    .eq("normalized_email", normalizedEmail)
    .is("archived_at", null);
  if (error) throw new DataAccessError("contactsByEmail", error);
  return data ?? [];
}

/** Adds a contact to a company with manual evidence, as one transaction (public.ingest_lead). */
export async function addContactManual(
  workspaceId: string,
  companyId: string,
  contact: NormalizedContact,
  isPrimary: boolean,
): Promise<MutationResult<{ contactId: string }>> {
  await requireUser();
  const { data, error } = await (await supabase()).rpc("ingest_lead", {
    p_workspace_id: workspaceId,
    p_company: { id: companyId, fields: {} } as Json,
    p_contact: { fields: contactColumns(contact), is_primary: isPrimary } as Json,
    p_evidence: evidenceFor(null, contact, "manual") as Json,
    p_import_row_id: null,
  });
  if (error) return { ok: false, reason: failureFromDbError("addContactManual", error) };
  const result = data as { contact_id?: string } | null;
  return result?.contact_id ? { ok: true, data: { contactId: result.contact_id } } : { ok: false, reason: "failed" };
}
