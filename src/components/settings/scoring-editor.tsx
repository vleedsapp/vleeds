"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { cx, Field, inputClass } from "@/components/ui/primitives";
import { gradeBands, SCORING_CATEGORIES, scoringModelSchema, SUGGESTED_SCORING_MODEL, type ScoringCategory } from "@/lib/config/icp";
import { ConfigSheet } from "./config-sheet";
import { profileNote, sameJson, sendSection, type EditorProps } from "./editor-shared";
import { controlProps, FieldError, Intro, numberText, parseNumber, SectionLabel, useSheetSave, WeightBar } from "./fields";

const CATEGORY_TEXT: Record<ScoringCategory, { label: string; detail: string }> = {
  company_fit: { label: "Company fit", detail: "Industries, size, characteristics and keywords" },
  geography_fit: { label: "Geography fit", detail: "Located in a target geography" },
  decision_maker_fit: { label: "Decision-maker fit", detail: "A target role can be identified" },
  buying_signal_fit: { label: "Buying signals", detail: "Enabled buying signals present" },
};

export function ScoringEditor({ workspaceId, profile, readOnly, onClose }: EditorProps) {
  const saved = profile?.scoringModel ?? null;
  const model = saved ?? SUGGESTED_SCORING_MODEL;
  const initial = {
    a: numberText(model.thresholds.a),
    b: numberText(model.thresholds.b),
    weights: Object.fromEntries(SCORING_CATEGORIES.map((c) => [c, numberText(model.categoryWeights[c])])) as Record<ScoringCategory, string>,
  };
  const [v, setV] = useState(initial);
  const { pending, error, fieldErrors: fe, save } = useSheetSave(onClose, v);

  const candidate = () => ({
    thresholds: { a: parseNumber(v.a), b: parseNumber(v.b) },
    categoryWeights: Object.fromEntries(SCORING_CATEGORIES.map((c) => [c, parseNumber(v.weights[c])])),
  });

  const a = Number(v.a);
  const b = Number(v.b);
  const coherent = Number.isInteger(a) && Number.isInteger(b) && b >= 1 && a <= 100 && a > b && v.a !== "" && v.b !== "";
  const total = SCORING_CATEGORIES.reduce((sum, c) => sum + (Number(v.weights[c]) || 0), 0);
  const totalError = fe.categoryWeights;

  return (
    <ConfigSheet
      title="Scoring rules"
      description={profileNote(profile, "How fit will turn into A, B and C grades.")}
      icon={<Star className="stroke-[1.75]" />}
      dirty={!sameJson(v, initial)}
      readOnly={readOnly}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={() => save(scoringModelSchema, candidate(), (value) => sendSection(workspaceId, profile, "scoring", value))}
    >
      <div className="flex flex-col gap-6">
        <Intro>
          Every company will get a fit score from 0 to 100. Grades group those scores: <strong className="font-medium text-ink">A</strong> leads
          are the strongest fit, <strong className="font-medium text-ink">B</strong> a reasonable fit and{" "}
          <strong className="font-medium text-ink">C</strong> a weaker fit.
          {!saved && !readOnly ? " Suggested starting values are filled in; nothing is saved until you select Save." : ""}
          {!saved && readOnly ? " Scoring hasn't been set up yet; the values below are suggestions only." : ""}
        </Intro>

        <section aria-labelledby="sc-thresholds-heading" className="flex flex-col gap-4">
          <SectionLabel>
            <span id="sc-thresholds-heading">Grade thresholds</span>
          </SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="A grade from" htmlFor="sc-a" error={fe["thresholds.a"]}>
              <input {...controlProps("sc-a", fe["thresholds.a"])} inputMode="numeric" value={v.a} readOnly={readOnly} onChange={(x) => setV((s) => ({ ...s, a: x.target.value }))} className={inputClass} />
            </Field>
            <Field label="B grade from" htmlFor="sc-b" error={fe["thresholds.b"]}>
              <input {...controlProps("sc-b", fe["thresholds.b"])} inputMode="numeric" value={v.b} readOnly={readOnly} onChange={(x) => setV((s) => ({ ...s, b: x.target.value }))} className={inputClass} />
            </Field>
          </div>
          <div aria-live="polite">
            {coherent ? (
              <ul aria-label="Grade ranges" className="grid grid-cols-3 gap-2">
                {gradeBands({ a, b }).map((band) => (
                  <li key={band.grade} className="rounded-lg border border-line bg-surface-muted px-3 py-2.5">
                    <p className="flex items-baseline gap-2">
                      <span
                        className={cx(
                          "grid size-6 place-items-center rounded-full text-[12.5px] font-semibold",
                          band.grade === "C" ? "bg-warning-tint text-warning" : "bg-brand-tint text-brand-strong",
                        )}
                      >
                        {band.grade}
                      </span>
                      <span className="text-[14px] font-medium tabular-nums text-ink">
                        {band.min}–{band.max}
                      </span>
                    </p>
                    <p className="mt-1 text-[12.5px] text-ink-subtle">{band.meaning}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-subtle">Enter whole numbers where A is higher than B (B at least 1, A at most 100) to see the grade ranges.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="sc-weights-heading" className="flex flex-col gap-3 border-t border-line pt-5">
          <SectionLabel>
            <span id="sc-weights-heading">Category weights</span>
          </SectionLabel>
          <p className="text-[13.5px] text-ink-muted">How much each area contributes to the fit score. Weights add up to 100.</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {SCORING_CATEGORIES.map((c) => {
              const id = `sc-w-${c}`;
              const err = fe[`categoryWeights.${c}`];
              return (
                <li key={c} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={id} className="block text-[14px] font-medium text-ink">
                      {CATEGORY_TEXT[c].label}
                    </label>
                    <p className="text-[12.5px] text-ink-subtle">{CATEGORY_TEXT[c].detail}</p>
                  </div>
                  <WeightBar value={Number(v.weights[c]) || 0} />
                  <input
                    {...controlProps(id, err)}
                    aria-describedby={[err ? `${id}-error` : null, totalError ? "sc-total-error" : null].filter(Boolean).join(" ") || undefined}
                    inputMode="numeric"
                    value={v.weights[c]}
                    readOnly={readOnly}
                    onChange={(x) => setV((s) => ({ ...s, weights: { ...s.weights, [c]: x.target.value } }))}
                    className={cx(inputClass, "w-20 text-center")}
                  />
                  <div className="basis-full empty:hidden">
                    <FieldError id={`${id}-error`}>{err}</FieldError>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className={cx("text-right text-[13px] tabular-nums", total === 100 ? "text-ink-subtle" : "font-medium text-warning")}>
            Total {total} of 100{total === 100 ? "" : " — adjust to 100"}
          </p>
          <FieldError id="sc-total-error">{totalError}</FieldError>
        </section>
      </div>
    </ConfigSheet>
  );
}
