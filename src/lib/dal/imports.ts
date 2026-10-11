import "server-only";

import { cache } from "react";
import { allowedDecisions, classifyRows, isDecisionAllowed, type Decision, type MatchState } from "@/lib/imports/classify";
import { planRowCommit, type CommitContext } from "@/lib/imports/commit";
import type { ParsedCsv } from "@/lib/imports/csv";
import { columnMappingSchema, type ColumnMapping } from "@/lib/imports/fields";
import { IMPORT_LIMITS } from "@/lib/imports/limits";
import { buildRow, type RowIssue, type StagedRow } from "@/lib/imports/rows";
import { summarize, type CommitResult, type ImportSummary } from "@/lib/imports/summary";
import type { CompanySummary } from "@/lib/lead-core/views";
import { isUuid } from "@/lib/navigation";
import type { Json } from "@/lib/supabase/database.types";
import { companiesForMatching, companyForMerge, companySummaries } from "./companies";
import { contactsByEmail, contactsForMerge } from "./contacts";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";

/**
 * CSV import staging (P1-E2). Upload → import_rows (raw cells) → mapping +
 * normalization + validation + matching (stageMapping) → user decisions →
 * chunked commit, one row at a time through public.ingest_lead().
 * The uploaded file itself is never stored.
 */

export type ImportStatus = "mapping" | "review" | "processing" | "completed" | "cancelled";

export type ImportBatchView = {
  id: string;
  filename: string;
  status: ImportStatus;
  headers: string[];
  mapping: ColumnMapping | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdRows: number;
  mergedRows: number;
  skippedRows: number;
  failedRows: number;
  createdAt: string;
  completedAt: string | null;
};

export type ReviewFilter = "all" | "ready" | "duplicates" | "invalid" | "undecided" | "created" | "merged" | "skipped" | "failed";

export type ReviewRow = {
  id: string;
  rowNumber: number;
  company: string | null;
  domain: string | null;
  phone: string | null;
  location: string | null;
  contact: string | null;
  contactEmail: string | null;
  issues: RowIssue[];
  matchState: MatchState;
  matchReason: string | null;
  decision: Decision | null;
  allowed: Decision[];
  existing: CompanySummary | null;
  matchedRowNumber: number | null;
  commitResult: CommitResult | null;
  commitNotes: string[];
  committedCompanyId: string | null;
};

export type ReviewPage = { rows: ReviewRow[]; summary: ImportSummary; page: number; pageCount: number; filterTotal: number };

const BATCH_COLUMNS =
  "id, filename, status, headers, mapping, total_rows, valid_rows, invalid_rows, created_rows, merged_rows, skipped_rows, failed_rows, created_at, completed_at";

type BatchRow = {
  id: string; filename: string; status: string; headers: Json; mapping: Json | null; total_rows: number; valid_rows: number;
  invalid_rows: number; created_rows: number; merged_rows: number; skipped_rows: number; failed_rows: number; created_at: string; completed_at: string | null;
};

function toBatchView(b: BatchRow): ImportBatchView {
  const mapping = b.mapping ? columnMappingSchema.safeParse(b.mapping) : null;
  return {
    id: b.id,
    filename: b.filename,
    status: b.status as ImportStatus,
    headers: Array.isArray(b.headers) ? b.headers.map(String) : [],
    mapping: mapping?.success ? mapping.data : null,
    totalRows: b.total_rows,
    validRows: b.valid_rows,
    invalidRows: b.invalid_rows,
    createdRows: b.created_rows,
    mergedRows: b.merged_rows,
    skippedRows: b.skipped_rows,
    failedRows: b.failed_rows,
    createdAt: b.created_at,
    completedAt: b.completed_at,
  };
}

export async function listRecentImports(workspaceId: string, limit = 10): Promise<ImportBatchView[]> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("import_batches")
    .select(BATCH_COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new DataAccessError("listRecentImports", error);
  return (data ?? []).map(toBatchView);
}

