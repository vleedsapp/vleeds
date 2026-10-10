"use client";

import { Building, ChevronDown, FileUp, PencilLine, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { createCompany, type CreateCompanyResult } from "@/app/w/[workspaceId]/leads/actions";
import { controlProps } from "@/components/settings/fields";
import { ConfigSheet } from "@/components/settings/config-sheet";
import { Button, buttonClass, cx, Field, inputClass } from "@/components/ui/primitives";
import { useDismiss } from "@/components/ui/use-dismiss";
import { countryOptions } from "@/lib/config/countries";
import type { FieldErrors } from "@/lib/config/icp";
import type { CompanySummary } from "@/lib/lead-core/views";

/** "Add leads" primary action: add a company manually, or import a CSV. */
export function AddLeadsMenu({ workspaceId, leadsPath }: { workspaceId: string; leadsPath: string }) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(open, close, root, trigger);

  return (
    <div ref={root} className="relative">
      <Button
        ref={trigger}
        variant="primary"
        size="lg"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-11"
      >
        <Plus aria-hidden className="size-[18px]" />
        Add leads
        <ChevronDown aria-hidden className="size-4" />
      </Button>
      {open ? (
        <div role="menu" aria-label="Add leads" className="absolute left-0 z-30 mt-2 w-64 sm:left-auto sm:right-0 rounded-lg border border-line bg-surface p-1.5 shadow-pop">
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              setOpen(false);
              setManual(true);
            }}
            className="flex min-h-11 w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-muted"
          >
            <PencilLine aria-hidden className="mt-0.5 size-[18px] shrink-0 text-ink-muted" />
            <span>
              <span className="block text-[14.5px] font-medium text-ink">Add manually</span>
              <span className="block text-[12.5px] text-ink-subtle">One company, optionally with a contact</span>
            </span>
          </button>
          <Link
            role="menuitem"
            href={`${leadsPath}/import`}
            className="flex min-h-11 items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-muted"
          >
            <FileUp aria-hidden className="mt-0.5 size-[18px] shrink-0 text-ink-muted" />
            <span>
              <span className="block text-[14.5px] font-medium text-ink">Import CSV</span>
              <span className="block text-[12.5px] text-ink-subtle">Review duplicates before anything is saved</span>
            </span>
          </Link>
        </div>
      ) : null}
      {manual ? <ManualCompanySheet workspaceId={workspaceId} leadsPath={leadsPath} onClose={() => setManual(false)} /> : null}
    </div>
  );
}

const EMPTY = {
  canonicalName: "", websiteUrl: "", primaryDomain: "", primaryPhone: "", countryCode: "", region: "", city: "",
  employeeCountMin: "", employeeCountMax: "", notes: "", contactName: "", contactTitle: "", contactEmail: "", contactPhone: "",
};

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[\s,]/g, "")));

