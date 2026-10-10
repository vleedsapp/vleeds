"use client";

import { Building, Pencil } from "lucide-react";
import { useState } from "react";
import { updateBusinessProfile } from "@/app/w/[workspaceId]/settings/actions";
import { buttonClass, Field, inputClass } from "@/components/ui/primitives";
import { businessProfileSchema } from "@/lib/config/business-profile";
import { timeZoneOptions } from "@/lib/config/timezone";
import { ConfigSheet } from "./config-sheet";
import { controlProps, useSheetSave } from "./fields";

export type BusinessProfileValues = {
  name: string;
  primaryDomain: string | null;
  websiteUrl: string | null;
  description: string | null;
  timezone: string;
};

/** Runtime IANA zones; the saved zone is kept even if this browser doesn't list it. */
const zoneChoices = (current: string) => {
  const list = timeZoneOptions();
  return list.includes(current) ? list : [current, ...list];
};

/** "Edit" on the Business profile card (owners/admins only; the server re-checks). */
export function BusinessProfileEditButton({ workspaceId, profile }: { workspaceId: string; profile: BusinessProfileValues }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={buttonClass("secondary", "h-10")}>
        <Pencil aria-hidden className="size-4" />
        Edit
        <span className="sr-only">business profile</span>
      </button>
      {open ? <BusinessProfileEditor workspaceId={workspaceId} profile={profile} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function BusinessProfileEditor({
  workspaceId,
  profile,
  onClose,
}: {
  workspaceId: string;
  profile: BusinessProfileValues;
  onClose: () => void;
}) {
  const initial = {
    name: profile.name,
    primaryDomain: profile.primaryDomain ?? "",
    websiteUrl: profile.websiteUrl ?? "",
    description: profile.description ?? "",
    timezone: profile.timezone,
  };
  const [values, setValues] = useState(initial);
  const { pending, error, fieldErrors: fe, save } = useSheetSave(onClose, values);
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => values[k] !== initial[k]);
  const set = (k: keyof typeof initial) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <ConfigSheet
      title="Edit business profile"
      description="How this workspace's business is described across Vleeds."
      icon={<Building className="stroke-[1.75]" />}
      dirty={dirty}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={() => save(businessProfileSchema, values, (v) => updateBusinessProfile(workspaceId, v))}
    >
      <div className="flex flex-col gap-5">
        <Field label="Workspace name" htmlFor="bp-name" error={fe.name} hint="Usually the business or brand you prospect for.">
          <input
            {...controlProps("bp-name", fe.name)}
            aria-describedby={fe.name ? "bp-name-error" : "bp-name-hint"}
            value={values.name}
            onChange={set("name")}
            maxLength={120}
            required
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field label="Primary domain" htmlFor="bp-domain" error={fe.primaryDomain} optional>
          <input
            {...controlProps("bp-domain", fe.primaryDomain)}
            value={values.primaryDomain}
            onChange={set("primaryDomain")}
            placeholder="example.com"
            autoCapitalize="none"
            spellCheck={false}
            className={inputClass}
          />
        </Field>
        <Field label="Website" htmlFor="bp-website" error={fe.websiteUrl} optional>
          <input
            {...controlProps("bp-website", fe.websiteUrl)}
            type="url"
            value={values.websiteUrl}
            onChange={set("websiteUrl")}
            placeholder="https://"
            autoCapitalize="none"
            spellCheck={false}
            className={inputClass}
          />
        </Field>
        <Field label="Description" htmlFor="bp-description" error={fe.description} optional hint="What this business offers.">
          <textarea
            {...controlProps("bp-description", fe.description)}
            aria-describedby={fe.description ? "bp-description-error" : "bp-description-hint"}
            value={values.description}
            onChange={set("description")}
            maxLength={2000}
            rows={4}
            className={`${inputClass} h-auto py-2.5 leading-6`}
          />
        </Field>
        <Field
          label="Time zone"
          htmlFor="bp-timezone"
          error={fe.timezone}
          hint="Defines “today” for the Today queue, callbacks and follow-ups. Times are stored in UTC."
        >
          <select
            {...controlProps("bp-timezone", fe.timezone)}
            aria-describedby={fe.timezone ? "bp-timezone-error" : "bp-timezone-hint"}
            value={values.timezone}
            onChange={set("timezone")}
            className={inputClass}
          >
            {zoneChoices(values.timezone).map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </ConfigSheet>
  );
}
