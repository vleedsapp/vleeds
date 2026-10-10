"use client";

import { Plus, X } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import type { z } from "zod";
import type { SettingsActionResult } from "@/app/w/[workspaceId]/settings/actions";
import { Button, cx, inputClass } from "@/components/ui/primitives";
import { comparisonKey, issuesToFieldErrors, normalizeText, type FieldErrors } from "@/lib/config/icp";

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/** The error for a path, or for anything below it (e.g. "industries" covers "industries.2"). */
export function errorFor(errors: FieldErrors, path: string): string | undefined {
  if (errors[path]) return errors[path];
  const nested = Object.keys(errors).find((k) => k.startsWith(`${path}.`));
  return nested ? errors[nested] : undefined;
}

/** id + aria wiring for a control whose error is rendered by <Field> (id `${id}-error`). */
export function controlProps(id: string, error: string | undefined) {
  return {
    id,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  };
}

export function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="text-[12.5px] text-danger">
      {children}
    </p>
  );
}

// -----------------------------------------------------------------------------
// Save flow shared by every editor
// -----------------------------------------------------------------------------

/**
 * Validates locally with the same Zod schema the server uses (instant
 * feedback), then calls the server action, which authenticates, authorizes
 * and validates again. Server field errors are shown exactly like local ones.
 */
export function useSheetSave(onSaved: () => void, values: unknown) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<{ error: string; fieldErrors: FieldErrors; snapshot: string } | null>(null);
  // Errors describe the values that were submitted; once the user edits, they are cleared until the next Save.
  const current = failure ? (failure.snapshot === JSON.stringify(values) ? failure : null) : null;

  function save<S extends z.ZodType>(schema: S, candidate: unknown, send: (value: z.output<S>) => Promise<SettingsActionResult>) {
    const snapshot = JSON.stringify(values);
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      setFailure({ error: "Check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error.issues), snapshot });
      return;
    }
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await send(parsed.data);
        if (result.ok) onSaved();
        else setFailure({ error: result.error, fieldErrors: result.fieldErrors ?? {}, snapshot });
      } catch {
        setFailure({ error: "Your changes couldn't be saved. Check your connection and try again.", fieldErrors: {}, snapshot });
      }
    });
  }

  return { pending, error: current?.error ?? null, fieldErrors: current?.fieldErrors ?? {}, save };
}

/** Text for a number input ("" when unset). */
export const numberText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** "" → null, otherwise a number (NaN for junk, which the schema rejects with a message). */
export const parseOptionalNumber = (text: string): number | null => (text.trim() === "" ? null : Number(text));

export const parseNumber = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text));

// -----------------------------------------------------------------------------
// Controls
// -----------------------------------------------------------------------------

/** Free-text labels shown as removable chips. Enter, comma or "Add" adds one. */
export function TagInput({
  id,
  label,
  hint,
  values,
  onChange,
  error,
  placeholder,
  itemNoun,
}: {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  error?: string;
  placeholder?: string;
  itemNoun: string;
}) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const shownError = localError ?? error;
  const describedBy = [shownError ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;

  const add = () => {
    const value = normalizeText(draft);
    if (!value) return;
    if (values.some((v) => comparisonKey(v) === comparisonKey(value))) {
      setLocalError(`“${value}” is already listed.`);
      return;
    }
    onChange([...values, value]);
    setDraft("");
    setLocalError(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13.5px] font-medium text-ink">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="-mt-1 text-[12.5px] text-ink-subtle">
          {hint}
        </p>
      ) : null}
      {values.length > 0 ? (
        <ul aria-label={label} className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <li key={v} className="inline-flex h-8 max-w-full items-center gap-1 rounded-full bg-sunken pl-3 pr-1 text-[13px] text-ink">
              <span className="truncate">{v}</span>
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${itemNoun} ${v}`}
                className="grid size-7 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-line-strong/60 hover:text-ink"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setLocalError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          maxLength={80}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy}
          className={inputClass}
        />
        <Button type="button" onClick={add} className="h-11" aria-label={`Add ${itemNoun}`}>
          <Plus aria-hidden className="size-4" />
          <span aria-hidden className="hidden min-[400px]:inline">Add</span>
        </Button>
      </div>
      <FieldError id={`${id}-error`}>{shownError}</FieldError>
    </div>
  );
}

/** Accessible on/off switch (a checkbox with role="switch"); the label text always states the value. */
export function Switch({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label htmlFor={id} className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-[13.5px] text-ink">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative h-6 w-10 shrink-0 rounded-full bg-line-strong transition-colors peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-surface after:shadow-card after:transition-transform peer-checked:after:translate-x-4"
      />
      <span aria-hidden>{checked ? "Enabled" : "Disabled"}</span>
    </label>
  );
}

/** Compact relative-weight indicator; the number is always shown next to it. */
export function WeightBar({ value, max = 100, tone = "brand" }: { value: number; max?: number; tone?: "brand" | "warning" }) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span aria-hidden className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-sunken">
      <span className={cx("block h-full rounded-full", tone === "brand" ? "bg-brand" : "bg-warning")} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Bordered sub-card for one entry (role, signal, exclusion). */
export function EntryCard({ children, label }: { children: ReactNode; label: string }) {
  return (
    <li aria-label={label} className="rounded-lg border border-line bg-surface-muted p-3.5 sm:p-4">
      {children}
    </li>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-subtle">{children}</h3>;
}

/** Helper text shown at the top of an editor. */
export function Intro({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-6 text-ink-muted">{children}</p>;
}

export function newEntryId(): string {
  return crypto.randomUUID();
}