function ManualCompanySheet({ workspaceId, leadsPath, onClose }: { workspaceId: string; leadsPath: string; onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState(EMPTY);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<FieldErrors>({});
  const [duplicate, setDuplicate] = useState<{ matches: CompanySummary[]; strong: boolean; reason: string } | null>(null);
  const countries = useMemo(() => countryOptions(), []);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    setDuplicate(null);
  };
  const dirty = Object.values(v).some((x) => x.trim() !== "");

  const submit = (confirmCreate: boolean) => {
    const hasContact = [v.contactName, v.contactTitle, v.contactEmail, v.contactPhone].some((x) => x.trim());
    startTransition(async () => {
      let result: CreateCompanyResult;
      try {
        result = await createCompany(workspaceId, {
          company: {
            canonicalName: v.canonicalName,
            websiteUrl: v.websiteUrl,
            primaryDomain: v.primaryDomain,
            primaryPhone: v.primaryPhone,
            location: { countryCode: v.countryCode || null, region: v.region, city: v.city },
            employeeCountMin: num(v.employeeCountMin),
            employeeCountMax: num(v.employeeCountMax),
            notes: v.notes,
          },
          contact: hasContact ? { fullName: v.contactName, jobTitle: v.contactTitle, email: v.contactEmail, phone: v.contactPhone } : null,
          confirmCreate,
        });
      } catch {
        setError("The company couldn't be saved. Check your connection and try again.");
        return;
      }
      if (result.ok) {
        onClose();
        router.push(`${leadsPath}?company=${result.companyId}`, { scroll: false });
      } else if ("duplicate" in result) {
        setError(null);
        setFe({});
        setDuplicate(result.duplicate);
      } else {
        setError(result.error);
        setFe(result.fieldErrors ?? {});
      }
    });
  };

  const e = (k: string) => fe[k];
  const input = (id: string, key: keyof typeof EMPTY, errorKey: string, extra: Record<string, unknown> = {}) => (
    <input {...controlProps(id, e(errorKey))} value={v[key]} onChange={set(key)} className={inputClass} {...extra} />
  );

  return (
    <ConfigSheet
      title="Add a company"
      description="Saved companies appear in Leads. Duplicates are checked before saving."
      icon={<Building className="stroke-[1.75]" />}
      dirty={dirty}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={() => submit(false)}
      saveLabel="Add company"
    >
      <div className="flex flex-col gap-5">
        {duplicate ? (
          <section role="alert" aria-labelledby="dup-title" className="rounded-lg border border-warning/30 bg-warning-tint px-4 py-3.5">
            <h3 id="dup-title" className="text-[14.5px] font-semibold text-ink">
              {duplicate.matches.length === 1 ? "This company may already exist" : "Similar companies already exist"}
            </h3>
            <p className="mt-0.5 text-[13.5px] text-ink-muted">
              An existing company {duplicate.reason}.
              {duplicate.strong ? " A domain identifies one company, so it can't be added again." : " Check before adding it again."}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {duplicate.matches.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium text-ink">{m.name}</span>
                    <span className="block truncate text-[12.5px] text-ink-subtle">{[m.domain, m.location, m.phone].filter(Boolean).join(" · ") || "No details"}</span>
                  </span>
                  <Link href={`${leadsPath}?company=${m.id}`} scroll={false} onClick={onClose} className={buttonClass("secondary", "h-10")}>
                    Use existing
                  </Link>
                </li>
              ))}
            </ul>
            {!duplicate.strong ? (
              <div className="mt-3 flex justify-end">
                <Button type="button" className="h-10" disabled={pending} onClick={() => submit(true)}>
                  Add as a separate company
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        <Field label="Company name" htmlFor="mc-name" error={e("company.canonicalName")}>
          {input("mc-name", "canonicalName", "company.canonicalName", { autoFocus: true, maxLength: 200 })}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Website" htmlFor="mc-website" error={e("company.websiteUrl")} optional>
            {input("mc-website", "websiteUrl", "company.websiteUrl", { type: "url", placeholder: "https://", autoCapitalize: "none" })}
          </Field>
          <Field label="Primary domain" htmlFor="mc-domain" error={e("company.primaryDomain")} optional>
            {input("mc-domain", "primaryDomain", "company.primaryDomain", { placeholder: "example.com", autoCapitalize: "none" })}
          </Field>
        </div>
        <Field label="Phone" htmlFor="mc-phone" error={e("company.primaryPhone")} optional hint="International format (+…) helps find duplicates.">
          {input("mc-phone", "primaryPhone", "company.primaryPhone", { type: "tel", "aria-describedby": e("company.primaryPhone") ? "mc-phone-error" : "mc-phone-hint" })}
        </Field>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13.5px] font-medium text-ink">Location</legend>
          <Field label="Country" htmlFor="mc-country" error={e("company.location.countryCode")} optional>
            <select id="mc-country" value={v.countryCode} onChange={set("countryCode")} className={inputClass}>
              <option value="">Not set</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Region, state or province" htmlFor="mc-region" optional>
              {input("mc-region", "region", "company.location.region", { maxLength: 120 })}
            </Field>
            <Field label="City" htmlFor="mc-city" optional>
              {input("mc-city", "city", "company.location.city", { maxLength: 120 })}
            </Field>
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-[13.5px] font-medium text-ink">Employees</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum" htmlFor="mc-min" error={e("company.employeeCountMin")} optional>
              {input("mc-min", "employeeCountMin", "company.employeeCountMin", { inputMode: "numeric" })}
            </Field>
            <Field label="Maximum" htmlFor="mc-max" error={e("company.employeeCountMax")} optional>
              {input("mc-max", "employeeCountMax", "company.employeeCountMax", { inputMode: "numeric" })}
            </Field>
          </div>
        </fieldset>
        <Field label="Notes" htmlFor="mc-notes" error={e("company.notes")} optional>
          <textarea {...controlProps("mc-notes", e("company.notes"))} value={v.notes} onChange={set("notes")} rows={3} maxLength={5000} className={cx(inputClass, "h-auto py-2.5 leading-6")} />
        </Field>

        <fieldset className="flex flex-col gap-3 border-t border-line pt-5">
          <legend className="sr-only">First contact</legend>
          <p aria-hidden className="text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-subtle">First contact (optional)</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="mc-contact-name" error={e("contact.fullName")} optional>
              {input("mc-contact-name", "contactName", "contact.fullName", { maxLength: 200 })}
            </Field>
            <Field label="Job title" htmlFor="mc-contact-title" error={e("contact.jobTitle")} optional>
              {input("mc-contact-title", "contactTitle", "contact.jobTitle", { maxLength: 200 })}
            </Field>
            <Field label="Email" htmlFor="mc-contact-email" error={e("contact.email")} optional>
              {input("mc-contact-email", "contactEmail", "contact.email", { type: "email", autoCapitalize: "none" })}
            </Field>
            <Field label="Phone" htmlFor="mc-contact-phone" error={e("contact.phone")} optional>
              {input("mc-contact-phone", "contactPhone", "contact.phone", { type: "tel" })}
            </Field>
          </div>
        </fieldset>
      </div>
    </ConfigSheet>
  );
}
