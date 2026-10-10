import type { Decision, MatchState } from "./classify";

export type CommitResult = "created" | "merged" | "skipped" | "failed";

export type RowOutcomeInput = { matchState: MatchState; decision: Decision | null; commitResult: CommitResult | null };

export type ImportSummary = {
  total: number;
  valid: number;
  invalid: number;
  /** Before commit */
  newRows: number;
  duplicates: number;
  toCreate: number;
  toMerge: number;
  toSkip: number;
  undecided: number;
  /** create + merge: exactly what the Import button will write */
  toImport: number;
  /** After commit */
  created: number;
  merged: number;
  skipped: number;
  failed: number;
  pending: number;
};

/** Counts for the review confirmation and the final report (invalid rows are counted once, as invalid). */
export function summarize(rows: RowOutcomeInput[]): ImportSummary {
  const s: ImportSummary = {
    total: rows.length, valid: 0, invalid: 0, newRows: 0, duplicates: 0, toCreate: 0, toMerge: 0, toSkip: 0,
    undecided: 0, toImport: 0, created: 0, merged: 0, skipped: 0, failed: 0, pending: 0,
  };
  for (const r of rows) {
    if (r.matchState === "invalid") {
      s.invalid++;
      continue;
    }
    s.valid++;
    if (r.matchState === "new") s.newRows++;
    if (r.matchState === "matched" || r.matchState === "possible_duplicate") s.duplicates++;
    if (r.decision === "create") s.toCreate++;
    else if (r.decision === "merge") s.toMerge++;
    else if (r.decision === "skip") s.toSkip++;
    else s.undecided++;
    if (r.commitResult === "created") s.created++;
    else if (r.commitResult === "merged") s.merged++;
    else if (r.commitResult === "skipped") s.skipped++;
    else if (r.commitResult === "failed") s.failed++;
    else s.pending++;
  }
  s.toImport = s.toCreate + s.toMerge;
  return s;
}