/** One import of this workspace, or null (unknown, foreign and malformed ids are indistinguishable). */
export const getImportBatch = cache(async (workspaceId: string, batchId: string): Promise<ImportBatchView | null> => {
  if (!isUuid(batchId)) return null;
  await requireUser();
  const { data, error } = await (await supabase())
    .from("import_batches")
    .select(BATCH_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new DataAccessError("getImportBatch", error);
  return data ? toBatchView(data) : null;
});

/** Raw cells are stored as text; a pathological row is shortened so the staged copy stays small. */
function rawCells(cells: string[]): string[] {
  const json = JSON.stringify(cells);
  if (json.length <= 15000) return cells;
  const per = Math.max(20, Math.floor(14000 / Math.max(cells.length, 1)) - 10);
  return cells.map((c) => (c.length > per ? `${c.slice(0, per)}…` : c));
}

/** Creates the batch and stages every parsed row (raw cells only). */
export async function createImportBatch(workspaceId: string, filename: string, csv: ParsedCsv): Promise<MutationResult<{ batchId: string }>> {
  await requireUser();
  const client = await supabase();
  const { data: batch, error } = await client
    .from("import_batches")
    .insert({ workspace_id: workspaceId, filename: filename.slice(0, 255), headers: csv.headers, total_rows: csv.rows.length })
    .select("id");
  if (error || !batch?.length) return { ok: false, reason: error ? failureFromDbError("createImportBatch", error) : "forbidden" };
  const batchId = batch[0].id;

  for (let i = 0; i < csv.rows.length; i += IMPORT_LIMITS.stageChunk) {
    const chunk = csv.rows.slice(i, i + IMPORT_LIMITS.stageChunk).map((cells, j) => ({
      workspace_id: workspaceId,
      import_batch_id: batchId,
      row_number: i + j + 1,
      raw_data: rawCells(cells),
    }));
    const { error: rowError } = await client.from("import_rows").insert(chunk);
    if (rowError) {
      await client.from("import_batches").update({ status: "cancelled" }).eq("id", batchId);
      return { ok: false, reason: failureFromDbError("createImportBatch.rows", rowError) };
    }
  }
  return { ok: true, data: { batchId } };
}

type StoredRow = {
  id: string;
  row_number: number;
  raw_data: Json;
  normalized_data: Json | null;
  validation_errors: Json | null;
  match_state: string;
  match_reason: string | null;
  matched_company_id: string | null;
  matched_import_row_id: string | null;
  decision: string | null;
  commit_result: string | null;
  commit_notes: Json | null;
  committed_company_id: string | null;
};

const ROW_COLUMNS =
  "id, row_number, raw_data, normalized_data, validation_errors, match_state, match_reason, matched_company_id, matched_import_row_id, decision, commit_result, commit_notes, committed_company_id";

/** All rows of a batch (paged reads; the API returns at most 1,000 rows per request). */
async function allRows<T>(workspaceId: string, batchId: string, columns: string): Promise<T[]> {
  const client = await supabase();
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("import_rows")
      .select(columns)
      .eq("workspace_id", workspaceId)
      .eq("import_batch_id", batchId)
      .order("row_number", { ascending: true })
      .range(from, from + 999);
    if (error) throw new DataAccessError("allRows", error);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/** First rows of a batch, for the mapping screen's sample values. */
export async function sampleRows(workspaceId: string, batchId: string, n = 5): Promise<string[][]> {
  const { data, error } = await (await supabase())
    .from("import_rows")
    .select("raw_data")
    .eq("workspace_id", workspaceId)
    .eq("import_batch_id", batchId)
    .order("row_number", { ascending: true })
    .limit(n);
  if (error) throw new DataAccessError("sampleRows", error);
  return (data ?? []).map((r) => (Array.isArray(r.raw_data) ? r.raw_data.map(String) : []));
}

/**
 * Applies a column mapping: normalizes and validates every row with the
 * shared lead-core helpers, matches against this workspace's companies and
 * earlier rows, stores the results and moves the batch to review.
 * Re-running it (after "Back to mapping") recomputes everything; previous
 * decisions are replaced by the new suggestions.
 */
export async function stageMapping(
  workspaceId: string,
  batchId: string,
  mapping: ColumnMapping,
): Promise<MutationResult<{ valid: number; invalid: number }>> {
  const batch = await getImportBatch(workspaceId, batchId);
  if (!batch) return { ok: false, reason: "forbidden" };
  if (batch.status !== "mapping" && batch.status !== "review") return { ok: false, reason: "stale" };
  if (mapping.length !== batch.headers.length) return { ok: false, reason: "invalid" };

  const rows = await allRows<StoredRow>(workspaceId, batchId, "id, row_number, raw_data");
  const built = rows.map((r) => {
    const cells = Array.isArray(r.raw_data) ? r.raw_data.map(String) : [];
    const b = buildRow(cells, mapping);
    const staged: StagedRow = { mapped: b.mapped, company: b.company, contact: b.contact };
    if (JSON.stringify(staged).length > 15000) {
      return { row: r, staged: { mapped: {}, company: null, contact: null }, valid: false, issues: [{ level: "error", field: "row", message: "This row is too large to import." } as RowIssue] };
    }
    return { row: r, staged, valid: b.valid, issues: b.issues.slice(0, 20) };
  });

  const companies = built.map((b) => b.staged.company).filter((c) => c !== null);
  const known = await companiesForMatching(workspaceId, {
    domains: companies.map((c) => c.primaryDomain ?? ""),
    phones: companies.map((c) => c.primaryPhoneNormalized ?? ""),
    names: companies.map((c) => c.normalizedName),
  });
  const classified = classifyRows(
    built.map((b) => ({ id: b.row.id, rowNumber: b.row.row_number, staged: b.staged, valid: b.valid })),
    known,
  );

  const payload = built.map((b) => {
    const c = classified.get(b.row.id)!;
    return {
      id: b.row.id,
      normalized_data: b.staged,
      validation_errors: b.issues,
      match_state: c.matchState,
      match_reason: c.matchReason,
      matched_company_id: c.matchedCompanyId,
      matched_contact_id: null,
      matched_import_row_id: c.matchedRowId,
      decision: c.decision,
    };
  });
  const client = await supabase();
  for (let i = 0; i < payload.length; i += IMPORT_LIMITS.stageChunk) {
    const { error } = await client.rpc("stage_import_rows", {
      p_workspace_id: workspaceId,
      p_batch_id: batchId,
      p_rows: payload.slice(i, i + IMPORT_LIMITS.stageChunk) as unknown as Json,
    });
    if (error) return { ok: false, reason: failureFromDbError("stageMapping", error) };
  }

  const valid = built.filter((b) => b.valid).length;
  const { error } = await client
    .from("import_batches")
    .update({ mapping: mapping as Json, status: "review", valid_rows: valid, invalid_rows: built.length - valid })
    .eq("workspace_id", workspaceId)
    .eq("id", batchId)
    .in("status", ["mapping", "review"]);
  if (error) return { ok: false, reason: failureFromDbError("stageMapping.batch", error) };
  return { ok: true, data: { valid, invalid: built.length - valid } };
}

/** Back from review to mapping (nothing has been written to the lead core yet). */
export async function reopenMapping(workspaceId: string, batchId: string): Promise<MutationResult<null>> {
  return setStatus(workspaceId, batchId, "mapping", ["review"]);
}

export async function cancelImport(workspaceId: string, batchId: string): Promise<MutationResult<null>> {
  return setStatus(workspaceId, batchId, "cancelled", ["mapping", "review"]);
}

/** review → processing. Only one transition succeeds, so a double click can't start two commits. */
export async function startCommit(workspaceId: string, batchId: string): Promise<MutationResult<null>> {
  return setStatus(workspaceId, batchId, "processing", ["review"]);
}

async function setStatus(workspaceId: string, batchId: string, status: ImportStatus, from: ImportStatus[]): Promise<MutationResult<null>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("import_batches")
    .update({ status })
    .eq("workspace_id", workspaceId)
    .eq("id", batchId)
    .in("status", from)
    .select("id");
  if (error) return { ok: false, reason: failureFromDbError("setImportStatus", error) };
  return data?.length ? { ok: true, data: null } : { ok: false, reason: "stale" };
}

const asDecision = (v: string | null): Decision | null => (v === "create" || v === "merge" || v === "skip" ? v : null);
const asIssues = (v: Json | null): RowIssue[] => (Array.isArray(v) ? (v as unknown as RowIssue[]) : []);
const asNotes = (v: Json | null): string[] => (Array.isArray(v) ? v.map(String) : []);
const asStaged = (v: Json | null): StagedRow | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as unknown as StagedRow) : null);

