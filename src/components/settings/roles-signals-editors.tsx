"use client";

import { Ban, Briefcase, ChartNoAxesColumnIncreasing, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, cx, Field, IconButton, inputClass, StatusPill } from "@/components/ui/primitives";
import {
  buyingSignalsSchema,
  DECISION_MAKER_PRIORITIES,
  decisionMakersSchema,
  exclusionSignalsSchema,
  SENIORITY_HINTS,
  type DecisionMakerPriority,
  type ExclusionBehavior,
  type SeniorityHint,
} from "@/lib/config/icp";
import { ConfigSheet } from "./config-sheet";
import { EmptyNote, profileNote, sameJson, sendSection, type EditorProps } from "./editor-shared";
import { controlProps, EntryCard, FieldError, Intro, newEntryId, numberText, parseNumber, Switch, useSheetSave, WeightBar } from "./fields";

export const PRIORITY_TEXT: Record<DecisionMakerPriority, string> = {
  primary: "Primary",
  secondary: "Secondary",
  fallback: "Fallback",
};

const SENIORITY_TEXT: Record<SeniorityHint, string> = {
  executive: "Executive",
  director: "Director",
  manager: "Manager",
  individual_contributor: "Individual contributor",
};

/** Moves focus to a newly added entry's first field once it has rendered. */
function useFocusNew() {
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (!pending.current) return;
    document.getElementById(pending.current)?.focus();
    pending.current = null;
  });
  return (id: string) => {
    pending.current = id;
  };
}

function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <Button type="button" variant="soft" className="h-11 self-start sm:h-10" onClick={onClick}>
      <Plus aria-hidden className="size-4" />
      {children}
    </Button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton label={label} className="size-11 sm:size-10" onClick={onClick}>
      <Trash2 aria-hidden className="size-4" />
    </IconButton>
  );
}

// -----------------------------------------------------------------------------
// Decision-maker titles
// -----------------------------------------------------------------------------

type RoleRow = { id: string; title: string; priority: DecisionMakerPriority; seniority: SeniorityHint | null };

export function DecisionMakersEditor({ workspaceId, profile, readOnly, onClose }: EditorProps) {
  const initial: RoleRow[] = profile?.decisionMakers ?? [];
  const [rows, setRows] = useState<RoleRow[]>(initial);
  const { pending, error, fieldErrors: fe, save } = useSheetSave(onClose, rows);
  const focusNew = useFocusNew();
  const patch = (id: string, change: Partial<RoleRow>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...change } : x)));

  const add = () => {
    const id = newEntryId();
    setRows((r) => [...r, { id, title: "", priority: r.length === 0 ? "primary" : "secondary", seniority: null }]);
    focusNew(`dm-${id}-title`);
  };

  return (
    <ConfigSheet
      title="Decision-maker titles"
      description={profileNote(profile, "The roles Vleeds should look for at target companies.")}
      icon={<Briefcase className="stroke-[1.75]" />}
      dirty={!sameJson(rows, initial)}
      readOnly={readOnly}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={() => save(decisionMakersSchema, rows, (value) => sendSection(workspaceId, profile, "decision_makers", value))}
    >
      <div className="flex flex-col gap-5">
        {readOnly ? null : (
          <Intro>List the job titles you want to reach. Primary roles are tried first, then secondary, then fallback.</Intro>
        )}
        {rows.length === 0 ? (
          <EmptyNote>No roles yet.</EmptyNote>
        ) : readOnly ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-ink">{r.title}</p>
                  {r.seniority ? <p className="text-[12.5px] text-ink-subtle">{SENIORITY_TEXT[r.seniority]}</p> : null}
                </div>
                <StatusPill tone={r.priority === "primary" ? "brand" : "neutral"}>{PRIORITY_TEXT[r.priority]}</StatusPill>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r, i) => {
              const titleId = `dm-${r.id}-title`;
              const titleError = fe[`${i}.title`];
              const name = r.title.trim() || `role ${i + 1}`;
              return (
                <EntryCard key={r.id} label={`Role ${i + 1}`}>
                  <div className="flex flex-col gap-3">
                    <Field label="Title" htmlFor={titleId} error={titleError}>
                      <input {...controlProps(titleId, titleError)} value={r.title} onChange={(x) => patch(r.id, { title: x.target.value })} maxLength={120} className={inputClass} />
                    </Field>
                    <div className="flex items-end gap-2.5">
                      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2.5">
                        <Field label="Priority" htmlFor={`dm-${r.id}-priority`}>
                          <select
                            id={`dm-${r.id}-priority`}
                            value={r.priority}
                            onChange={(x) => patch(r.id, { priority: x.target.value as DecisionMakerPriority })}
                            className={inputClass}
                          >
                            {DECISION_MAKER_PRIORITIES.map((p) => (
                              <option key={p} value={p}>
                                {PRIORITY_TEXT[p]}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Seniority" htmlFor={`dm-${r.id}-seniority`} optional>
                          <select
                            id={`dm-${r.id}-seniority`}
                            value={r.seniority ?? ""}
                            onChange={(x) => patch(r.id, { seniority: (x.target.value || null) as SeniorityHint | null })}
                            className={inputClass}
                          >
                            <option value="">Any</option>
                            {SENIORITY_HINTS.map((s) => (
                              <option key={s} value={s}>
                                {SENIORITY_TEXT[s]}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <RemoveButton label={`Remove ${name}`} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} />
                    </div>
                  </div>
                </EntryCard>
              );
            })}
          </ul>
        )}
        {readOnly ? null : <AddButton onClick={add}>Add role</AddButton>}
      </div>
    </ConfigSheet>
  );
}

