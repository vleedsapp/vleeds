"use client";

import { useState, useTransition } from "react";
import { cancelImport, saveMapping } from "@/app/w/[workspaceId]/leads/import/actions";
import { Alert, Button, cx, inputClass } from "@/components/ui/primitives";
import { columnMappingSchema, IMPORT_FIELDS, type ColumnMapping, type ImportFieldKey } from "@/lib/imports/fields";
import { CancelImportButton } from "./cancel-import-button";

/**
 * Map each CSV column to a Vleeds field or "Ignore". Suggestions come from
 * the header names; nothing is required except Company name. Validation runs
 * here and again on the server.
 */
export function MappingForm({
  workspaceId,
  batchId,
  headers,
  samples,
  initial,
}: {
  workspaceId: string;
  batchId: string;
  headers: string[];
  samples: string[][];
  initial: ColumnMapping;
}) {
  const [mapping, setMapping] = useState<ColumnMapping>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const check = columnMappingSchema.safeParse(mapping);
  const duplicates = new Map<number, string>();
  if (!check.success) for (const i of check.error.issues) if (typeof i.path[0] === "number") duplicates.set(i.path[0], i.message);
  const mappedCount = mapping.filter(Boolean).length;

  const submit = () => {
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "Check the mapping.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveMapping(workspaceId, batchId, mapping);
        if (!result.ok) setError(result.error);
      } catch {
        setError("The mapping couldn't be saved. Check your connection and try again.");
      }
    });
  };

  const sample = (i: number) =>
    samples
      .map((r) => r[i])
      .filter((v) => v && v.trim())
      .slice(0, 3)
      .map((v) => (v.length > 40 ? `${v.slice(0, 39)}…` : v));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-4 border-b border-line px-5 py-3 text-[13px] text-ink-subtle md:grid">
        <span>CSV column</span>
        <span>Examples</span>
        <span>Vleeds field</span>
      </div>
      <ul className="divide-y divide-line">
        {headers.map((h, i) => {
          const id = `map-${i}`;
          const dup = duplicates.get(i);
          return (
            <li key={`${h}-${i}`} className="grid gap-2 px-5 py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] md:items-center md:gap-4">
              <label htmlFor={id} className="min-w-0 truncate text-[14.5px] font-medium text-ink" title={h}>
                {h}
              </label>
              <p className="min-w-0 truncate text-[13px] text-ink-subtle">
                <span className="sr-only">Examples: </span>
                {sample(i).join(" · ") || "Empty in the first rows"}
              </p>
              <div className="min-w-0">
                <select
                  id={id}
                  value={mapping[i] ?? ""}
                  onChange={(e) => {
                    const next = [...mapping];
                    next[i] = (e.target.value || null) as ImportFieldKey | null;
                    setMapping(next);
                    setError(null);
                  }}
                  aria-invalid={dup ? true : undefined}
                  aria-describedby={dup ? `${id}-error` : undefined}
                  className={cx(inputClass, !mapping[i] && "text-ink-subtle")}
                >
                  <option value="">Ignore this column</option>
                  <optgroup label="Company">
                    {IMPORT_FIELDS.filter((f) => f.group === "company").map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Contact">
                    {IMPORT_FIELDS.filter((f) => f.group === "contact").map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {dup ? (
                  <p id={`${id}-error`} className="mt-1 text-[12.5px] text-danger">
                    {dup}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
        {error ? <Alert>{error}</Alert> : null}
        <p className="text-[13px] text-ink-subtle" aria-live="polite">
          {mappedCount} of {headers.length} columns mapped. Ignored columns are not imported.
          {!mapping.includes("company_name") ? " Company name is required." : ""}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <CancelImportButton
            disabled={pending}
            onConfirm={() =>
              startTransition(async () => {
                const r = await cancelImport(workspaceId, batchId);
                if (!r.ok) setError(r.error);
              })
            }
          />
          <Button type="submit" variant="primary" size="lg" className="h-11" disabled={pending}>
            {pending ? "Checking rows…" : "Continue to review"}
          </Button>
        </div>
      </div>
    </form>
  );
}
