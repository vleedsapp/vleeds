import "server-only";

import type { Database } from "@/lib/supabase/database.types";
import { DataAccessError, supabase } from "./core";

export type EvidenceRow = Database["public"]["Tables"]["lead_sources"]["Row"];

const EVIDENCE_COLUMNS =
  "id, workspace_id, company_id, contact_id, source_kind, provider_key, external_record_id, source_url, field_key, observed_value, confidence, observed_at, import_batch_id, import_row_id, created_by, created_at";

/**
 * Evidence attached to the given companies directly or to their contacts.
 * Rows are de-duplicated (a row may name both a company and a contact).
 */
export async function evidenceFor(
  workspaceId: string,
  companyIds: string[],
  contactIds: string[],
): Promise<EvidenceRow[]> {
  const client = await supabase();
  const queries = [];
  if (companyIds.length) {
    queries.push(client.from("lead_sources").select(EVIDENCE_COLUMNS).eq("workspace_id", workspaceId).in("company_id", companyIds));
  }
  if (contactIds.length) {
    queries.push(client.from("lead_sources").select(EVIDENCE_COLUMNS).eq("workspace_id", workspaceId).in("contact_id", contactIds));
  }
  const results = await Promise.all(queries);
  const byId = new Map<string, EvidenceRow>();
  for (const { data, error } of results) {
    if (error) throw new DataAccessError("evidenceFor", error);
    for (const row of data ?? []) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => (b.observed_at ?? b.created_at).localeCompare(a.observed_at ?? a.created_at));
}