// -----------------------------------------------------------------------------
// Buying signals
// -----------------------------------------------------------------------------

type SignalRow = { id: string; name: string; description: string; weightText: string; enabled: boolean };

export function BuyingSignalsEditor({ workspaceId, profile, readOnly, onClose }: EditorProps) {
  const initial: SignalRow[] = (profile?.buyingSignals ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description ?? "",
    weightText: numberText(s.weight),
    enabled: s.enabled,
  }));
  const [rows, setRows] = useState(initial);
  const { pending, error, fieldErrors: fe, save } = useSheetSave(onClose, rows);
  const focusNew = useFocusNew();
  const patch = (id: string, change: Partial<SignalRow>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...change } : x)));

  const add = () => {
    const id = newEntryId();
    setRows((r) => [...r, { id, name: "", description: "", weightText: "50", enabled: true }]);
    focusNew(`bs-${id}-name`);
  };

  const candidate = () =>
    rows.map((r) => ({ id: r.id, name: r.name, description: r.description, weight: parseNumber(r.weightText), enabled: r.enabled }));

  return (
    <ConfigSheet
      title="Buying signals"
      description={profileNote(profile, "Signs that a company is more worth contacting now.")}
      icon={<ChartNoAxesColumnIncreasing className="stroke-[1.75]" />}
      dirty={!sameJson(rows, initial)}
      readOnly={readOnly}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={() => save(buyingSignalsSchema, candidate(), (value) => sendSection(workspaceId, profile, "buying_signals", value))}
    >
      <div className="flex flex-col gap-5">
        {readOnly ? null : (
          <Intro>Name each signal in your own words and give it a weight from 1 to 100. Higher weights will raise a company&apos;s priority more once scoring is available.</Intro>
        )}
        {rows.length === 0 ? (
          <EmptyNote>No buying signals yet.</EmptyNote>
        ) : readOnly ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-ink">{r.name}</p>
                  {r.description ? <p className="text-[12.5px] text-ink-subtle">{r.description}</p> : null}
                </div>
                <span className="flex items-center gap-2 text-[13px] text-ink-muted">
                  <WeightBar value={Number(r.weightText)} />
                  <span>Weight {r.weightText}</span>
                </span>
                <StatusPill tone={r.enabled ? "brand" : "neutral"}>{r.enabled ? "Enabled" : "Disabled"}</StatusPill>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r, i) => {
              const nameId = `bs-${r.id}-name`;
              const weightId = `bs-${r.id}-weight`;
              const nameError = fe[`${i}.name`];
              const weightError = fe[`${i}.weight`];
              const descError = fe[`${i}.description`];
              const name = r.name.trim() || `signal ${i + 1}`;
              const weight = Number(r.weightText);
              return (
                <EntryCard key={r.id} label={`Signal ${i + 1}`}>
                  <div className={cx("flex flex-col gap-3", !r.enabled && "opacity-80")}>
                    <Field label="Signal" htmlFor={nameId} error={nameError}>
                      <input {...controlProps(nameId, nameError)} value={r.name} onChange={(x) => patch(r.id, { name: x.target.value })} maxLength={80} className={inputClass} />
                    </Field>
                    <Field label="Description" htmlFor={`bs-${r.id}-description`} error={descError} optional>
                      <textarea
                        {...controlProps(`bs-${r.id}-description`, descError)}
                        value={r.description}
                        onChange={(x) => patch(r.id, { description: x.target.value })}
                        maxLength={500}
                        rows={2}
                        className={`${inputClass} h-auto py-2 leading-6`}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="flex items-center gap-2.5">
                        <label htmlFor={weightId} className="text-[13.5px] font-medium text-ink">
                          Weight
                        </label>
                        <input
                          {...controlProps(weightId, weightError)}
                          inputMode="numeric"
                          value={r.weightText}
                          onChange={(x) => patch(r.id, { weightText: x.target.value })}
                          className={cx(inputClass, "w-20 text-center")}
                        />
                        <WeightBar value={weight} />
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <Switch id={`bs-${r.id}-enabled`} checked={r.enabled} onChange={(enabled) => patch(r.id, { enabled })} label={`${name} enabled`} />
                        <RemoveButton label={`Remove ${name}`} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} />
                      </div>
                    </div>
                    <FieldError id={`${weightId}-error`}>{weightError}</FieldError>
                  </div>
                </EntryCard>
              );
            })}
          </ul>
        )}
        {readOnly ? null : <AddButton onClick={add}>Add signal</AddButton>}
      </div>
    </ConfigSheet>
  );
}

