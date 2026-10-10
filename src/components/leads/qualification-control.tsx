"use client";

import { useState, useTransition } from "react";
import { setCompanyQualification } from "@/app/w/[workspaceId]/leads/actions";
import { Alert, Button, cx, Field, inputClass } from "@/components/ui/primitives";
import { QUALIFICATION_LABEL } from "@/lib/lead-core/display";
import { QUALIFICATION_STATES, type QualificationState } from "@/lib/lead-core/schemas";

/**
 * Small operational control: pick a qualification state, optionally say why,
 * save. Any workspace member may use it; the server action re-authorizes and
 * validates, and RLS has the final say.
 */
export function QualificationControl({
  workspaceId,
  companyId,
  state,
  reason,
}: {
  workspaceId: string;
  companyId: string;
  state: QualificationState;
  reason: string | null;
}) {
  const [value, setValue] = useState(state);
  const [why, setWhy] = useState(reason ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = value !== state || why.trim() !== (reason ?? "");

  const save = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await setCompanyQualification(workspaceId, companyId, { state: value, reason: why });
        if (result.ok) setSaved(true);
        else setError(result.fieldErrors?.reason ?? result.error);
      } catch {
        setError("The qualification couldn't be saved. Check your connection and try again.");
      }
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !pending) save();
      }}
      className="flex flex-col gap-3"
      noValidate
    >
      <fieldset>
        <legend className="sr-only">Qualification state</legend>
        <div className="grid grid-cols-2 gap-2">
          {QUALIFICATION_STATES.map((s) => (
            <label
              key={s}
              className={cx(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-[13.5px] font-medium",
                value === s ? "border-brand bg-brand-tint/60 text-ink" : "border-line-strong bg-surface text-ink-muted hover:bg-surface-muted",
              )}
            >
              <input
                type="radio"
                name={`qualification-${companyId}`}
                value={s}
                checked={value === s}
                onChange={() => {
                  setValue(s);
                  setSaved(false);
                }}
                className="size-4 accent-[var(--color-brand)]"
              />
              {QUALIFICATION_LABEL[s].label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Reason" htmlFor={`qualification-reason-${companyId}`} optional>
        <input
          id={`qualification-reason-${companyId}`}
          value={why}
          onChange={(e) => {
            setWhy(e.target.value);
            setSaved(false);
          }}
          maxLength={500}
          placeholder="Why this decision?"
          className={inputClass}
        />
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex items-center justify-end gap-3">
        <p aria-live="polite" className="text-[13px] text-ink-subtle">
          {saved && !dirty ? "Saved" : ""}
        </p>
        <Button type="submit" variant="primary" className="h-11 sm:h-10" disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save qualification"}
        </Button>
      </div>
    </form>
  );
}
