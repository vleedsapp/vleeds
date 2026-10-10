"use client";

import { UserPlus, UserRound } from "lucide-react";
import { useState, useTransition } from "react";
import { addContact, type AddContactResult } from "@/app/w/[workspaceId]/leads/actions";
import { ConfigSheet } from "@/components/settings/config-sheet";
import { controlProps } from "@/components/settings/fields";
import { Button, cx, Field, inputClass } from "@/components/ui/primitives";
import { SENIORITY_HINTS } from "@/lib/config/icp";
import type { FieldErrors } from "@/lib/config/icp";

const SENIORITY_TEXT: Record<(typeof SENIORITY_HINTS)[number], string> = {
  executive: "Executive",
  director: "Director",
  manager: "Manager",
  individual_contributor: "Individual contributor",
};

const EMPTY = { fullName: "", firstName: "", lastName: "", jobTitle: "", seniority: "", email: "", phone: "", linkedinUrl: "", notes: "" };

/** "Add contact" in the company drawer. Matching: same email is refused; same name asks first. */
export function AddContactButton({ workspaceId, companyId, companyName, hasPrimary }: { workspaceId: string; companyId: string; companyName: string; hasPrimary: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="soft" className="h-11 self-start sm:h-9" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden className="size-4" />
        Add contact
      </Button>
      {open ? <AddContactSheet workspaceId={workspaceId} companyId={companyId} companyName={companyName} hasPrimary={hasPrimary} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AddContactSheet({ workspaceId, companyId, companyName, hasPrimary, onClose }: { workspaceId: string; companyId: string; companyName: string; hasPrimary: boolean; onClose: () => void }) {
  const [v, setV] = useState(EMPTY);
  const [isPrimary, setIsPrimary] = useState(!hasPrimary);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<FieldErrors>({});
  const [duplicateName, setDuplicateName] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    setDuplicateName(null);
  };

  const submit = (confirmCreate: boolean) =>
    startTransition(async () => {
      let result: AddContactResult;
      try {
        result = await addContact(workspaceId, companyId, {
          contact: { ...v, seniority: v.seniority || null },
          isPrimary,
          confirmCreate,
        });
      } catch {
        setError("The contact couldn't be saved. Check your connection and try again.");
        return;
      }
      if (result.ok) onClose();
      else if ("duplicate" in result) {
        setError(null);
        setDuplicateName(result.duplicate.name);
      } else {
        setError(result.error);
        setFe(result.fieldErrors ?? {});
      }
    });

  const input = (id: string, key: keyof typeof EMPTY, extra: Record<string, unknown> = {}) => (
    <input {...controlProps(id, fe[key])} value={v[key]} onChange={set(key)} className={inputClass} {...extra} />
  );

  return (
    <ConfigSheet
      title="Add contact"
      description={`A person at ${companyName}.`}
      icon={<UserRound className="stroke-[1.75]" />}
      dirty={Object.values(v).some((x) => x.trim() !== "")}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={() => submit(false)}
      saveLabel="Add contact"
    >
      <div className="flex flex-col gap-5">
        {duplicateName ? (
          <div role="alert" className="rounded-lg border border-warning/30 bg-warning-tint px-4 py-3.5">
            <p className="text-[14px] font-semibold text-ink">{duplicateName} is already a contact here</p>
            <p className="mt-0.5 text-[13.5px] text-ink-muted">If this is a different person with the same name, add them anyway.</p>
            <div className="mt-3 flex justify-end">
              <Button type="button" className="h-10" disabled={pending} onClick={() => submit(true)}>
                Add anyway
              </Button>
            </div>
          </div>
        ) : null}
        <Field label="Full name" htmlFor="ac-full" error={fe.fullName} hint="Or fill in first and last name.">
          {input("ac-full", "fullName", { autoFocus: true, maxLength: 200, "aria-describedby": fe.fullName ? "ac-full-error" : "ac-full-hint" })}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" htmlFor="ac-first" error={fe.firstName} optional>
            {input("ac-first", "firstName", { maxLength: 100 })}
          </Field>
          <Field label="Last name" htmlFor="ac-last" error={fe.lastName} optional>
            {input("ac-last", "lastName", { maxLength: 100 })}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job title" htmlFor="ac-title" error={fe.jobTitle} optional>
            {input("ac-title", "jobTitle", { maxLength: 200 })}
          </Field>
          <Field label="Seniority" htmlFor="ac-seniority" optional>
            <select id="ac-seniority" value={v.seniority} onChange={set("seniority")} className={inputClass}>
              <option value="">Not set</option>
              {SENIORITY_HINTS.map((s) => (
                <option key={s} value={s}>
                  {SENIORITY_TEXT[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Email" htmlFor="ac-email" error={fe.email} optional>
            {input("ac-email", "email", { type: "email", autoCapitalize: "none" })}
          </Field>
          <Field label="Phone" htmlFor="ac-phone" error={fe.phone} optional>
            {input("ac-phone", "phone", { type: "tel" })}
          </Field>
        </div>
        <Field label="Profile URL" htmlFor="ac-profile" error={fe.linkedinUrl} optional>
          {input("ac-profile", "linkedinUrl", { type: "url", placeholder: "https://", autoCapitalize: "none" })}
        </Field>
        <Field label="Notes" htmlFor="ac-notes" error={fe.notes} optional>
          <textarea {...controlProps("ac-notes", fe.notes)} value={v.notes} onChange={set("notes")} rows={3} maxLength={5000} className={cx(inputClass, "h-auto py-2.5 leading-6")} />
        </Field>
        <label className="flex min-h-11 items-center gap-3 text-[14px] text-ink">
          <input
            type="checkbox"
            checked={isPrimary}
            disabled={hasPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            aria-describedby="ac-primary-hint"
            className="size-[18px] accent-[var(--color-brand)]"
          />
          Primary contact
        </label>
        <p id="ac-primary-hint" className="-mt-4 text-[12.5px] text-ink-subtle">
          {hasPrimary ? "This company already has a primary contact." : "The main person to talk to at this company."}
        </p>
        {fe.isPrimary ? <p className="text-[12.5px] text-danger">{fe.isPrimary}</p> : null}
      </div>
    </ConfigSheet>
  );
}
