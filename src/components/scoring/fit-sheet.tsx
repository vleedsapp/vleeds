"use client";

import { Gauge } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { evaluateCompanyFit, loadFitEvaluation, saveSignalObservations } from "@/app/w/[workspaceId]/leads/scoring-actions";
import { LeadGradeBadge } from "@/components/leads/lead-ui";
import { ConfigSheet } from "@/components/settings/config-sheet";
import { Alert, Button, cx, Field, inputClass, StatusPill } from "@/components/ui/primitives";
import type { ItemResult } from "@/lib/scoring/types";
import type { FitActionResult, FitResultView, FitSheetData, FitSignalView } from "@/lib/scoring/view";

/**
 * Evaluate fit (P1-E6): review the profile's configured signals for this
 * company, then evaluate. The score is computed on the server from durable
 * data only (no provider calls); this sheet only shows it.
 *   1 ICP + signal review   2 Evaluation result
 */

const RESULT_TEXT: Record<ItemResult, { label: string; mark: string }> = {
  matched: { label: "Matched", mark: "✓" },
  partial: { label: "Partly matched", mark: "◐" },
  not_matched: { label: "Not matched", mark: "✕" },
  unknown: { label: "Unknown", mark: "—" },
};

const STATE_TEXT = { present: "Present", absent: "Not present", unknown: "Unknown" } as const;

