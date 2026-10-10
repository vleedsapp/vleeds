"use client";

import { Building2, Check, CircleSlash, Globe, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  cancelEnrichment,
  enrichDomain,
  resolveDomains,
  retryEnrichment,
  saveEnrichment,
  startEnrichment,
} from "@/app/w/[workspaceId]/enrichment/actions";
import { ConfigSheet } from "@/components/settings/config-sheet";
import { Alert, Button, cx, Field, inputClass, StatusPill, type Tone } from "@/components/ui/primitives";
import {
  formatCredits,
  MIN_LOOKUP_NAME,
  type EnrichmentActionResult,
  type EnrichmentDecision,
  type EnrichmentView,
  type ReviewFieldView,
} from "@/lib/enrichment/model";

/**
 * One interactive company enrichment, in four stages inside one sheet:
 *   1 Identify company   (name or domain; skipped when the domain is known)
 *   2 Choose domain      (free domain suggestions; nothing is spent yet)
 *   3 Review company data(compare with the matching Vleeds company; decide)
 *   4 Save to Vleeds     (compact outcome)
 * The credit-bearing lookup runs only on "Enrich company · estimated N credit".
 * A transient discovery name (from an open search) lives only in this
 * component's state and is sent to the server for the domain lookup only.
 */

export type EnrichmentStart =
  | { source: "discovery"; discoveryRunId: string; candidateId: string; transientName: string | null; referenceLabel: string | null }
  | { source: "manual" }
  | { source: "existing"; companyId: string; companyName: string; domain: string | null };

export type EnrichmentDone = { companyId: string | null; commitResult: "created" | "merged" | "skipped" };

const DECISION_TEXT: Record<EnrichmentDecision, { label: string; detail: string }> = {
  create: { label: "Create", detail: "Add this company to Leads with the data shown." },
  merge: { label: "Merge", detail: "Fill empty fields of the existing company. Existing values are kept; differences are reported." },
  skip: { label: "Skip", detail: "Write nothing to Leads. The lookup stays in the enrichment history." },
};

const OUTCOME: Record<ReviewFieldView["outcome"], { label: string; tone: Tone }> = {
  new: { label: "New", tone: "brand" },
  fill: { label: "Will fill", tone: "brand" },
  same: { label: "Same", tone: "neutral" },
  keep: { label: "Keeps existing", tone: "warning" },
  none: { label: "Not provided", tone: "neutral" },
};

