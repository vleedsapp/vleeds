"use client";

import { GitCompareArrows } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { setDecision } from "@/app/w/[workspaceId]/leads/import/actions";
import { ConfigSheet } from "@/components/settings/config-sheet";
import { Alert, Button, cx } from "@/components/ui/primitives";
import type { ReviewRow } from "@/lib/dal";
import { DECISION_LABEL } from "@/lib/imports/classify";

const DECISION_DETAIL = {
  merge: "Add missing details to the existing company. Existing values are kept; differences are reported.",
  skip: "Leave the existing data unchanged. The row is recorded as skipped.",
  create: "Create a separate company. Use this only if they are genuinely different companies.",
} as const;

/**
 * Decision for one staged row: a labelled select (keyboard friendly) and, for
 * possible duplicates, a comparison sheet with the same choices.
 */
export function DecisionControl({ workspaceId, batchId, row, describedBy }: { workspaceId: string; batchId: string; row: ReviewRow; describedBy?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  // Rendered twice per row (table and mobile card), so ids must not derive from the row alone.
  const selectId = useId();
  const isDuplicate = row.matchState === "matched" || row.matchState === "possible_duplicate";

  const choose = (decision: string, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      try {
        const r = await setDecision(workspaceId, batchId, row.id, decision);
        if (!r.ok) setError(r.error);
        else after?.();
      } catch {
        setError("The decision couldn't be saved. Try again.");
      }
    });

  if (row.matchState === "invalid") {
    return <span className="text-[13px] text-ink-subtle">Not imported</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={selectId} className="sr-only">
        Decision for row {row.rowNumber}
      </label>
      <select
        id={selectId}
        data-row={row.rowNumber}
        value={row.decision ?? ""}
        disabled={pending}
        aria-describedby={describedBy}
        onChange={(e) => e.target.value && choose(e.target.value)}
        className={cx(
          "h-11 min-w-[120px] rounded-md border bg-surface px-2.5 text-[14px] sm:h-9",
          row.decision ? "border-line-strong text-ink" : "border-warning text-warning",
        )}
      >
        {row.decision ? null : <option value="">Choose…</option>}
        {row.allowed.map((d) => (
          <option key={d} value={d}>
            {DECISION_LABEL[d]}
          </option>
        ))}
      </select>
      {isDuplicate ? (
        <Button type="button" className="h-11 sm:h-9" aria-haspopup="dialog" onClick={() => setCompare(true)}>
          <GitCompareArrows aria-hidden className="size-4" />
          Compare<span className="sr-only"> row {row.rowNumber} with the existing company</span>
        </Button>
      ) : null}
      {error ? <span role="alert" className="basis-full text-[12.5px] text-danger">{error}</span> : null}
      {compare ? <CompareSheet row={row} pending={pending} error={error} onChoose={(d) => choose(d, () => setCompare(false))} onClose={() => setCompare(false)} /> : null}
    </div>
  );
}

function CompareSheet({
  row,
  pending,
  error,
  onChoose,
  onClose,
}: {
  row: ReviewRow;
  pending: boolean;
  error: string | null;
  onChoose: (d: "create" | "merge" | "skip") => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<"create" | "merge" | "skip" | null>(row.decision);
  const existing = row.existing;
  const fields: [string, string | null, string | null][] = [
    ["Company name", row.company, existing?.name ?? (row.matchedRowNumber ? `Row ${row.matchedRowNumber} of this file` : null)],
    ["Domain", row.domain, existing?.domain ?? null],
    ["Location", row.location, existing?.location ?? null],
    ["Phone", row.phone, existing?.phone ?? null],
    ["Contact", row.contact, existing?.primaryContact ?? null],
  ];
  const reason =
    row.matchReason === "domain" ? "the same domain" : row.matchReason === "phone" ? "the same phone number" : row.matchReason === "name_location" ? "the same name in the same place" : "a matching identity";

  return (
    <ConfigSheet
      title={`Row ${row.rowNumber}: possible duplicate`}
      description={`This row has ${reason} as ${existing ? "an existing company" : "an earlier row in this file"}.`}
      icon={<GitCompareArrows className="stroke-[1.75]" />}
      dirty={false}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={() => choice && onChoose(choice)}
      saveLabel="Save decision"
    >
      <div className="flex flex-col gap-5">
        <table className="w-full table-fixed border-collapse text-left text-[14px]">
          <caption className="sr-only">Imported row compared with the existing company</caption>
          <thead>
            <tr className="border-b border-line text-[12.5px] text-ink-subtle">
              <th scope="col" className="w-[28%] py-2 pr-2 font-medium">Field</th>
              <th scope="col" className="py-2 pr-2 font-medium">Imported</th>
              <th scope="col" className="py-2 font-medium">Existing</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(([label, a, b]) => (
              <tr key={label} className="border-b border-line align-top last:border-b-0">
                <th scope="row" className="py-2.5 pr-2 font-normal text-ink-subtle">{label}</th>
                <td className="break-words py-2.5 pr-2 text-ink">{a ?? <span className="text-ink-subtle">—</span>}</td>
                <td className="break-words py-2.5 text-ink">{b ?? <span className="text-ink-subtle">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <fieldset>
          <legend className="mb-2 text-[13.5px] font-medium text-ink">What should happen?</legend>
          <div className="flex flex-col gap-2">
            {(["merge", "skip", "create"] as const).map((d) => {
              const allowed = row.allowed.includes(d);
              return (
                <label
                  key={d}
                  className={cx(
                    "flex min-h-11 items-start gap-3 rounded-md border px-3 py-2.5",
                    !allowed ? "cursor-not-allowed border-line bg-surface-muted opacity-70" : choice === d ? "cursor-pointer border-brand bg-brand-tint/60" : "cursor-pointer border-line-strong",
                  )}
                >
                  <input
                    type="radio"
                    name={`compare-${row.id}`}
                    value={d}
                    disabled={!allowed}
                    checked={choice === d}
                    onChange={() => setChoice(d)}
                    aria-describedby={`compare-${row.id}-${d}`}
                    className="mt-0.5 size-4 accent-[var(--color-brand)]"
                  />
                  <span>
                    <span className="block text-[14px] font-medium text-ink">{DECISION_LABEL[d]}</span>
                    <span id={`compare-${row.id}-${d}`} className="block text-[12.5px] text-ink-subtle">
                      {!allowed && d === "create"
                        ? "Not available: a domain identifies one company, so it can't be created twice. Choose Merge or Skip."
                        : DECISION_DETAIL[d]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {!choice ? <Alert tone="info">Choose what should happen to this row.</Alert> : null}
      </div>
    </ConfigSheet>
  );
}
