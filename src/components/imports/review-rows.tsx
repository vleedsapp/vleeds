import Link from "next/link";
import { StatusPill, type Tone } from "@/components/ui/primitives";
import type { ReviewRow } from "@/lib/dal";
import { DECISION_LABEL } from "@/lib/imports/classify";
import { fieldLabelFor } from "@/lib/imports/fields";
import { DecisionControl } from "./decision-control";

/**
 * High-density review/report rows: a table on md+, cards below. Validation
 * problems are listed per row and linked to its decision control.
 */

function validation(row: ReviewRow): { label: string; tone: Tone } {
  if (row.issues.some((i) => i.level === "error")) return { label: "Error", tone: "danger" };
  if (row.issues.length) return { label: "Warning", tone: "warning" };
  return { label: "Valid", tone: "brand" };
}

function matchText(row: ReviewRow): string {
  switch (row.matchState) {
    case "new":
      return "New company";
    case "matched":
      return row.matchedRowNumber ? `Same domain as row ${row.matchedRowNumber}` : `Same domain as ${row.existing?.name ?? "an existing company"}`;
    case "possible_duplicate": {
      const what = row.matchReason === "phone" ? "Same phone as" : "Same name and place as";
      return `Possible duplicate: ${what} ${row.matchedRowNumber ? `row ${row.matchedRowNumber}` : (row.existing?.name ?? "an existing company")}`;
    }
    case "invalid":
      return "—";
    default:
      return "Not checked";
  }
}

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  created: { label: "Created", tone: "brand" },
  merged: { label: "Merged", tone: "info" },
  skipped: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

function outcomeText(row: ReviewRow): string {
  if (row.matchState === "invalid") return "Invalid: " + row.issues.filter((i) => i.level === "error").map((i) => i.message).join(" ");
  switch (row.commitResult) {
    case "created":
      return "Created company";
    case "merged":
      return `Merged into ${row.existing?.name ?? "the existing company"}`;
    case "skipped":
      return "Skipped";
    case "failed":
      return "Failed";
    default:
      return "Not processed";
  }
}

function Issues({ row, id }: { row: ReviewRow; id: string }) {
  if (!row.issues.length) return null;
  return (
    <ul id={id} className="mt-1 flex flex-col gap-0.5 text-[12.5px]">
      {row.issues.map((i, n) => (
        <li key={n} className={i.level === "error" ? "text-danger" : "text-warning"}>
          {fieldLabelFor(i.field)}: {i.message}
        </li>
      ))}
    </ul>
  );
}

export function ReviewRows({
  rows,
  mode,
  workspaceId,
  batchId,
  companyHref,
}: {
  rows: ReviewRow[];
  mode: "review" | "report";
  workspaceId: string;
  batchId: string;
  companyHref: (id: string) => string;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <caption className="sr-only">{mode === "review" ? "Rows to review" : "Row outcomes"}</caption>
          <thead>
            <tr className="border-b border-line text-[13px] text-ink-subtle">
              <th scope="col" className="w-16 py-3 pl-5 pr-2 font-medium">Row</th>
              <th scope="col" className="px-2 py-3 font-medium">Company</th>
              <th scope="col" className="px-2 py-3 font-medium">Contact</th>
              <th scope="col" className="w-[22%] px-2 py-3 font-medium">Validation</th>
              <th scope="col" className="px-2 py-3 font-medium">{mode === "review" ? "Match" : "Outcome"}</th>
              <th scope="col" className="w-56 px-2 py-3 pr-5 font-medium">{mode === "review" ? "Decision" : "Details"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const v = validation(row);
              const issuesId = `issues-${row.id}`;
              return (
                <tr key={row.id} className="border-b border-line align-top last:border-b-0">
                  <td className="py-3 pl-5 pr-2 text-[13.5px] tabular-nums text-ink-subtle">{row.rowNumber}</td>
                  <td className="px-2 py-3">
                    <div className="text-[14.5px] font-medium text-ink">{row.company ?? <span className="text-ink-subtle">Missing</span>}</div>
                    <div className="text-[13px] text-ink-subtle">{[row.domain, row.location].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-2 py-3">
                    <div className="text-[14px] text-ink">{row.contact ?? <span className="text-ink-subtle">—</span>}</div>
                    {row.contactEmail ? <div className="break-all text-[13px] text-ink-subtle">{row.contactEmail}</div> : null}
                  </td>
                  <td className="px-2 py-3">
                    <StatusPill tone={v.tone} dot className="h-6 px-2.5 text-[12px]">{v.label}</StatusPill>
                    <Issues row={row} id={issuesId} />
                  </td>
                  <td className="px-2 py-3 text-[13.5px] text-ink-muted">
                    {mode === "review" ? matchText(row) : (
                      row.commitResult && OUTCOME[row.commitResult] && row.matchState !== "invalid"
                        ? <StatusPill tone={OUTCOME[row.commitResult].tone} className="h-6 px-2.5 text-[12px]">{OUTCOME[row.commitResult].label}</StatusPill>
                        : <StatusPill tone="danger" className="h-6 px-2.5 text-[12px]">Invalid</StatusPill>
                    )}
                  </td>
                  <td className="px-2 py-3 pr-5">
                    {mode === "review" ? (
                      <DecisionControl workspaceId={workspaceId} batchId={batchId} row={row} describedBy={row.issues.length ? issuesId : undefined} />
                    ) : (
                      <ReportDetails row={row} companyHref={companyHref} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul aria-label={mode === "review" ? "Rows to review" : "Row outcomes"} className="divide-y divide-line md:hidden">
        {rows.map((row) => {
          const v = validation(row);
          const issuesId = `issues-m-${row.id}`;
          return (
            <li key={row.id} className="flex flex-col gap-2 px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] text-ink-subtle">Row {row.rowNumber}</p>
                  <p className="truncate text-[15px] font-semibold text-ink">{row.company ?? "Missing company name"}</p>
                  <p className="truncate text-[13px] text-ink-subtle">{[row.contact, row.domain].filter(Boolean).join(" · ")}</p>
                </div>
                <StatusPill tone={v.tone} dot className="h-6 px-2.5 text-[12px]">{v.label}</StatusPill>
              </div>
              <Issues row={row} id={issuesId} />
              <p className="text-[13px] text-ink-muted">{mode === "review" ? matchText(row) : outcomeText(row)}</p>
              {mode === "review" ? (
                <DecisionControl workspaceId={workspaceId} batchId={batchId} row={row} describedBy={row.issues.length ? issuesId : undefined} />
              ) : (
                <ReportDetails row={row} companyHref={companyHref} />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ReportDetails({ row, companyHref }: { row: ReviewRow; companyHref: (id: string) => string }) {
  return (
    <div className="flex flex-col gap-1 text-[13px] text-ink-muted">
      {row.committedCompanyId && (row.commitResult === "created" || row.commitResult === "merged") ? (
        <Link href={companyHref(row.committedCompanyId)} className="font-medium text-brand hover:underline">
          Open {row.existing?.name ?? "company"}
        </Link>
      ) : null}
      {row.decision && row.matchState !== "invalid" ? <span className="text-ink-subtle">Decision: {DECISION_LABEL[row.decision]}</span> : null}
      {row.commitNotes.map((n, i) => (
        <span key={i}>{n}</span>
      ))}
    </div>
  );
}