const FILTERS: Record<ReviewFilter, (r: StoredRow) => boolean> = {
  all: () => true,
  ready: (r) => r.match_state !== "invalid" && (r.decision === "create" || r.decision === "merge"),
  duplicates: (r) => r.match_state === "matched" || r.match_state === "possible_duplicate",
  invalid: (r) => r.match_state === "invalid",
  undecided: (r) => r.match_state !== "invalid" && r.decision === null,
  created: (r) => r.commit_result === "created",
  merged: (r) => r.commit_result === "merged",
  skipped: (r) => r.commit_result === "skipped" && r.match_state !== "invalid",
  failed: (r) => r.commit_result === "failed",
};

/** One page of rows for review or the final report, plus counts for the whole batch. */
export async function listImportRows(workspaceId: string, batchId: string, filter: ReviewFilter, page: number): Promise<ReviewPage> {
  await requireUser();
  const all = await allRows<StoredRow>(workspaceId, batchId, ROW_COLUMNS);
  const summary = summarize(
    all.map((r) => ({ matchState: r.match_state as MatchState, decision: asDecision(r.decision), commitResult: r.commit_result as CommitResult | null })),
  );
  const filtered = all.filter(FILTERS[filter]);
  const size = IMPORT_LIMITS.reviewPageSize;
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(Math.max(1, page), pageCount);
  const slice = filtered.slice((current - 1) * size, current * size);

  const existing = await companySummaries(
    workspaceId,
    slice.flatMap((r) => [r.matched_company_id, r.committed_company_id].filter((x): x is string => !!x)),
  );
  const rowNumberById = new Map(all.map((r) => [r.id, r.row_number]));

  return {
    rows: slice.map((r) => {
      const staged = asStaged(r.normalized_data);
      const m = staged?.mapped ?? {};
      const matchState = r.match_state as MatchState;
      return {
        id: r.id,
        rowNumber: r.row_number,
        company: staged?.company?.canonicalName ?? m.company_name ?? null,
        domain: staged?.company?.primaryDomain ?? m.domain ?? null,
        phone: staged?.company?.primaryPhone ?? m.phone ?? null,
        location: [m.city, m.region, m.country].filter(Boolean).join(", ") || null,
        contact: staged?.contact?.fullName ?? ([m.contact_first_name, m.contact_last_name].filter(Boolean).join(" ") || m.contact_name || null),
        contactEmail: staged?.contact?.email ?? m.contact_email ?? null,
        issues: asIssues(r.validation_errors),
        matchState,
        matchReason: r.match_reason,
        decision: asDecision(r.decision),
        allowed: allowedDecisions(matchState),
        existing: (r.committed_company_id && existing.get(r.committed_company_id)) || (r.matched_company_id && existing.get(r.matched_company_id)) || null,
        matchedRowNumber: r.matched_import_row_id ? (rowNumberById.get(r.matched_import_row_id) ?? null) : null,
        commitResult: r.commit_result as CommitResult | null,
        commitNotes: asNotes(r.commit_notes),
        committedCompanyId: r.committed_company_id,
      };
    }),
    summary,
    page: current,
    pageCount,
    filterTotal: filtered.length,
  };
}

