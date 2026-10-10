"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  cancelImport as cancelImportInDb,
  commitNextChunk,
  createImportBatch,
  findWorkspace,
  getCurrentUser,
  reopenMapping,
  setRowDecision,
  stageMapping,
  startCommit,
  type MutationFailure,
  type WorkspaceDetail,
} from "@/lib/dal";
import { checkCsvFile, decodeCsv, parseCsv } from "@/lib/imports/csv";
import { columnMappingSchema } from "@/lib/imports/fields";
import type { ImportSummary } from "@/lib/imports/summary";
import { isUuid } from "@/lib/navigation";

/**
 * CSV import steps. Each action authenticates, re-authorizes the workspace
 * and the batch, validates input, works through the DAL (RLS decides),
 * returns safe messages and refreshes. The uploaded file is read in memory
 * and discarded; only parsed rows are staged.
 */

export type ImportActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const MESSAGES: Record<MutationFailure, string> = {
  forbidden: "This import is not available.",
  conflict: "This import changed in the meantime. Reload the page.",
  stale: "This import has moved to another step. Reload the page.",
  invalid: "Some values aren't allowed. Check them and try again.",
  failed: "Something went wrong. Try again.",
};

async function authorize(workspaceId: unknown, batchId?: unknown): Promise<WorkspaceDetail | null> {
  if (typeof workspaceId !== "string" || !isUuid(workspaceId)) return null;
  if (batchId !== undefined && (typeof batchId !== "string" || !isUuid(batchId))) return null;
  if (!(await getCurrentUser())) redirect("/login");
  return findWorkspace(workspaceId);
}

const fail = (reason: MutationFailure): ImportActionResult<never> => ({ ok: false, error: MESSAGES[reason] });

/** Upload: checks name/size, decodes, parses with Papa Parse and stages the rows. */
export async function uploadCsv(workspaceId: string, formData: FormData): Promise<ImportActionResult<{ batchId: string }>> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail("forbidden");
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a CSV file to upload." };
  const fileError = checkCsvFile(file);
  if (fileError) return { ok: false, error: fileError.message };

  const parsed = parseCsv(decodeCsv(new Uint8Array(await file.arrayBuffer())));
  if (!parsed.ok) return { ok: false, error: parsed.error.message };

  const result = await createImportBatch(ws.id, file.name, parsed.csv);
  if (!result.ok) return fail(result.reason);
  return { ok: true, data: { batchId: result.data.batchId } };
}

export async function saveMapping(workspaceId: string, batchId: string, mapping: unknown): Promise<ImportActionResult<{ valid: number; invalid: number }>> {
  const ws = await authorize(workspaceId, batchId);
  if (!ws) return fail("forbidden");
  const parsed = columnMappingSchema.safeParse(mapping);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the mapping." };
  const result = await stageMapping(ws.id, batchId, parsed.data);
  if (!result.ok) return fail(result.reason);
  refresh();
  return result;
}

export async function backToMapping(workspaceId: string, batchId: string): Promise<ImportActionResult> {
  const ws = await authorize(workspaceId, batchId);
  if (!ws) return fail("forbidden");
  const result = await reopenMapping(ws.id, batchId);
  if (!result.ok) return fail(result.reason);
  refresh();
  return result;
}

export async function setDecision(workspaceId: string, batchId: string, rowId: string, decision: unknown): Promise<ImportActionResult> {
  const ws = await authorize(workspaceId, batchId);
  if (!ws || typeof rowId !== "string" || !isUuid(rowId)) return fail("forbidden");
  const parsed = z.enum(["create", "merge", "skip"]).safeParse(decision);
  if (!parsed.success) return fail("invalid");
  const result = await setRowDecision(ws.id, batchId, rowId, parsed.data);
  if (!result.ok) return { ok: false, error: result.reason === "invalid" ? "That choice isn't available for this row." : MESSAGES[result.reason] };
  refresh();
  return result;
}

export async function cancelImport(workspaceId: string, batchId: string): Promise<ImportActionResult> {
  const ws = await authorize(workspaceId, batchId);
  if (!ws) return fail("forbidden");
  const result = await cancelImportInDb(ws.id, batchId);
  if (!result.ok) return fail(result.reason);
  refresh();
  return result;
}

/** Starts the commit (review → processing) and runs the first chunk. */
export async function startImport(workspaceId: string, batchId: string): Promise<ImportActionResult<{ done: boolean; summary: ImportSummary }>> {
  const ws = await authorize(workspaceId, batchId);
  if (!ws) return fail("forbidden");
  const started = await startCommit(ws.id, batchId);
  if (!started.ok) return fail(started.reason);
  return continueImport(workspaceId, batchId);
}

/** Commits the next chunk of rows; the page calls this until done (resumable after a reload). */
export async function continueImport(workspaceId: string, batchId: string): Promise<ImportActionResult<{ done: boolean; summary: ImportSummary }>> {
  const ws = await authorize(workspaceId, batchId);
  if (!ws) return fail("forbidden");
  const result = await commitNextChunk(ws.id, batchId);
  if (!result.ok) return fail(result.reason);
  if (result.data.done) refresh();
  return result;
}
