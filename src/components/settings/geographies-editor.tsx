"use client";

import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button, Field, IconButton, inputClass } from "@/components/ui/primitives";
import { countryOptions } from "@/lib/config/countries";
import {
  geographiesSchema,
  geographyLabel,
  geographySchema,
  geographyScope,
  issuesToFieldErrors,
  type FieldErrors,
  type Geography,
} from "@/lib/config/icp";
import { ConfigSheet } from "./config-sheet";
import { EmptyNote, profileNote, sameJson, sendSection, type EditorProps } from "./editor-shared";
import { controlProps, Intro, newEntryId, SectionLabel, useSheetSave } from "./fields";

const EMPTY_DRAFT = { countryCode: "", region: "", city: "", label: "" };

const SCOPE_TEXT = { country: "Country", region: "Region", city: "City" } as const;

export function GeographiesEditor({ workspaceId, profile, readOnly, onClose }: EditorProps) {
  const initial = profile?.geographies ?? [];
  const [items, setItems] = useState<Geography[]>(initial);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftErrors, setDraftErrors] = useState<FieldErrors>({});
  const countries = useMemo(() => countryOptions(), []);
  const countryRef = useRef<HTMLSelectElement>(null);
  const { pending, error, fieldErrors, save } = useSheetSave(onClose, items);
  const [saveError, setSaveError] = useState<string | null>(null);

  const draftStarted = Object.values(draft).some((x) => x.trim() !== "");

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setDraftErrors({});
  };

  const commitDraft = () => {
    const parsed = geographySchema.safeParse({
      id: editingId ?? newEntryId(),
      countryCode: draft.countryCode,
      region: draft.region,
      city: draft.city,
      label: draft.label,
    });
    if (!parsed.success) {
      setDraftErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    const next = editingId ? items.map((g) => (g.id === editingId ? parsed.data : g)) : [...items, parsed.data];
    const listCheck = geographiesSchema.safeParse(next);
    if (!listCheck.success) {
      setDraftErrors({ countryCode: listCheck.error.issues[0].message });
      return;
    }
    setItems(next);
    setSaveError(null);
    resetDraft();
    countryRef.current?.focus();
  };

  const startEdit = (g: Geography) => {
    setEditingId(g.id);
    setDraft({ countryCode: g.countryCode, region: g.region ?? "", city: g.city ?? "", label: g.label ?? "" });
    setDraftErrors({});
    countryRef.current?.focus();
  };

  const onSave = () => {
    if (draftStarted) {
      setSaveError(editingId ? "Update or cancel the target you are editing before saving." : "Add or clear the target you started before saving.");
      return;
    }
    setSaveError(null);
    save(geographiesSchema, items, (value) => sendSection(workspaceId, profile, "geographies", value));
  };

  const de = draftErrors;

  return (
    <ConfigSheet
      title="Target geographies"
      description={profileNote(profile, "Countries, regions and cities to prospect in.")}
      icon={<MapPin className="stroke-[1.75]" />}
      dirty={!sameJson(items, initial) || draftStarted}
      readOnly={readOnly}
      pending={pending}
      error={saveError ?? error ?? (Object.keys(fieldErrors).length ? Object.values(fieldErrors)[0] : null)}
      onClose={onClose}
      onSave={onSave}
    >
      <div className="flex flex-col gap-6">
        {!readOnly ? (
          <>
            <Intro>Add each area you sell into. A country on its own covers the whole country; add a region or city to narrow it.</Intro>
            <fieldset className="flex flex-col gap-4 rounded-lg border border-line bg-surface-muted p-4">
              <legend className="sr-only">{editingId ? "Edit target" : "New target"}</legend>
              <Field label="Country" htmlFor="geo-country" error={de.countryCode}>
                <select
                  ref={countryRef}
                  {...controlProps("geo-country", de.countryCode)}
                  value={draft.countryCode}
                  onChange={(x) => setDraft((d) => ({ ...d, countryCode: x.target.value }))}
                  className={inputClass}
                  autoFocus
                >
                  <option value="">Choose a country</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Region, state or province" htmlFor="geo-region" error={de.region} optional>
                  <input {...controlProps("geo-region", de.region)} value={draft.region} onChange={(x) => setDraft((d) => ({ ...d, region: x.target.value }))} maxLength={120} className={inputClass} />
                </Field>
                <Field label="City or locality" htmlFor="geo-city" error={de.city} optional>
                  <input {...controlProps("geo-city", de.city)} value={draft.city} onChange={(x) => setDraft((d) => ({ ...d, city: x.target.value }))} maxLength={120} className={inputClass} />
                </Field>
              </div>
              <Field label="Display label" htmlFor="geo-label" error={de.label} optional hint="Shown instead of the place names, if set.">
                <input
                  {...controlProps("geo-label", de.label)}
                  aria-describedby={de.label ? "geo-label-error" : "geo-label-hint"}
                  value={draft.label}
                  onChange={(x) => setDraft((d) => ({ ...d, label: x.target.value }))}
                  maxLength={120}
                  className={inputClass}
                />
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                {editingId || draftStarted ? (
                  <Button type="button" className="h-11 sm:h-10" onClick={resetDraft}>
                    {editingId ? "Cancel edit" : "Clear"}
                  </Button>
                ) : null}
                <Button type="button" variant="soft" className="h-11 sm:h-10" onClick={commitDraft}>
                  {editingId ? null : <Plus aria-hidden className="size-4" />}
                  {editingId ? "Update target" : "Add target"}
                </Button>
              </div>
            </fieldset>
          </>
        ) : null}

        <section aria-labelledby="geo-list-heading" className="flex flex-col gap-3">
          <SectionLabel>
            <span id="geo-list-heading">Targets ({items.length})</span>
          </SectionLabel>
          {items.length === 0 ? (
            <EmptyNote>No geographies yet.{readOnly ? "" : " Add a country, region or city above."}</EmptyNote>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {items.map((g) => {
                const label = geographyLabel(g);
                const scope = geographyScope(g);
                return (
                  <li key={g.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <MapPin aria-hidden className="size-[18px] shrink-0 stroke-[1.75] text-ink-subtle" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-medium text-ink">{label}</p>
                      <p className="truncate text-[12.5px] text-ink-subtle">
                        {SCOPE_TEXT[scope]}
                        {scope !== "country" || g.label ? ` · ${g.countryName}` : ""}
                      </p>
                    </div>
                    {!readOnly ? (
                      <>
                        <IconButton label={`Edit ${label}`} size="md" className="size-11 sm:size-10" onClick={() => startEdit(g)}>
                          <Pencil aria-hidden className="size-4" />
                        </IconButton>
                        <IconButton
                          label={`Remove ${label}`}
                          size="md"
                          className="size-11 sm:size-10"
                          onClick={() => {
                            setItems((list) => list.filter((x) => x.id !== g.id));
                            if (editingId === g.id) resetDraft();
                          }}
                        >
                          <Trash2 aria-hidden className="size-4" />
                        </IconButton>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </ConfigSheet>
  );
}