export function FitSheet({
  workspaceId,
  companyId,
  companyName,
  settingsPath,
  onClose,
}: {
  workspaceId: string;
  companyId: string;
  companyName: string;
  settingsPath: string;
  onClose: () => void;
}) {
  const uid = useId();
  const [data, setData] = useState<FitSheetData | null>(null);
  const [stage, setStage] = useState<"signals" | "result">("signals");
  const [choices, setChoices] = useState<Record<string, { state: FitSignalView["state"]; note: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("Loading the evaluation…");
  const [pending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState("Loading…");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const apply = (r: FitActionResult, showResult: boolean) => {
    if (r.data) {
      setData(r.data);
      setChoices(Object.fromEntries(r.data.signals.map((s) => [`${s.kind}:${s.id}`, { state: s.state, note: s.note ?? "" }])));
      if (showResult && r.data.result) setStage("result");
    }
    if (!r.ok) {
      setError(r.error);
      setAnnounce(r.error);
    }
  };

  const load = (profileId: string | null, initial = false) => {
    setPendingLabel("Loading…");
    setError(null);
    startTransition(async () => {
      try {
        const r = await loadFitEvaluation(workspaceId, companyId, profileId);
        if (!r.ok && !r.data) {
          setLoadError(r.error);
          setAnnounce(r.error);
          return;
        }
        apply(r, initial);
        setStage(initial && r.data?.result ? "result" : "signals");
        setAnnounce(initial && r.data?.result ? "Latest evaluation shown." : "Review the signals, then evaluate.");
      } catch {
        setLoadError("Vleeds couldn't reach the server. Check your connection and try again.");
      }
    });
  };

  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    queueMicrotask(() => load(null, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [stage, data?.profile.id]);

  const changes = data
    ? data.signals.flatMap((s) => {
        const c = choices[`${s.kind}:${s.id}`];
        if (!c) return [];
        const note = c.note.trim() || null;
        return c.state !== s.state || (c.state !== "unknown" && note !== (s.note ?? null)) ? [{ kind: s.kind, signalId: s.id, state: c.state, note: c.state === "unknown" ? null : note }] : [];
      })
    : [];

  const evaluate = () => {
    if (!data) return;
    if (data.notEvaluable) return setError(data.notEvaluable);
    setPendingLabel("Evaluating…");
    setAnnounce("Evaluating fit…");
    setError(null);
    startTransition(async () => {
      try {
        if (changes.length) {
          const saved = await saveSignalObservations(workspaceId, { companyId, icpProfileId: data.profile.id, revision: data.profile.revision, changes });
          if (!saved.ok) return apply(saved, false);
        }
        const r = await evaluateCompanyFit(workspaceId, { companyId, icpProfileId: data.profile.id });
        apply(r, true);
        if (r.ok && r.data.result) {
          setStage("result");
          setAnnounce(r.data.result.status === "excluded" ? "Evaluated: excluded." : `Evaluated: grade ${r.data.result.grade}, fit ${r.data.result.score} out of 100.`);
        }
      } catch {
        setError("Vleeds couldn't reach the server. Check your connection and try again.");
      }
    });
  };

  const saveOnly = () => {
    if (!data || !changes.length) return;
    setPendingLabel("Saving…");
    setAnnounce("Saving signals…");
    setError(null);
    startTransition(async () => {
      try {
        const saved = await saveSignalObservations(workspaceId, { companyId, icpProfileId: data.profile.id, revision: data.profile.revision, changes });
        apply(saved, false);
        if (saved.ok) setAnnounce("Signals saved. Evaluate to update the score.");
      } catch {
        setError("Vleeds couldn't reach the server. Check your connection and try again.");
      }
    });
  };

  const result = data?.result ?? null;
  const saveLabel = stage === "result" ? "Recalculate fit" : result ? "Recalculate fit" : "Evaluate fit";

  return (
    <ConfigSheet
      title={result ? "Fit evaluation" : "Evaluate fit"}
      description={`${companyName} against an ideal customer profile. Calculated by Vleeds from saved data only.`}
      icon={<Gauge className="stroke-[1.75]" />}
      dirty={false}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={() => (loadError ? onClose() : stage === "result" ? (result?.current ? setStage("signals") : evaluate()) : evaluate())}
      saveLabel={loadError ? "Close" : stage === "result" && result?.current ? "Review signals" : saveLabel}
      pendingLabel={pendingLabel}
      cancelLabel="Close"
      hideCancel={!!loadError}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {loadError ? (
        <div className="flex flex-col gap-3">
          <Alert>{loadError}</Alert>
          <Link href={settingsPath} className="text-[14px] font-medium text-brand hover:underline">
            Go to Settings
          </Link>
        </div>
      ) : !data ? (
        <p className="text-[14px] text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5" aria-busy={pending}>
          <ol aria-label="Steps" className="flex flex-wrap gap-x-4 text-[12.5px]">
            {["ICP and signal review", "Evaluation result"].map((s, i) => (
              <li key={s} aria-current={(stage === "signals" ? 0 : 1) === i ? "step" : undefined} className={(stage === "signals" ? 0 : 1) === i ? "font-semibold text-brand-strong" : "text-ink-subtle"}>
                {i + 1}. {s}
              </li>
            ))}
          </ol>

          {stage === "signals" ? (
            <SignalsStage
              uid={uid}
              data={data}
              choices={choices}
              setChoice={(key, v) => setChoices((c) => ({ ...c, [key]: { ...c[key], ...v } }))}
              onProfile={(id) => load(id)}
              settingsPath={settingsPath}
              headingRef={headingRef}
              pending={pending}
              changed={changes.length}
              onSaveOnly={saveOnly}
            />
          ) : result ? (
            <ResultStage result={result} data={data} headingRef={headingRef} onSignals={() => setStage("signals")} onRecalculate={evaluate} pending={pending} />
          ) : null}
        </div>
      )}
    </ConfigSheet>
  );
}

// -----------------------------------------------------------------------------

function SignalsStage({
  uid,
  data,
  choices,
  setChoice,
  onProfile,
  settingsPath,
  headingRef,
  pending,
  changed,
  onSaveOnly,
}: {
  changed: number;
  onSaveOnly: () => void;
  uid: string;
  data: FitSheetData;
  choices: Record<string, { state: FitSignalView["state"]; note: string }>;
  setChoice: (key: string, v: Partial<{ state: FitSignalView["state"]; note: string }>) => void;
  onProfile: (id: string) => void;
  settingsPath: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  pending: boolean;
}) {
  const buying = data.signals.filter((s) => s.kind === "buying");
  const exclusion = data.signals.filter((s) => s.kind === "exclusion");
  return (
    <>
      <h3 ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
        ICP and signal review
      </h3>
      {data.profiles.length > 1 ? (
        <Field label="Ideal customer profile" htmlFor={`${uid}-icp`}>
          <select id={`${uid}-icp`} value={data.profile.id} disabled={pending} onChange={(e) => onProfile(e.target.value)} className={inputClass}>
            {data.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-[13.5px]">
        <dt className="text-ink-subtle">Profile</dt>
        <dd className="min-w-0 break-words text-ink">
          {data.profile.name} · revision {data.profile.revision}
        </dd>
        <dt className="text-ink-subtle">Weights</dt>
        <dd className="min-w-0 text-ink">
          {data.profile.weights.map((w, i) => (
            <span key={w.key} className={cx(!w.configured && "text-ink-subtle")}>
              {i ? " · " : ""}
              {w.label} {w.weight}
              {w.configured ? "" : " (no criteria)"}
            </span>
          ))}
        </dd>
        {data.profile.thresholds ? (
          <>
            <dt className="text-ink-subtle">Grades</dt>
            <dd className="text-ink">
              A from {data.profile.thresholds.a} · B from {data.profile.thresholds.b} · C below
            </dd>
          </>
        ) : null}
      </dl>
      {data.notEvaluable ? (
        <div className="rounded-md border border-line bg-surface-muted px-3.5 py-3 text-[14px] text-ink">
          <p>{data.notEvaluable}</p>
          <Link href={settingsPath} className="mt-1 inline-block font-medium text-brand hover:underline">
            Configure the profile in Settings
          </Link>
        </div>
      ) : null}

      {[["Buying signals", buying], ["Exclusions", exclusion]].map(([title, list]) =>
        (list as FitSignalView[]).length ? (
          <section key={title as string} aria-label={title as string} className="flex flex-col gap-3">
            <h4 className="text-[14px] font-semibold text-ink">{title as string}</h4>
            {(list as FitSignalView[]).map((s) => {
              const key = `${s.kind}:${s.id}`;
              const c = choices[key] ?? { state: s.state, note: "" };
              return (
                <fieldset key={key} data-signal={s.name} className="rounded-lg border border-line px-3.5 py-3">
                  <legend className="px-1 text-[14px] font-medium text-ink">{s.name}</legend>
                  {s.description ? <p className="text-[12.5px] text-ink-subtle">{s.description}</p> : null}
                  <p className="text-[12.5px] text-ink-muted">{s.effect}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["present", "absent", "unknown"] as const).map((st) => (
                      <label key={st} className={cx("flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 sm:min-h-9", c.state === st ? "border-brand bg-brand-tint/60" : "border-line-strong")}>
                        <input type="radio" name={`${uid}-${key}`} value={st} checked={c.state === st} onChange={() => setChoice(key, { state: st })} className="size-4 accent-[var(--color-brand)]" />
                        <span className="text-[13.5px] text-ink">{STATE_TEXT[st]}</span>
                      </label>
                    ))}
                  </div>
                  {c.state !== "unknown" ? (
                    <div className="mt-2">
                      <label htmlFor={`${uid}-${key}-note`} className="text-[12.5px] text-ink-subtle">
                        Note (optional)
                      </label>
                      <input id={`${uid}-${key}-note`} value={c.note} maxLength={500} onChange={(e) => setChoice(key, { note: e.target.value })} className={cx(inputClass, "mt-1 h-10")} />
                    </div>
                  ) : null}
                </fieldset>
              );
            })}
          </section>
        ) : null,
      )}
      {!data.signals.length ? <p className="text-[13.5px] text-ink-muted">This profile has no buying or exclusion signals to review.</p> : null}
      {data.signals.length ? (
        <Button type="button" className="h-11 self-start sm:h-9" disabled={pending || !changed} onClick={onSaveOnly}>
          Save signals only
        </Button>
      ) : null}
      <p className="text-[12.5px] text-ink-subtle">
        Signals are your own confirmed observations for this profile revision. Unknown is fine: it lowers data coverage, not fit. Evaluating never calls a data
        provider and doesn&apos;t change qualification or do-not-contact status.
      </p>
    </>
  );
}

function ResultStage({
  result,
  data,
  headingRef,
  onSignals,
  onRecalculate,
  pending,
}: {
  result: FitResultView;
  data: FitSheetData;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onSignals: () => void;
  onRecalculate: () => void;
  pending: boolean;
}) {
  return (
    <>
      <h3 ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
        Evaluation result
      </h3>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-line px-4 py-3.5" data-fit-result>
        {result.status === "excluded" ? (
          <div>
            <StatusPill tone="neutral" className="h-7 px-3 text-[13px]">
              Excluded
            </StatusPill>
            <p className="mt-1 text-[13.5px] text-ink">Reason: {result.exclusionReasons.join(", ")}</p>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {result.grade ? <LeadGradeBadge grade={result.grade} /> : null}
            <div>
              <p className="text-[22px] font-semibold leading-7 text-ink">
                {result.score}
                <span className="text-[14px] font-normal text-ink-muted"> / 100 fit</span>
              </p>
              <p className="text-[13px] text-ink-muted">Grade {result.grade}</p>
            </div>
          </div>
        )}
        <div>
          <p className="text-[15px] font-semibold text-ink">Coverage {result.coveragePercent ?? 0}%</p>
          <p className="max-w-xs text-[12.5px] text-ink-subtle">How much of this profile Vleeds could check. It doesn&apos;t change the fit score.</p>
        </div>
        <div className="flex flex-col items-start gap-1">
          <StatusPill tone={result.current ? "brand" : "warning"} className="h-6 px-2.5 text-[12px]">
            {result.current ? "Current" : "Outdated"}
          </StatusPill>
          {!result.current ? (
            <span className="text-[12.5px] text-ink-muted">
              {result.outdatedReason === "profile" ? "The profile changed since this result." : "Company, contact or signal data changed since this result."}
            </span>
          ) : null}
          <span className="text-[12px] text-ink-subtle">
            {data.profile.name} · revision {result.revision}
          </span>
        </div>
      </div>

      <table className="w-full table-fixed border-collapse text-left text-[13.5px]">
        <caption className="sr-only">Score breakdown by category</caption>
        <thead>
          <tr className="border-b border-line text-[12.5px] text-ink-subtle">
            <th scope="col" className="w-[36%] py-2 pr-2 font-medium">Category</th>
            <th scope="col" className="py-2 pr-2 font-medium">Fit</th>
            <th scope="col" className="py-2 pr-2 font-medium">Weight</th>
            <th scope="col" className="py-2 text-right font-medium">Points</th>
          </tr>
        </thead>
        <tbody>
          {result.categories.map((c) => (
            <tr key={c.key} className="border-b border-line">
              <th scope="row" className="py-2 pr-2 font-normal text-ink">{c.label}</th>
              <td className="py-2 pr-2 tabular-nums text-ink">{c.raw}%</td>
              <td className="py-2 pr-2 text-ink-muted">
                {c.configuredWeight}
                {c.effectiveWeight !== c.configuredWeight ? <span className="block text-[12px]">effective {c.effectiveWeight}%</span> : null}
              </td>
              <td className="py-2 text-right tabular-nums text-ink">{c.points.toFixed(1)}</td>
            </tr>
          ))}
          {result.penalty ? (
            <tr className="border-b border-line">
              <th scope="row" className="py-2 pr-2 font-normal text-ink">Exclusion penalty</th>
              <td colSpan={2} />
              <td className="py-2 text-right tabular-nums text-ink">−{result.penalty}</td>
            </tr>
          ) : null}
          <tr>
            <th scope="row" className="py-2 pr-2 font-medium text-ink">{result.status === "excluded" ? "Fit before exclusion" : "Fit score"}</th>
            <td colSpan={2} className="py-2 text-[12px] text-ink-subtle">
              {result.baseScore !== null && result.penalty ? `base ${result.baseScore}, rounded` : "rounded"}
            </td>
            <td className="py-2 text-right font-semibold tabular-nums text-ink">{result.status === "excluded" ? Math.max(0, (result.baseScore ?? 0) - result.penalty) : result.score}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-[12.5px] text-ink-subtle">
        Categories without criteria in this profile are left out; the remaining weights are scaled to 100 (&quot;effective&quot;). Penalties are subtracted as points.
      </p>

      <section aria-labelledby="why-score" className="flex flex-col gap-3">
        <h4 id="why-score" className="text-[14px] font-semibold text-ink">
          Why this score?
        </h4>
        {[...result.why, ...(result.exclusions.length ? [{ label: "Exclusions", items: result.exclusions }] : [])].map((g) => (
          <div key={g.label}>
            <p className="text-[13px] font-medium text-ink-muted">{g.label}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {g.items.map((i, n) => (
                <li key={n} className="flex items-start gap-2 text-[13.5px] text-ink">
                  <span aria-hidden className={cx("w-4 shrink-0 text-center", i.result === "matched" ? "text-brand" : "text-ink-subtle")}>
                    {RESULT_TEXT[i.result].mark}
                  </span>
                  <span>
                    <span className="sr-only">{RESULT_TEXT[i.result].label}: </span>
                    {i.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {result.missing.length ? (
        <section aria-labelledby="improve-coverage" className="rounded-lg border border-line bg-surface-muted px-3.5 py-3">
          <h4 id="improve-coverage" className="text-[14px] font-semibold text-ink">
            Improve data coverage
          </h4>
          <p className="text-[12.5px] text-ink-subtle">Missing:</p>
          <ul className="mt-1 list-disc pl-5 text-[13.5px] text-ink">
            {result.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-ink-muted">
            Use Enrich company and Find decision makers in this company&apos;s details, or review signals here. Nothing runs automatically.
          </p>
          <Button type="button" className="mt-2 h-11 sm:h-9" disabled={pending} onClick={onSignals}>
            Review signals
          </Button>
        </section>
      ) : null}
      {result.current ? null : (
        <Alert tone="info">
          This result is outdated. <button type="button" className="font-medium underline" onClick={onRecalculate} disabled={pending}>Recalculate fit</button> to use the current data.
        </Alert>
      )}
    </>
  );
}