export function EnrichmentSheet({
  workspaceId,
  start,
  providerLabel,
  estimateMillis,
  leadsPath,
  onClose,
  onDone,
}: {
  workspaceId: string;
  start: EnrichmentStart;
  providerLabel: string;
  estimateMillis: number | null;
  leadsPath: string;
  onClose: () => void;
  onDone?: (done: EnrichmentDone) => void;
}) {
  const uid = useId();
  const [view, setView] = useState<EnrichmentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState("Working…");
  const stageRef = useRef<HTMLHeadingElement>(null);

  // Identify stage
  const knownName = start.source === "discovery" ? start.transientName : start.source === "existing" ? start.companyName : null;
  const knownDomain = start.source === "existing" ? start.domain : null;
  const [by, setBy] = useState<"name" | "domain">(knownDomain ? "domain" : "name");
  const [name, setName] = useState(knownName ?? "");
  const [domain, setDomain] = useState(knownDomain ?? "");
  // Domain stage
  const [choice, setChoice] = useState<string>("");
  const [otherDomain, setOtherDomain] = useState("");
  // Review stage
  const [decision, setDecision] = useState<EnrichmentDecision | null>(null);

  const credit = estimateMillis !== null ? ` · estimated ${formatCredits(estimateMillis)} credit` : "";
  const stage: "identify" | "domains" | "review" | "done" = !view
    ? "identify"
    : view.outcome || view.status === "completed"
      ? "done"
      : view.review
        ? "review"
        : "domains";

  useEffect(() => {
    stageRef.current?.focus();
  }, [stage]);

  const run = (label: string, busy: string, call: () => Promise<EnrichmentActionResult>) => {
    setPendingLabel(label);
    setAnnounce(busy);
    setError(null);
    startTransition(async () => {
      let r: EnrichmentActionResult;
      try {
        r = await call();
      } catch {
        setError("Vleeds couldn't reach the server. Check your connection and try again.");
        setAnnounce("Request failed.");
        return;
      }
      if (r.view) {
        setView(r.view);
        setChoice(r.view.suggestions.length === 1 ? r.view.suggestions[0].domain : (r.view.suggestions[0]?.domain ?? (r.view.requestedDomain ? "other" : "")));
        if (!r.view.suggestions.length && r.view.requestedDomain) setOtherDomain(r.view.requestedDomain);
        if (r.view.review) setDecision(r.view.review.decision);
        if (r.view.outcome) onDone?.({ companyId: r.view.outcome.companyId, commitResult: r.view.outcome.commitResult });
      }
      if (!r.ok) {
        setError(r.error);
        setAnnounce(r.error);
      } else if (r.view.outcome) {
        setAnnounce(r.view.outcome.commitResult === "created" ? "Company created." : r.view.outcome.commitResult === "merged" ? "Company updated." : "Skipped.");
      } else if (r.view.review) {
        setAnnounce("Company data found. Review it before saving.");
      } else if (r.view.suggestions.length) {
        setAnnounce(`${r.view.suggestions.length} possible domain${r.view.suggestions.length === 1 ? "" : "s"} found.`);
      } else setAnnounce("");
    });
  };

  const begin = (lookup: { by: "name"; companyName: string } | { by: "domain"; domain: string }) => {
    const base =
      start.source === "discovery"
        ? { source: "discovery", discoveryRunId: start.discoveryRunId, candidateId: start.candidateId }
        : start.source === "existing"
          ? { source: "existing", companyId: start.companyId }
          : { source: "manual" };
    if (lookup.by === "name") run("Finding domains…", "Finding possible domains…", () => startEnrichment(workspaceId, { ...base, lookup }));
    else run("Enriching…", "Looking up company data…", () => startEnrichment(workspaceId, { ...base, lookup }));
  };

  // A discovery reference with its (transient) name starts the free domain lookup right away.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (start.source === "discovery" && start.transientName && start.transientName.trim().length >= MIN_LOOKUP_NAME) {
      const companyName = start.transientName;
      // Deferred out of the effect body; the ref keeps it to one request even under StrictMode.
      queueMicrotask(() => begin({ by: "name", companyName }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (view && view.status !== "completed" && view.status !== "cancelled") void cancelEnrichment(workspaceId, view.runId).catch(() => {});
    onClose();
  };

  const submit = () => {
    if (stage === "identify") {
      if (by === "name") {
        if (name.trim().length < MIN_LOOKUP_NAME) return setError(`Enter at least ${MIN_LOOKUP_NAME} characters of the company name.`);
        return begin({ by: "name", companyName: name });
      }
      if (!domain.trim()) return setError("Enter a domain like example.com.");
      return begin({ by: "domain", domain });
    }
    if (stage === "domains" && view) {
      const d = choice === "other" || !view.suggestions.length ? otherDomain : choice;
      if (!d.trim()) return setError("Choose a domain or enter one.");
      return run("Enriching…", "Looking up company data…", () => enrichDomain(workspaceId, view.runId, d));
    }
    if (stage === "review" && view) {
      if (!decision) return setError("Choose what should happen.");
      return run("Saving…", "Saving to Vleeds…", () => saveEnrichment(workspaceId, view.runId, decision));
    }
    onClose();
  };

  const saveLabel =
    stage === "identify"
      ? by === "name"
        ? "Find domains"
        : `Enrich company${credit}`
      : stage === "domains"
        ? `Enrich company${credit}`
        : stage === "review"
          ? start.source === "existing"
            ? "Save enrichment"
            : "Save to Vleeds"
          : "Done";

  const steps = ["Identify company", "Choose domain", "Review company data", "Save to Vleeds"];
  const stepIndex = { identify: 0, domains: 1, review: 2, done: 3 }[stage];

  return (
    <ConfigSheet
      title={start.source === "existing" ? `Enrich ${start.companyName}` : "Find company data"}
      description={`Company data from ${providerLabel}. Nothing is saved until you choose.`}
      icon={<Building2 className="stroke-[1.75]" />}
      dirty={false}
      pending={pending}
      error={error}
      onClose={close}
      onSave={submit}
      saveLabel={saveLabel}
      pendingLabel={pendingLabel}
      hideCancel={stage === "done"}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <ol aria-label="Steps" className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === stepIndex ? "step" : undefined} className={cx(i === stepIndex ? "font-semibold text-brand-strong" : i < stepIndex ? "text-ink-muted" : "text-ink-subtle")}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-5" aria-busy={pending}>
        {stage === "identify" ? (
          <>
            <h3 ref={stageRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
              Identify company
            </h3>
            {start.source === "discovery" && !start.transientName ? (
              <p className="text-[13.5px] text-ink-muted">
                The search details of this reference{start.referenceLabel ? ` (from “${start.referenceLabel}”)` : ""} are no longer shown. Enter the
                company&apos;s name or domain to look it up.
              </p>
            ) : null}
            {pending && start.source === "discovery" && start.transientName ? (
              <p className="text-[14px] text-ink-muted">Finding possible domains for {start.transientName}…</p>
            ) : (
              <>
                <fieldset>
                  <legend className="mb-2 text-[13.5px] font-medium text-ink">Look up by</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ["name", "Company name", "Find likely domains first (free)."],
                        ["domain", "Domain", "Go straight to company data."],
                      ] as const
                    ).map(([v, label, hint]) => (
                      <label key={v} className={cx("flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5", by === v ? "border-brand bg-brand-tint/60" : "border-line-strong")}>
                        <input type="radio" name={`${uid}-by`} value={v} checked={by === v} onChange={() => setBy(v)} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                        <span>
                          <span className="block text-[14px] font-medium text-ink">{label}</span>
                          <span className="block text-[12.5px] text-ink-subtle">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {by === "name" ? (
                  <Field label="Company name" htmlFor={`${uid}-name`} hint={`At least ${MIN_LOOKUP_NAME} characters.`}>
                    <input id={`${uid}-name`} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="off" />
                  </Field>
                ) : (
                  <Field label="Domain" htmlFor={`${uid}-domain`} hint="For example example.com. A full web address works too.">
                    <input id={`${uid}-domain`} value={domain} maxLength={300} onChange={(e) => setDomain(e.target.value)} className={inputClass} autoCapitalize="none" autoComplete="off" inputMode="url" />
                  </Field>
                )}
                {by === "domain" && estimateMillis !== null ? <CreditNote providerLabel={providerLabel} millis={estimateMillis} /> : null}
              </>
            )}
          </>
        ) : null}

        {stage === "domains" && view ? (
          <>
            <h3 ref={stageRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
              Choose domain
            </h3>
            {view.error?.retry && view.status === "failed" ? (
              <Button type="button" className="h-11 self-start sm:h-10" disabled={pending} onClick={() => run("Enriching…", "Trying again…", () => retryEnrichment(workspaceId, view.runId))}>
                <RotateCcw aria-hidden className="size-4" />
                Try again
              </Button>
            ) : null}
            {view.error?.retry && view.status === "domain_review" ? (
              <Button
                type="button"
                className="h-11 self-start sm:h-10"
                disabled={pending}
                onClick={() => run("Finding domains…", "Finding possible domains…", () => resolveDomains(workspaceId, view.runId, knownName ?? name))}
              >
                <RotateCcw aria-hidden className="size-4" />
                Try again
              </Button>
            ) : null}
            <fieldset>
              <legend className="mb-2 text-[13.5px] font-medium text-ink">{view.suggestions.length ? "Possible domains" : "Company domain"}</legend>
              <div className="flex flex-col gap-2">
                {view.suggestions.map((s) => (
                  <label key={s.domain} className={cx("flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5", choice === s.domain ? "border-brand bg-brand-tint/60" : "border-line-strong")}>
                    <input type="radio" name={`${uid}-domain-choice`} value={s.domain} checked={choice === s.domain} onChange={() => setChoice(s.domain)} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                    <span className="min-w-0">
                      <span className="block break-all text-[14px] font-medium text-ink">{s.domain}</span>
                      <span className="block text-[12.5px] text-ink-subtle">
                        {[s.companyName, s.confidenceLabel, s.emailCount ? `${s.emailCount.toLocaleString("en")} public addresses known` : null].filter(Boolean).join(" · ") || "No name given"}
                      </span>
                    </span>
                  </label>
                ))}
                {view.suggestions.length ? (
                  <label className={cx("flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5", choice === "other" ? "border-brand bg-brand-tint/60" : "border-line-strong")}>
                    <input type="radio" name={`${uid}-domain-choice`} value="other" checked={choice === "other"} onChange={() => setChoice("other")} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                    <span className="block text-[14px] font-medium text-ink">Enter another domain</span>
                  </label>
                ) : null}
              </div>
            </fieldset>
            {choice === "other" || !view.suggestions.length ? (
              <Field label="Domain" htmlFor={`${uid}-other`} hint="For example example.com.">
                <input id={`${uid}-other`} value={otherDomain} maxLength={300} onChange={(e) => setOtherDomain(e.target.value)} className={inputClass} autoCapitalize="none" autoComplete="off" inputMode="url" />
              </Field>
            ) : null}
            {view.suggestions.length ? <p className="text-[12.5px] text-ink-subtle">Domain suggestions provided by {view.providerLabel}. Check that the domain belongs to this company.</p> : null}
            {estimateMillis !== null ? <CreditNote providerLabel={view.providerLabel} millis={estimateMillis} /> : null}
          </>
        ) : null}

        {stage === "review" && view?.review ? (
          <>
            <h3 ref={stageRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
              Review company data
            </h3>
            <div className={cx("rounded-lg border px-4 py-3", view.review.matchState === "new" ? "border-line bg-surface-muted" : "border-warning/30 bg-warning-tint")}>
              <p className="text-[14px] font-medium text-ink">
                Vleeds match: {view.review.matchState === "new" ? "New company" : view.review.matchState === "existing_company" ? "Existing company" : "Possible duplicate"}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-muted">{view.review.matchText}</p>
            </div>
            <CompareFields fields={view.review.fields} providerLabel={view.providerLabel} showExisting={view.review.matchState !== "new"} matchedName={view.review.matched?.name ?? null} />
            {view.review.tags.length ? (
              <p className="text-[12.5px] text-ink-subtle">
                Tags (kept as source evidence only): {view.review.tags.join(", ")}
              </p>
            ) : null}
            <fieldset>
              <legend className="mb-2 text-[13.5px] font-medium text-ink">What should happen?</legend>
              <div className="flex flex-col gap-2">
                {(["create", "merge", "skip"] as const).map((d) => {
                  const allowed = view.review!.allowed.includes(d);
                  if (!allowed && d === "merge") return null;
                  return (
                    <label
                      key={d}
                      className={cx(
                        "flex min-h-11 items-start gap-3 rounded-md border px-3 py-2.5",
                        !allowed ? "cursor-not-allowed border-line bg-surface-muted opacity-70" : decision === d ? "cursor-pointer border-brand bg-brand-tint/60" : "cursor-pointer border-line-strong",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${uid}-decision`}
                        value={d}
                        disabled={!allowed}
                        checked={decision === d}
                        onChange={() => setDecision(d)}
                        aria-describedby={`${uid}-decision-${d}`}
                        className="mt-0.5 size-4 accent-[var(--color-brand)]"
                      />
                      <span>
                        <span className="block text-[14px] font-medium text-ink">{DECISION_TEXT[d].label}</span>
                        <span id={`${uid}-decision-${d}`} className="block text-[12.5px] text-ink-subtle">
                          {!allowed && d === "create"
                            ? `Not available: ${view.review!.matched?.name ?? "an existing company"} is the same company (same domain or provider record), so it can't be created twice. Choose Merge or Skip.`
                            : DECISION_TEXT[d].detail}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </>
        ) : null}

        {stage === "done" && view ? (
          <>
            <h3 ref={stageRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
              {view.outcome?.commitResult === "created" ? "Company created" : view.outcome?.commitResult === "merged" ? "Company updated" : "Skipped"}
            </h3>
            <ul className="flex flex-col gap-2 text-[14px] text-ink">
              {view.outcome && view.outcome.commitResult !== "skipped" ? (
                <>
                  <li className="flex items-start gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                    {view.outcome.commitResult === "created" ? `${view.outcome.companyName ?? "The company"} was added to Leads.` : `${view.outcome.companyName ?? "The company"} was updated (empty fields only).`}
                  </li>
                  <li className="flex items-start gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                    {view.providerLabel} evidence added ({view.outcome.evidenceAdded} field{view.outcome.evidenceAdded === 1 ? "" : "s"}).
                  </li>
                  {view.outcome.identityLinked ? (
                    <li className="flex items-start gap-2">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                      Discovery reference linked: later searches show this place as an existing company.
                    </li>
                  ) : null}
                </>
              ) : (
                <li className="flex items-start gap-2">
                  <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
                  Nothing was written to Leads.
                </li>
              )}
              <li className="flex items-start gap-2 text-ink-muted">
                <Globe aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
                Estimated {view.providerLabel} credits used: {formatCredits(view.creditsUsedMillis)}
              </li>
            </ul>
            {view.outcome?.notes.length ? (
              <div>
                <p className="text-[13.5px] font-medium text-ink">Kept existing values</p>
                <ul className="mt-1 flex flex-col gap-1 text-[13px] text-ink-muted">
                  {view.outcome.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {view.outcome?.companyId ? (
              <Link href={`${leadsPath}?company=${view.outcome.companyId}`} className="text-[14px] font-medium text-brand hover:underline">
                Open company
              </Link>
            ) : null}
          </>
        ) : null}

        {view && stage !== "done" && view.creditsUsedMillis > 0 ? (
          <p className="text-[12.5px] text-ink-subtle">Estimated credits used so far: {formatCredits(view.creditsUsedMillis)}</p>
        ) : null}
        {error && stage === "review" ? <Alert tone="info">Your choice was not saved.</Alert> : null}
      </div>
    </ConfigSheet>
  );
}

function CreditNote({ providerLabel, millis }: { providerLabel: string; millis: number }) {
  return (
    <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-[12.5px] text-ink-muted">
      Enriching uses an estimated {formatCredits(millis)} {providerLabel} credit when company data is found. Finding domains is free. Your{" "}
      {providerLabel} account shows the actual balance.
    </p>
  );
}

function CompareFields({ fields, providerLabel, showExisting, matchedName }: { fields: ReviewFieldView[]; providerLabel: string; showExisting: boolean; matchedName: string | null }) {
  const dash = <span className="text-ink-subtle">—</span>;
  return (
    <>
      <table className="hidden w-full table-fixed border-collapse text-left text-[14px] sm:table">
        <caption className="sr-only">Company data from {providerLabel}{showExisting ? ` compared with ${matchedName ?? "the existing company"}` : ""}</caption>
        <thead>
          <tr className="border-b border-line text-[12.5px] text-ink-subtle">
            <th scope="col" className="w-[22%] py-2 pr-2 font-medium">Field</th>
            <th scope="col" className="py-2 pr-2 font-medium">{providerLabel}</th>
            {showExisting ? <th scope="col" className="py-2 pr-2 font-medium">In Vleeds</th> : null}
            <th scope="col" className="w-[110px] py-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.key} data-field={f.key} className="border-b border-line align-top last:border-b-0">
              <th scope="row" className="py-2.5 pr-2 font-normal text-ink-subtle">{f.label}</th>
              <td className={cx("break-words py-2.5 pr-2 text-ink", f.key === "description" && "text-[13px]")}>{f.incoming ?? dash}</td>
              {showExisting ? <td className={cx("break-words py-2.5 pr-2 text-ink", f.key === "description" && "text-[13px]")}>{f.existing ?? dash}</td> : null}
              <td className="py-2.5">
                <StatusPill tone={OUTCOME[f.outcome].tone} className="h-6 px-2 text-[11.5px]">{OUTCOME[f.outcome].label}</StatusPill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl aria-label={`Company data from ${providerLabel}`} className="flex flex-col divide-y divide-line rounded-lg border border-line sm:hidden">
        {fields.map((f) => (
          <div key={f.key} data-field={f.key} className="flex flex-col gap-1 px-3 py-2.5">
            <dt className="flex items-center justify-between gap-2 text-[12.5px] text-ink-subtle">
              {f.label}
              <StatusPill tone={OUTCOME[f.outcome].tone} className="h-6 px-2 text-[11.5px]">{OUTCOME[f.outcome].label}</StatusPill>
            </dt>
            <dd className="break-words text-[14px] text-ink">
              <span className="sr-only">{providerLabel}: </span>
              {f.incoming ?? dash}
            </dd>
            {showExisting ? (
              <dd className="break-words text-[13px] text-ink-muted">
                In Vleeds: {f.existing ?? "—"}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </>
  );
}
