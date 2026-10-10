/**
 * Practical MVP limits for CSV imports. The database mirrors the row and
 * column limits (import_batches.total_rows, headers length).
 */
export const IMPORT_LIMITS = {
  /** Raw file size. The Server Action body limit (next.config.ts) leaves room for multipart overhead. */
  maxFileBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  maxColumns: 100,
  /** A single cell longer than this is treated as an error (and shortened in the staged copy). */
  maxCellChars: 1000,
  /** Rows written per staging request and committed per commit step. */
  stageChunk: 500,
  commitChunk: 100,
  /** Rows shown per page in review and report tables. */
  reviewPageSize: 50,
} as const;

export const ACCEPTED_EXTENSIONS = [".csv"] as const;
export const ACCEPTED_MIME_TYPES = ["text/csv", "application/vnd.ms-excel", "text/plain", "application/csv", ""] as const;

export type CsvError = { code: "empty" | "too_large" | "not_csv" | "too_many_rows" | "too_many_columns" | "no_header" | "unreadable"; message: string };

/**
 * Checks a file before reading it: on the server (authoritative) and in the
 * browser for fast feedback. Kept here, free of the parser, so the browser
 * bundle doesn't include Papa Parse. Browser-reported MIME types are not
 * trusted; the content must still parse as CSV on the server.
 */
export function checkCsvFile(file: { name: string; size: number }): CsvError | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return { code: "not_csv", message: "Choose a .csv file. Spreadsheet files (.xls, .xlsx) can be saved as CSV first." };
  }
  if (file.size === 0) return { code: "empty", message: "This file is empty." };
  if (file.size > IMPORT_LIMITS.maxFileBytes) {
    return { code: "too_large", message: `This file is larger than ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB. Split it into smaller files.` };
  }
  return null;
}
