import Papa from "papaparse";
import { IMPORT_LIMITS, type CsvError } from "./limits";

export { checkCsvFile, type CsvError } from "./limits";

/**
 * CSV reading for imports, built on Papa Parse (handles quoted commas, quoted
 * line breaks, CRLF/LF/CR and escaped quotes). Values are only ever treated
 * as text: nothing is evaluated, and spreadsheet formulas such as "=SUM(A1)"
 * stay literal strings.
 */

export type ParsedCsv = { headers: string[]; rows: string[][] };

/** UTF-8 (with or without BOM), falling back to Windows-1252 for legacy exports. */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * Parses CSV text. The first non-blank line is the header row. Blank rows
 * are dropped; short rows are padded and long rows trimmed to the header
 * width; blank or repeated header names are made unique ("Email", "Email (2)").
 */
export function parseCsv(text: string): { ok: true; csv: ParsedCsv } | { ok: false; error: CsvError } {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!input.trim()) return { ok: false, error: { code: "empty", message: "This file has no rows." } };

  const result = Papa.parse<string[]>(input, {
    header: false,
    skipEmptyLines: "greedy",
    dynamicTyping: false, // values stay strings
    preview: IMPORT_LIMITS.maxRows + 2,
  });
  const data = result.data.filter((r) => Array.isArray(r) && r.some((v) => String(v ?? "").trim() !== ""));
  if (result.errors.some((e) => e.type === "Quotes" && e.code === "MissingQuotes")) {
    return { ok: false, error: { code: "unreadable", message: "This file has an unclosed quote and can't be read reliably." } };
  }
  if (data.length === 0) return { ok: false, error: { code: "empty", message: "This file has no rows." } };

  const rawHeaders = data[0].map((h) => String(h ?? "").trim());
  if (rawHeaders.every((h) => h === "")) {
    return { ok: false, error: { code: "no_header", message: "The first row should contain column names." } };
  }
  if (rawHeaders.length > IMPORT_LIMITS.maxColumns) {
    return { ok: false, error: { code: "too_many_columns", message: `This file has more than ${IMPORT_LIMITS.maxColumns} columns.` } };
  }
  const rows = data.slice(1);
  if (rows.length === 0) return { ok: false, error: { code: "empty", message: "This file has column names but no rows." } };
  if (rows.length > IMPORT_LIMITS.maxRows) {
    return { ok: false, error: { code: "too_many_rows", message: `This file has more than ${IMPORT_LIMITS.maxRows.toLocaleString("en")} rows. Split it into smaller files.` } };
  }

  const headers = uniqueHeaders(rawHeaders);
  const width = headers.length;
  return {
    ok: true,
    csv: {
      headers,
      rows: rows.map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? ""))),
    },
  };
}

export function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = (h || `Column ${i + 1}`).slice(0, 120);
    const key = base.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}
