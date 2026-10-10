"use client";

import { Users } from "lucide-react";
import { useState } from "react";
import { Field, inputClass } from "@/components/ui/primitives";
import { DEFAULT_PROFILE_NAME, EMPTY_IDEAL_CUSTOMER, idealCustomerSectionSchema } from "@/lib/config/icp";
import { ConfigSheet } from "./config-sheet";
import { ChipList, NotSet, profileNote, ReadRow, sameJson, sendSection, type EditorProps } from "./editor-shared";
import { controlProps, errorFor, Intro, numberText, parseOptionalNumber, SectionLabel, TagInput, useSheetSave } from "./fields";

export function IdealCustomerEditor({ workspaceId, profile, readOnly, onClose }: EditorProps) {
  const ic = profile?.idealCustomer ?? EMPTY_IDEAL_CUSTOMER;
  const initial = {
    name: profile?.name ?? DEFAULT_PROFILE_NAME,
    description: profile?.description ?? "",
    industries: ic.industries,
    minText: numberText(ic.companySize.minEmployees),
    maxText: numberText(ic.companySize.maxEmployees),
    characteristics: ic.characteristics,
    keywords: ic.keywords,
    notes: ic.notes ?? "",
  };
  const [v, setV] = useState(initial);
  const { pending, error, fieldErrors: fe, save } = useSheetSave(onClose, v);
  const update = <K extends keyof typeof initial>(k: K, value: (typeof initial)[K]) => setV((s) => ({ ...s, [k]: value }));

  const candidate = () => ({
    name: v.name,
    description: v.description,
    idealCustomer: {
      industries: v.industries,
      companySize: { minEmployees: parseOptionalNumber(v.minText), maxEmployees: parseOptionalNumber(v.maxText) },
      characteristics: v.characteristics,
      keywords: v.keywords,
      notes: v.notes,
    },
  });

  const e = {
    name: fe.name,
    description: fe.description,
    industries: errorFor(fe, "idealCustomer.industries"),
    min: fe["idealCustomer.companySize.minEmployees"],
    max: fe["idealCustomer.companySize.maxEmployees"],
    characteristics: errorFor(fe, "idealCustomer.characteristics"),
    keywords: errorFor(fe, "idealCustomer.keywords"),
    notes: fe["idealCustomer.notes"],
  };

  return (
    <ConfigSheet
      title="Ideal customer profile"
      description={profileNote(profile, "The kinds of companies this workspace wants to sell to.")}
      icon={<Users className="stroke-[1.75]" />}
      dirty={!sameJson(v, initial)}
      readOnly={readOnly}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={() => save(idealCustomerSectionSchema, candidate(), (value) => sendSection(workspaceId, profile, "ideal_customer", value))}
    >
      {readOnly ? (
        <dl>
          <ReadRow label="Profile name">{profile?.name ?? <NotSet />}</ReadRow>
          <ReadRow label="Ideal customer">{profile?.description ?? <NotSet />}</ReadRow>
          <ReadRow label="Industries">
            <ChipList items={ic.industries} label="Industries and categories" />
          </ReadRow>
          <ReadRow label="Company size">{sizeText(ic.companySize.minEmployees, ic.companySize.maxEmployees)}</ReadRow>
          <ReadRow label="Characteristics">
            <ChipList items={ic.characteristics} label="Company characteristics" />
          </ReadRow>
          <ReadRow label="Keywords">
            <ChipList items={ic.keywords} label="Company keywords" />
          </ReadRow>
          <ReadRow label="Notes">{ic.notes ?? <NotSet />}</ReadRow>
        </dl>
      ) : (
        <div className="flex flex-col gap-6">
          <Intro>Describe the companies you want to find. Vleeds will use these criteria to qualify companies once discovery is available.</Intro>

          <div className="flex flex-col gap-5">
            <Field label="Profile name" htmlFor="icp-name" error={e.name}>
              <input {...controlProps("icp-name", e.name)} value={v.name} onChange={(x) => update("name", x.target.value)} maxLength={120} className={inputClass} autoFocus />
            </Field>
            <Field label="Ideal customer description" htmlFor="icp-description" error={e.description} optional hint="In a sentence or two: who is a great customer, and why?">
              <textarea
                {...controlProps("icp-description", e.description)}
                aria-describedby={e.description ? "icp-description-error" : "icp-description-hint"}
                value={v.description}
                onChange={(x) => update("description", x.target.value)}
                maxLength={2000}
                rows={3}
                className={`${inputClass} h-auto py-2.5 leading-6`}
              />
            </Field>
          </div>

          <section aria-labelledby="icp-company-heading" className="flex flex-col gap-5 border-t border-line pt-5">
            <SectionLabel>
              <span id="icp-company-heading">Company criteria</span>
            </SectionLabel>
            <TagInput
              id="icp-industries"
              label="Industries and categories"
              hint="Any labels that describe the businesses you target."
              itemNoun="industry"
              values={v.industries}
              onChange={(x) => update("industries", x)}
              error={e.industries}
              placeholder="Type a category and press Enter"
            />
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[13.5px] font-medium text-ink">Company size (employees)</legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Minimum" htmlFor="icp-min" error={e.min} optional>
                  <input {...controlProps("icp-min", e.min)} inputMode="numeric" value={v.minText} onChange={(x) => update("minText", x.target.value)} placeholder="No minimum" className={inputClass} />
                </Field>
                <Field label="Maximum" htmlFor="icp-max" error={e.max} optional>
                  <input {...controlProps("icp-max", e.max)} inputMode="numeric" value={v.maxText} onChange={(x) => update("maxText", x.target.value)} placeholder="No maximum" className={inputClass} />
                </Field>
              </div>
            </fieldset>
            <TagInput
              id="icp-characteristics"
              label="Company characteristics"
              hint="Traits a good-fit company has."
              itemNoun="characteristic"
              values={v.characteristics}
              onChange={(x) => update("characteristics", x)}
              error={e.characteristics}
              placeholder="Type a characteristic and press Enter"
            />
            <TagInput
              id="icp-keywords"
              label="Positive keywords"
              hint="Words that suggest a good fit when they appear in a company's description."
              itemNoun="keyword"
              values={v.keywords}
              onChange={(x) => update("keywords", x)}
              error={e.keywords}
              placeholder="Type a keyword and press Enter"
            />
          </section>

          <div className="border-t border-line pt-5">
            <Field label="Notes" htmlFor="icp-notes" error={e.notes} optional>
              <textarea
                {...controlProps("icp-notes", e.notes)}
                value={v.notes}
                onChange={(x) => update("notes", x.target.value)}
                maxLength={2000}
                rows={3}
                className={`${inputClass} h-auto py-2.5 leading-6`}
              />
            </Field>
          </div>
        </div>
      )}
    </ConfigSheet>
  );
}

function sizeText(min: number | null, max: number | null) {
  const f = (n: number) => n.toLocaleString("en");
  if (min !== null && max !== null) return `${f(min)}–${f(max)} employees`;
  if (min !== null) return `${f(min)}+ employees`;
  if (max !== null) return `Up to ${f(max)} employees`;
  return <NotSet>Any size</NotSet>;
}