/** Records a user decision for one uncommitted row, if allowed for its match. */
export async function setRowDecision(workspaceId: string, batchId: string, rowId: string, decision: Decision): Promise<MutationResult<null>> {
  await requireUser();
  const client = await supabase();
  const { data: row, error } = await client
    .from("import_rows")
    .select("id, match_state")
    .eq("workspace_id", workspaceId)
    .eq("import_batch_id", batchId)
    .eq("id", rowId)
    .is("commit_result", null)
    .maybeSingle();
  if (error) return { ok: false, reason: failureFromDbError("setRowDecision.read", error) };
  if (!row) return { ok: false, reason: "forbidden" };
  if (!isDecisionAllowed(row.match_state as MatchState, decision)) return { ok: false, reason: "invalid" };
  const batch = await getImportBatch(workspaceId, batchId);
  if (batch?.status !== "review") return { ok: false, reason: "stale" };
  const { data, error: updateError } = await client
    .from("import_rows")
    .update({ decision })
    .eq("workspace_id", workspaceId)
    .eq("id", rowId)
    .is("commit_result", null)
    .select("id");
  if (updateError) return { ok: false, reason: failureFromDbError("setRowDecision", updateError) };
  return data?.length ? { ok: true, data: null } : { ok: false, reason: "forbidden" };
}

const FAILURE_NOTE: Record<string, string> = {
  "23505": "Not imported: another active company already has this domain, or the company already has a primary contact.",
  "23514": "Not imported: a value was rejected by a data rule.",
  "42501": "Not imported: the company is no longer available.",
};

