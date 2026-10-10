"use client";

import { Check, Copy, Phone, PhoneCall } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { loadContactSheet, recordContactOutcome } from "@/app/w/[workspaceId]/today/actions";
import { ConfigSheet } from "@/components/settings/config-sheet";
import { Alert, Button, buttonClass, cx, Field, inputClass } from "@/components/ui/primitives";
import { DISPOSITION_LABEL, DISPOSITION_RULES, NEXT_FIELD_WORD, OPTIONAL_NEXT_LABEL, SCOPE_LABEL, TASK_KIND_LABEL } from "@/lib/contact-workflow/dispositions";
import { DISPOSITIONS, SUPPRESSION_SCOPES, type Disposition, type SuppressionScope, type TaskKind } from "@/lib/contact-workflow/types";
import type { ContactSheetData } from "@/lib/contact-workflow/view";
import { useWorkflowSheet } from "./sheet-host";

/**
 * Start contact (P1-E7). Opening this sheet, copying the number or using
 * "Call on device" (a tel: link handled by the user's own phone/system) never
 * records anything. An attempt is saved only when the user submits an outcome.
 */
export function StartContactButton({
  workspaceId,
  companyId,
  contactId,
  taskId = null,
  label = "Call",
  accessibleLabel,
  variant = "soft",
  className,
  iconOnly,
}: {
  workspaceId: string;
  companyId: string;
  contactId: string;
  taskId?: string | null;
  label?: string;
  accessibleLabel?: string;
  variant?: "soft" | "secondary" | "primary";
  className?: string;
  iconOnly?: boolean;
}) {
  const sheet = useWorkflowSheet();
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={accessibleLabel}
        onClick={() => sheet.open((close) => <ContactSheet workspaceId={workspaceId} companyId={companyId} contactId={contactId} taskId={taskId} onClose={close} />)}
        className={buttonClass(variant, cx(iconOnly ? "min-h-11 min-w-11 px-0" : "min-h-11 sm:min-h-9", className))}
      >
        <Phone aria-hidden className="size-4" />
        {iconOnly ? null : label}
      </button>
      {sheet.element}
    </>
  );
}

type Draft = {
  disposition: Disposition | null;
  note: string;
  scheduleNext: boolean;
  nextKind: TaskKind | null;
  date: string;
  time: string;
  nextNote: string;
  scope: SuppressionScope | null;
  reason: string;
};

const EMPTY: Draft = { disposition: null, note: "", scheduleNext: false, nextKind: null, date: "", time: "", nextNote: "", scope: null, reason: "" };