// -----------------------------------------------------------------------------
// Exclusion signals
// -----------------------------------------------------------------------------

type ExclusionRow = {
  id: string;
  name: string;
  description: string;
  behavior: ExclusionBehavior;
  penaltyText: string;
  enabled: boolean;
};

const BEHAVIOR_TEXT: Record<ExclusionBehavior, { label: string; detail: string }> = {
  hard_exclude: { label: "Exclude", detail: "Leave matching companies out entirely." },
  penalty: { label: "Lower score", detail: "Keep them, but deduct points." },
};

export function ExclusionSignalsEditor({ workspaceId, profile, readOnly, onClose }: EditorProps) {
  const initial: ExclusionRow[] = (profile?.exclusionSignals ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description ?? "",
    behavior: s.behavior,
    penaltyText: numberText(s.penalty),
    enabled: s.enabled,
  }));
  const [rows, setRows] = useState(initial);
  const { pending, error, fieldErrors: fe, save } = useSheetSave(onClose, rows);
  const focusNew = useFocusNew();
  const patch = (id: string, change: Partial<ExclusionRow>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...change } : x)));
  const neverSaved = profile?.exclusionSignals == null;

  const add = () => {
    const id = newEntryId();
    setRows((r) => [...r, { id, name: "", description: "", behavior: "hard_exclude", penaltyText: "", enabled: true }]);
    focusNew(`ex-${id}-name`);
  };

  const candidate = () =>
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      behavior: r.behavior,
      penalty: r.behavior === "penalty" ? parseNumber(r.penaltyText) : null,
      enabled: r.enabled,
    }));

  return (
    <ConfigSheet
      title="Exclusion signals"
      description={profileNote(profile, "Companies to leave out, or to rank lower.")}
      icon={<Ban className="stroke-[1.75]" />}
      dirty={!sameJson(rows, initial)}
      readOnly={readOnly}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={() => save(exclusionSignalsSchema, candidate(), (value) => sendSection(workspaceId, profile, "exclusion_signals", value))}
    >
      <div className="flex flex-col gap-5">
        {readOnly ? null : (
          <Intro>
            Describe companies you don&apos;t want to contact. An exclusion either removes a company from your leads or lowers its score.
            If nothing should be excluded, save with no exclusions.
          </Intro>
        )}
        {rows.length === 0 ? (
          <EmptyNote>{neverSaved ? "No exclusions yet." : "This profile excludes nothing."}</EmptyNote>
        ) : readOnly ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-ink">{r.name}</p>
                  {r.description ? <p className="text-[12.5px] text-ink-subtle">{r.description}</p> : null}
                </div>
                <BehaviorPill behavior={r.behavior} penalty={r.penaltyText} />
                <StatusPill tone={r.enabled ? "brand" : "neutral"}>{r.enabled ? "Enabled" : "Disabled"}</StatusPill>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r, i) => {
              const nameId = `ex-${r.id}-name`;
              const penaltyId = `ex-${r.id}-penalty`;
              const nameError = fe[`${i}.name`];
              const descError = fe[`${i}.description`];
              const penaltyError = fe[`${i}.penalty`];
              const name = r.name.trim() || `exclusion ${i + 1}`;
              return (
                <EntryCard key={r.id} label={`Exclusion ${i + 1}`}>
                  <div className="flex flex-col gap-3">
                    <Field label="Exclusion" htmlFor={nameId} error={nameError}>
                      <input {...controlProps(nameId, nameError)} value={r.name} onChange={(x) => patch(r.id, { name: x.target.value })} maxLength={80} className={inputClass} />
                    </Field>
                    <Field label="Description" htmlFor={`ex-${r.id}-description`} error={descError} optional>
                      <textarea
                        {...controlProps(`ex-${r.id}-description`, descError)}
                        value={r.description}
                        onChange={(x) => patch(r.id, { description: x.target.value })}
                        maxLength={500}
                        rows={2}
                        className={`${inputClass} h-auto py-2 leading-6`}
                      />
                    </Field>
                    <fieldset>
                      <legend className="mb-1.5 text-[13.5px] font-medium text-ink">When a company matches</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(Object.keys(BEHAVIOR_TEXT) as ExclusionBehavior[]).map((b) => (
                          <label
                            key={b}
                            className={cx(
                              "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13.5px]",
                              r.behavior === b ? "border-brand bg-brand-tint/60" : "border-line-strong bg-surface hover:bg-surface-muted",
                            )}
                          >
                            <input
                              type="radio"
                              name={`ex-${r.id}-behavior`}
                              value={b}
                              checked={r.behavior === b}
                              onChange={() => patch(r.id, { behavior: b, penaltyText: b === "penalty" ? r.penaltyText || "20" : "" })}
                              className="mt-0.5 size-4 accent-[var(--color-brand)]"
                            />
                            <span>
                              <span className="block font-medium text-ink">{BEHAVIOR_TEXT[b].label}</span>
                              <span className="block text-[12.5px] text-ink-subtle">{BEHAVIOR_TEXT[b].detail}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {r.behavior === "penalty" ? (
                        <div className="flex items-center gap-2.5">
                          <label htmlFor={penaltyId} className="text-[13.5px] font-medium text-ink">
                            Points deducted
                          </label>
                          <input
                            {...controlProps(penaltyId, penaltyError)}
                            inputMode="numeric"
                            value={r.penaltyText}
                            onChange={(x) => patch(r.id, { penaltyText: x.target.value })}
                            className={cx(inputClass, "w-20 text-center")}
                          />
                        </div>
                      ) : null}
                      <div className="ml-auto flex items-center gap-1">
                        <Switch id={`ex-${r.id}-enabled`} checked={r.enabled} onChange={(enabled) => patch(r.id, { enabled })} label={`${name} enabled`} />
                        <RemoveButton label={`Remove ${name}`} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} />
                      </div>
                    </div>
                    <FieldError id={`${penaltyId}-error`}>{penaltyError}</FieldError>
                  </div>
                </EntryCard>
              );
            })}
          </ul>
        )}
        {readOnly ? null : <AddButton onClick={add}>Add exclusion</AddButton>}
      </div>
    </ConfigSheet>
  );
}

function BehaviorPill({ behavior, penalty }: { behavior: ExclusionBehavior; penalty: string }) {
  return behavior === "hard_exclude" ? (
    <StatusPill tone="neutral">
      <Ban aria-hidden className="size-3.5" />
      Excludes
    </StatusPill>
  ) : (
    <StatusPill tone="neutral">−{penalty} points</StatusPill>
  );
}