/**
 * Commits the next chunk of uncommitted rows (in file order), one row per
 * transaction. Safe to call repeatedly or concurrently: committed rows are
 * never planned again and ingest_lead() re-checks under a row lock. When no
 * rows remain, the batch is completed with its final counts.
 */
export async function commitNextChunk(workspaceId: string, batchId: string): Promise<MutationResult<{ done: boolean; summary: ImportSummary }>> {
  await requireUser();
  const batch = await getImportBatch(workspaceId, batchId);
  if (!batch) return { ok: false, reason: "forbidden" };
  if (batch.status !== "processing") return { ok: false, reason: "stale" };
  const client = await supabase();

  const { data: rows, error } = await client
    .from("import_rows")
    .select(ROW_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("import_batch_id", batchId)
    .is("commit_result", null)
    .order("row_number", { ascending: true })
    .limit(IMPORT_LIMITS.commitChunk);
  if (error) return { ok: false, reason: failureFromDbError("commitNextChunk.read", error) };

  const markRow = (id: string, commit_result: CommitResult, notes: string[]) =>
    client.from("import_rows").update({ commit_result, commit_notes: notes as Json }).eq("workspace_id", workspaceId).eq("id", id).is("commit_result", null);

  for (const r of (rows ?? []) as StoredRow[]) {
    const staged = asStaged(r.normalized_data);
    let decision = asDecision(r.decision);
    let targetId = r.matched_company_id;

    // A merge into a company created earlier in this file: use what that row created.
    if (decision === "merge" && !targetId && r.matched_import_row_id) {
      const { data: earlier } = await client
        .from("import_rows")
        .select("commit_result, committed_company_id")
        .eq("workspace_id", workspaceId)
        .eq("id", r.matched_import_row_id)
        .maybeSingle();
      if (earlier?.committed_company_id) targetId = earlier.committed_company_id;
      else decision = "create"; // the earlier row didn't create it (skipped/failed): create it here
    }

    const ctx: CommitContext = { target: null, targetContacts: [], emailOwners: [] };
    if (decision === "merge" && targetId) {
      ctx.target = await companyForMerge(workspaceId, targetId);
      if (ctx.target) ctx.targetContacts = await contactsForMerge(workspaceId, targetId);
    }
    if (staged?.contact?.normalizedEmail && decision !== "skip") {
      ctx.emailOwners = await contactsByEmail(workspaceId, staged.contact.normalizedEmail);
    }

    const plan = planRowCommit(
      { commitResult: r.commit_result as CommitResult | null, matchState: r.match_state as MatchState, decision, staged },
      ctx,
      "csv",
    );
    if (plan.kind === "already_committed") continue;
    if (plan.kind === "skip" || plan.kind === "fail") {
      await markRow(r.id, plan.kind === "skip" ? "skipped" : "failed", plan.notes);
      continue;
    }
    if (plan.notes.length) {
      await client.from("import_rows").update({ commit_notes: plan.notes as Json }).eq("workspace_id", workspaceId).eq("id", r.id).is("commit_result", null);
    }
    const { error: ingestError } = await client.rpc("ingest_lead", {
      p_workspace_id: workspaceId,
      p_company: plan.call.company as Json,
      p_contact: plan.call.contact as Json,
      p_evidence: plan.call.evidence as Json,
      p_import_row_id: r.id,
    });
    if (ingestError) {
      console.error("import row commit failed", ingestError.code);
      await markRow(r.id, "failed", [FAILURE_NOTE[ingestError.code ?? ""] ?? "Not imported: an unexpected error occurred."]);
    }
  }

  const states = await allRows<Pick<StoredRow, "match_state" | "decision" | "commit_result">>(workspaceId, batchId, "match_state, decision, commit_result");
  const summary = summarize(states.map((s) => ({ matchState: s.match_state as MatchState, decision: asDecision(s.decision), commitResult: s.commit_result as CommitResult | null })));
  const remaining = states.filter((s) => s.commit_result === null).length;
  if (remaining === 0) {
    await client
      .from("import_batches")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        created_rows: summary.created,
        merged_rows: summary.merged,
        skipped_rows: summary.skipped,
        failed_rows: summary.failed,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", batchId)
      .eq("status", "processing");
  }
  return { ok: true, data: { done: remaining === 0, summary } };
}