function ContactSheet({
  workspaceId,
  companyId,
  contactId,
  taskId,
  onClose,
}: {
  workspaceId: string;
  companyId: string;
  contactId: string;
  taskId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<ContactSheetData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; hint?: string } | null>(null);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const id = useId();

  useEffect(() => {
    let live = true;
    loadContactSheet(workspaceId, { companyId, contactId, taskId }).then(
      (r) => {
        if (!live) return;
        if (r.ok) setData(r.data);
        else setLoadError(r.error);
      },
      () => live && setLoadError("This contact couldn't be loaded. Try again."),
    );
    return () => {
      live = false;
    };
  }, [workspaceId, companyId, contactId, taskId]);

  const rule = draft.disposition ? DISPOSITION_RULES[draft.disposition] : null;
  const showNext = !!rule && (rule.next === "required" || (rule.next === "optional" && draft.scheduleNext));
  const nextKind: TaskKind | null = showNext && rule ? (draft.nextKind && rule.nextKinds.includes(draft.nextKind) ? draft.nextKind : rule.nextKinds[0]) : null;
  const word = nextKind ? NEXT_FIELD_WORD[nextKind] : "";
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = !done && (draft.disposition !== null || draft.note.trim() !== "");

  const copy = async () => {
    if (!data?.contact.phone) return;
    try {
      await navigator.clipboard.writeText(data.contact.phone);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  const submit = async () => {
    if (done) return onClose();
    if (!data || data.blocked) return onClose();
    if (!draft.disposition) return setError("Choose what happened.");
    if (nextKind && (!draft.date || !draft.time)) return setError(`Choose the ${word.toLowerCase()} date and time.`);
    setPending(true);
    setError(null);
    try {
      const r = await recordContactOutcome(workspaceId, {
        companyId,
        contactId,
        requestId: data.requestId,
        sourceTaskId: data.task?.id ?? null,
        disposition: draft.disposition,
        note: draft.note || null,
        next: nextKind ? { kind: nextKind, date: draft.date, time: draft.time, note: draft.nextNote || null } : null,
        scope: draft.disposition === "do_not_contact" ? draft.scope : null,
        reason: draft.disposition === "do_not_contact" ? draft.reason || null : null,
      });
      if (r.ok) setDone({ message: r.message, hint: r.hint });
      else setError(r.error);
    } catch {
      setError("The outcome couldn't be saved. Try again.");
    } finally {
      setPending(false);
    }
  };

  const contactName = data?.contact.name ?? "contact";
  const finished = !!done || !!data?.blocked || !!loadError;

  return (
    <ConfigSheet
      title="Start contact"
      description={data ? `${data.contact.name} · ${data.company.name}` : "Loading contact…"}
      icon={<PhoneCall className="stroke-[1.75]" />}
      dirty={dirty}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={submit}
      saveLabel={finished ? "Done" : "Save outcome"}
      pendingLabel="Saving…"
      hideCancel={finished}
    >
      {loadError ? (
        <Alert>{loadError}</Alert>
      ) : !data ? (
        <p role="status" className="text-[14px] text-ink-muted">
          Loading…
        </p>
      ) : done ? (
        <div role="status" className="flex flex-col gap-3">
          <div className="flex items-start gap-3 rounded-md border border-brand/15 bg-brand-tint px-3.5 py-3 text-[14px] leading-5 text-brand-strong">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>{done.message}</p>
          </div>
          {done.hint ? <p className="text-[14px] text-ink-muted">{done.hint}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md border border-line bg-surface-muted px-3.5 py-3 text-[14px]">
            <Info label="Company">
              {data.company.name} <span className="text-ink-subtle">· {data.company.fitLabel}</span>
            </Info>
            <Info label="Contact">
              {data.contact.name}
              {data.contact.jobTitle ? <span className="text-ink-subtle"> · {data.contact.jobTitle}</span> : null}
            </Info>
            <Info label="Phone">{data.contact.phone ?? <span className="text-ink-subtle">No phone number</span>}</Info>
            <Info label="Last attempt">{data.lastAttempt}</Info>
            {data.task ? (
              <Info label="Due task">
                {data.task.kindLabel} · {data.task.dueLabel}
                {data.task.stateLabel ? <span className="text-ink-subtle"> · {data.task.stateLabel}</span> : null}
              </Info>
            ) : null}
          </dl>

          {data.blocked ? (
            <Alert>
              {data.blocked}. No contact attempt can be logged
              {data.otherContacts ? "; try another contact at this company." : "."}
            </Alert>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {data.contact.phone ? (
                  <Button type="button" className="h-11 sm:h-10" onClick={copy}>
                    <Copy aria-hidden className="size-4" />
                    Copy number
                  </Button>
                ) : null}
                {data.contact.telHref ? (
                  <a href={data.contact.telHref} className={buttonClass("secondary", "h-11 sm:h-10")}>
                    <Phone aria-hidden className="size-4" />
                    Call on device
                  </a>
                ) : null}
                <p role="status" aria-live="polite" className="basis-full text-[12.5px] text-ink-subtle">
                  {copied === "copied" ? "Number copied. " : copied === "failed" ? "Couldn't copy; select the number above. " : ""}
                  Nothing is recorded until you save an outcome.
                </p>
              </div>

              <fieldset className="flex flex-col gap-2.5">
                <legend className="mb-2 text-[15px] font-semibold text-ink">What happened?</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {DISPOSITIONS.map((d) => (
                    <label
                      key={d}
                      className={cx(
                        "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-3 text-[14px] transition-colors",
                        draft.disposition === d ? "border-brand bg-brand-tint font-medium text-brand-strong" : "border-line-strong text-ink hover:bg-surface-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${id}-disposition`}
                        value={d}
                        checked={draft.disposition === d}
                        onChange={() => setDraft((x) => ({ ...x, disposition: d, scheduleNext: false, nextKind: null, scope: null }))}
                        className="size-4 accent-[var(--color-brand)]"
                      />
                      {DISPOSITION_LABEL[d]}
                    </label>
                  ))}
                </div>
              </fieldset>

              {rule?.next === "optional" && draft.disposition ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[14px] font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={draft.scheduleNext}
                    onChange={(e) => set("scheduleNext", e.target.checked)}
                    className="size-[18px] rounded accent-[var(--color-brand)]"
                  />
                  {OPTIONAL_NEXT_LABEL[draft.disposition] ?? "Schedule a next action"}
                </label>
              ) : null}

              {showNext && rule && nextKind ? (
                <div className="flex flex-col gap-4 rounded-md border border-line px-3.5 py-3.5">
                  {rule.nextKinds.length > 1 ? (
                    <Field label="Next action" htmlFor={`${id}-kind`}>
                      <select id={`${id}-kind`} value={nextKind} onChange={(e) => set("nextKind", e.target.value as TaskKind)} className={inputClass}>
                        {rule.nextKinds.map((k) => (
                          <option key={k} value={k}>
                            {TASK_KIND_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={`${word} date`} htmlFor={`${id}-date`}>
                      <input id={`${id}-date`} type="date" required min={data.today} value={draft.date} onChange={(e) => set("date", e.target.value)} aria-describedby={`${id}-tz`} className={inputClass} />
                    </Field>
                    <Field label={`${word} time`} htmlFor={`${id}-time`}>
                      <input id={`${id}-time`} type="time" required value={draft.time} onChange={(e) => set("time", e.target.value)} aria-describedby={`${id}-tz`} className={inputClass} />
                    </Field>
                  </div>
                  <p id={`${id}-tz`} className="-mt-2 text-[12.5px] text-ink-subtle">
                    Time zone: {data.timezoneLabel}
                  </p>
                  <Field label={`${word} note`} htmlFor={`${id}-next-note`} optional>
                    <input id={`${id}-next-note`} value={draft.nextNote} onChange={(e) => set("nextNote", e.target.value)} maxLength={1000} className={inputClass} />
                  </Field>
                </div>
              ) : null}

              {draft.disposition === "do_not_contact" ? (
                <div className="flex flex-col gap-4 rounded-md border border-line px-3.5 py-3.5">
                  <fieldset>
                    <legend className="mb-2 text-[14px] font-medium text-ink">Who should not be contacted?</legend>
                    <div className="flex flex-col gap-2">
                      {SUPPRESSION_SCOPES.map((s) => (
                        <label key={s} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[14px] text-ink">
                          <input
                            type="radio"
                            name={`${id}-scope`}
                            value={s}
                            checked={draft.scope === s}
                            onChange={() => set("scope", s)}
                            className="size-4 accent-[var(--color-brand)]"
                          />
                          {s === "contact" ? `${SCOPE_LABEL.contact} (${contactName})` : `${SCOPE_LABEL.company} (${data.company.name})`}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <p className="text-[12.5px] text-ink-subtle">
                    Creates a do-not-contact restriction and cancels open tasks in that scope. Only owners and admins can lift it.
                  </p>
                  <Field label="Reason" htmlFor={`${id}-reason`} optional>
                    <input id={`${id}-reason`} value={draft.reason} onChange={(e) => set("reason", e.target.value)} maxLength={500} className={inputClass} />
                  </Field>
                </div>
              ) : null}

              {draft.disposition ? (
                <Field label={rule?.noteRequired ? "Note (required)" : "Note"} htmlFor={`${id}-note`} optional={!rule?.noteRequired}>
                  <textarea
                    id={`${id}-note`}
                    value={draft.note}
                    onChange={(e) => set("note", e.target.value)}
                    maxLength={1000}
                    rows={3}
                    required={rule?.noteRequired}
                    className={`${inputClass} h-auto py-2.5 leading-6`}
                  />
                </Field>
              ) : null}

              {draft.disposition === "wrong_number" ? (
                <p className="text-[13px] text-ink-muted">The phone number is kept as it is; nothing is restricted.</p>
              ) : null}
            </>
          )}
        </div>
      )}
    </ConfigSheet>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </>
  );
}
