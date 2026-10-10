"use client";

import { Check, RotateCcw, UserSearch, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  cancelContactSearch,
  decideContactCandidate,
  retryContactSearch,
  saveContactSelection,
  startContactSearch,
} from "@/app/w/[workspaceId]/leads/contact-discovery-actions";
import { ConfigSheet } from "@/components/settings/config-sheet";
import { Button, cx, Field, inputClass, StatusPill, type Tone } from "@/components/ui/primitives";
import {
  MAX_SEARCH_TITLES,
  VERIFICATION_LABEL,
  type CandidateAction,
  type ContactActionResult,
  type ContactCandidateView,
  type ContactSearchView,
} from "@/lib/contact-discovery/model";
import { formatCredits } from "@/lib/enrichment/model";

/**
 * Find decision makers for one company (P1-E5), in one sheet:
 *   1 Search setup     ICP, target roles (or typed titles), optional
 *                      "classified decision makers only", credit estimate
 *   2 Review contacts  role-match labels, email status, provider confidence,
 *                      existing/duplicate/conflict state; Select / Dismiss / Undo
 *   3 Save contacts    "Save N contacts"
 *   4 Result
 * The provider is called only on "Find decision makers"; nothing is selected
 * or saved automatically.
 */

export type IcpRoles = { id: string; name: string; isDefault: boolean; roles: { id: string; title: string; priority: "primary" | "secondary" | "fallback" }[] };

const PRIORITY_RANK = { primary: 0, secondary: 1, fallback: 2 } as const;
const PRIORITY_LABEL = { primary: "Primary", secondary: "Secondary", fallback: "Fallback", search: "This search" } as const;
const ordered = (roles: IcpRoles["roles"]) => roles.map((r, i) => ({ r, i })).sort((a, b) => PRIORITY_RANK[a.r.priority] - PRIORITY_RANK[b.r.priority] || a.i - b.i).map((x) => x.r);
const defaults = (roles: IcpRoles["roles"]) => {
  const seen = new Set<string>();
  return ordered(roles)
    .filter((r) => {
      const k = r.title.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_SEARCH_TITLES)
    .map((r) => r.id);
};

const ROLE_TONE: Record<ContactCandidateView["roleMatch"], Tone> = {
  primary: "brand",
  secondary: "info",
  fallback: "neutral",
  search_title: "info",
  decision_maker: "neutral",
  other: "neutral",
};

export function ContactDiscoverySheet({
  workspaceId,
  company,
  providerLabel,
  estimateMillis,
  icps,
  settingsPath,
  onClose,
}: {
  workspaceId: string;
  company: { id: string; name: string; domain: string };
  providerLabel: string;
  estimateMillis: number | null;
  icps: IcpRoles[];
  settingsPath: string;
  onClose: () => void;
}) {
  const uid = useId();
  const initial = icps.find((p) => p.isDefault) ?? icps[0] ?? null;
  const [icpId, setIcpId] = useState(initial?.id ?? "");
  const icp = icps.find((p) => p.id === icpId) ?? null;
  const [roleIds, setRoleIds] = useState<string[]>(initial ? defaults(initial.roles) : []);
  const [manual, setManual] = useState("");
  const [dmOnly, setDmOnly] = useState(false);
  const [view, setView] = useState<ContactSearchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState("Working…");
  const stageRef = useRef<HTMLHeadingElement>(null);

  const credit = estimateMillis !== null ? ` · estimated up to ${formatCredits(estimateMillis)} credit` : "";
  const stage: "setup" | "review" | "empty" | "failed" | "result" = !view
    ? "setup"
    : view.outcome && view.status === "completed"
      ? "result"
      : view.status === "failed"
        ? "failed"
        : view.candidates.length === 0
          ? "empty"
          : "review";

  useEffect(() => {
    stageRef.current?.focus();
  }, [stage]);

  const selectedOpen = view?.candidates.filter((c) => c.decision === "selected" && !c.commitResult).length ?? 0;
  const manualTitles = useMemo(() => manual.split(/\n/).map((t) => t.trim()).filter(Boolean), [manual]);
  const roles = icp ? ordered(icp.roles) : [];
  const atLimit = roleIds.length + manualTitles.length >= MAX_SEARCH_TITLES;

  const run = (label: string, busy: string, call: () => Promise<ContactActionResult>, after?: (r: ContactActionResult) => void) => {
    setPendingLabel(label);
    setAnnounce(busy);
    setError(null);
    startTransition(async () => {
      let r: ContactActionResult;
      try {
        r = await call();
      } catch {
        setError("Vleeds couldn't reach the server. Check your connection and try again.");
        return;
      } finally {
        setBusyId(null);
      }
      if (r.view) setView(r.view);
      if (!r.ok) {
        setError(r.error);
        setAnnounce(r.error);
      } else after?.(r);
    });
  };

  const search = () => {
    if (!roleIds.length && !manualTitles.length && !dmOnly) {
      setError("Choose at least one target role, type a title, or search only for classified decision makers.");
      return;
    }
    run("Searching…", "Searching for decision makers…", () =>
      startContactSearch(workspaceId, { companyId: company.id, icpProfileId: icp?.id ?? null, roleIds, manualTitles, decisionMakerOnly: dmOnly }),
      (r) => r.ok && setAnnounce(r.view.candidates.length ? `${r.view.candidates.length} contact${r.view.candidates.length === 1 ? "" : "s"} found.` : "No contacts found."),
    );
  };

  const decide = (c: ContactCandidateView, action: CandidateAction) => {
    if (!view) return;
    setBusyId(c.id);
    run("Saving…", "", () => decideContactCandidate(workspaceId, view.runId, c.id, action), () =>
      setAnnounce(`${c.fullName}: ${action === "dismiss" ? "dismissed" : action === "reset" ? "decision undone" : "selected"}.`),
    );
  };

  const save = () => {
    if (!view) return;
    if (!selectedOpen) {
      setError("Select at least one contact to save.");
      return;
    }
    run("Saving…", "Saving contacts…", () => saveContactSelection(workspaceId, view.runId), (r) => r.ok && setAnnounce("Contacts saved."));
  };

  const editSearch = (decisionMakersOnly?: boolean) => {
    if (view && (view.status === "review" || view.status === "failed")) void cancelContactSearch(workspaceId, view.runId).catch(() => {});
    if (decisionMakersOnly !== undefined) setDmOnly(decisionMakersOnly);
    setView(null);
    setError(null);
  };

  const close = () => {
    if (view && (view.status === "review" || view.status === "failed") && !view.outcome) void cancelContactSearch(workspaceId, view.runId).catch(() => {});
    onClose();
  };

  const submit = () => {
    if (stage === "setup") return search();
    if (stage === "review") return save();
    if (stage === "failed") return editSearch();
    onClose();
  };

  const saveLabel =
    stage === "setup"
      ? `Find decision makers${credit}`
      : stage === "review"
        ? selectedOpen
          ? `Save ${selectedOpen} contact${selectedOpen === 1 ? "" : "s"}`
          : "Save contacts"
        : stage === "failed"
          ? "Edit search"
          : "Done";

  const steps = ["Search setup", "Review contacts", "Save contacts", "Result"];
  const stepIndex = { setup: 0, failed: 0, empty: 1, review: selectedOpen ? 2 : 1, result: 3 }[stage];

  return (
    <ConfigSheet
      title="Find decision makers"
      description={`Professional contacts at ${company.name} from ${providerLabel}. Nothing is saved until you choose.`}
      icon={<UserSearch className="stroke-[1.75]" />}
      dirty={false}
      pending={pending}
      error={error}
      onClose={close}
      onSave={submit}
      saveLabel={saveLabel}
      pendingLabel={pendingLabel}
      hideCancel={stage === "result" || stage === "empty"}
      wide={stage === "review" || stage === "result"}
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
        {stage === "setup" ? (
          <>
            <h3 ref={stageRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
              Search setup
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-[13.5px]">
              <dt className="text-ink-subtle">Company</dt>
              <dd className="min-w-0 break-words text-ink">{company.name}</dd>
              <dt className="text-ink-subtle">Domain</dt>
              <dd className="min-w-0 break-all text-ink">{company.domain}</dd>
            </dl>
            {icps.length ? (
              <Field label="Ideal customer profile" htmlFor={`${uid}-icp`}>
                <select
                  id={`${uid}-icp`}
                  value={icpId}
                  onChange={(e) => {
                    const next = icps.find((p) => p.id === e.target.value) ?? null;
                    setIcpId(e.target.value);
                    setRoleIds(next ? defaults(next.roles) : []);
                  }}
                  className={inputClass}
                >
                  {icps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {roles.length ? (
              <fieldset>
                <legend className="text-[13.5px] font-medium text-ink">Target roles</legend>
                <p id={`${uid}-roles-hint`} className="mb-2 text-[12.5px] text-ink-subtle">
                  From the profile, for this search only. Up to {MAX_SEARCH_TITLES} roles per search ({roleIds.length} selected).
                </p>
                <ul className="flex flex-col gap-2">
                  {roles.map((r) => {
                    const checked = roleIds.includes(r.id);
                    return (
                      <li key={r.id}>
                        <label className={cx("flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2", checked ? "border-brand bg-brand-tint/60" : "border-line-strong", !checked && atLimit && "cursor-not-allowed opacity-60")}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!checked && atLimit}
                            aria-describedby={`${uid}-roles-hint`}
                            onChange={(e) => setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
                            className="size-[18px] shrink-0 accent-[var(--color-brand)]"
                          />
                          <span className="min-w-0 flex-1 break-words text-[14px] text-ink">{r.title}</span>
                          <StatusPill tone={r.priority === "primary" ? "brand" : r.priority === "secondary" ? "info" : "neutral"} className="h-6 px-2.5 text-[12px]">
                            {PRIORITY_LABEL[r.priority]}
                          </StatusPill>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Field label="Job titles for this search" htmlFor={`${uid}-manual`} hint="One title per line, up to 10. Used for this search only.">
                  <textarea
                    id={`${uid}-manual`}
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    rows={3}
                    maxLength={2200}
                    aria-describedby={`${uid}-manual-hint ${uid}-settings`}
                    className={cx(inputClass, "h-auto py-2.5 leading-6")}
                  />
                </Field>
                <p id={`${uid}-settings`} className="text-[12.5px] text-ink-subtle">
                  {icp ? "This profile has no decision-maker roles. " : ""}
                  <Link href={settingsPath} className="font-medium text-brand hover:underline">
                    Configure decision-maker roles in Settings
                  </Link>{" "}
                  to reuse them automatically.
                </p>
              </div>
            )}
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] text-ink">
              <input type="checkbox" checked={dmOnly} onChange={(e) => setDmOnly(e.target.checked)} aria-describedby={`${uid}-dm-hint`} className="mt-0.5 size-[18px] shrink-0 accent-[var(--color-brand)]" />
              <span>
                Only show {providerLabel}-classified decision makers
                <span id={`${uid}-dm-hint`} className="block text-[12.5px] text-ink-subtle">
                  Off by default: a role from your profile can matter even if {providerLabel} doesn&apos;t classify the person as a decision maker.
                </span>
              </span>
            </label>
            <div className="rounded-md border border-line bg-surface-muted px-3.5 py-2.5 text-[13px] text-ink-muted">
              <p className="font-medium text-ink">{providerLabel} Domain Search</p>
              <p>Up to 10 professional contacts</p>
              <p>Estimated usage: up to {estimateMillis !== null ? formatCredits(estimateMillis) : "1"} credit if results are returned</p>
              <p className="mt-1 text-[12.5px] text-ink-subtle">
                {providerLabel} Domain Search returns up to 10 professional contacts in this search. Your {providerLabel} account is the authoritative balance.
              </p>
            </div>
          </>
        ) : null}

        {stage === "failed" && view ? (
          <>
            <h3 ref={stageRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
              Search setup
            </h3>
            {view.error?.retry ? (
              <Button type="button" className="h-11 self-start sm:h-10" disabled={pending} onClick={() => run("Searching…", "Trying again…", () => retryContactSearch(workspaceId, view.runId))}>
                <RotateCcw aria-hidden className="size-4" />
                Try again
              </Button>
            ) : null}
            <p className="text-[13.5px] text-ink-muted">Nothing was saved. You can try again, or edit the search.</p>
          </>
        ) : null}

        {stage === "empty" && view ? (
          <>
            <h3 ref={stageRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
              No contacts found
            </h3>
            <p className="text-[14px] text-ink-muted">
              {view.providerLabel} returned no professional contacts for {view.domain} with these criteria. No further search runs on its own; each one is
              your choice.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" className="h-11 sm:h-10" onClick={() => editSearch()}>
                Edit target roles
              </Button>
              {!view.decisionMakerOnly ? (
                <Button type="button" className="h-11 sm:h-10" onClick={() => editSearch(true)}>
                  Search only {view.providerLabel}-classified decision makers
                </Button>
              ) : null}
            </div>
            <p className="text-[12.5px] text-ink-subtle">You can also try again later. Estimated credits used: {formatCredits(view.creditsUsedMillis)}</p>
          </>
        ) : null}

        {stage === "review" && view ? (
          <>
            <h3 ref={stageRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
              Review contacts
            </h3>
            <p className="text-[13.5px] text-ink-muted">
              {view.candidates.length} professional contact{view.candidates.length === 1 ? "" : "s"} at {view.domain}
              {view.titles.length ? ` · roles: ${view.titles.map((t) => t.title).join(", ")}` : ""}
              {view.decisionMakerOnly ? ` · ${view.providerLabel}-classified decision makers only` : ""}. Ordered by role match. Select the people to add.
            </p>
            {view.skipped ? <p className="text-[12.5px] text-ink-subtle">{view.skipped} result{view.skipped === 1 ? " was" : "s were"} not shown (no name or no usable email).</p> : null}
            <CandidateTable view={view} busyId={busyId} pending={pending} onDecide={decide} />
            <p className="text-[12.5px] text-ink-subtle">
              Email status and confidence come from {view.providerLabel} and describe the email address, not the role fit. Estimated credits used: {formatCredits(view.creditsUsedMillis)}
            </p>
          </>
        ) : null}

        {stage === "result" && view?.outcome ? (
          <>
            <h3 ref={stageRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
              Contacts saved
            </h3>
            <ul className="flex flex-col gap-2 text-[14px] text-ink">
              <li className="flex items-start gap-2">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                {view.outcome.created} new contact{view.outcome.created === 1 ? "" : "s"} added to {company.name}.
              </li>
              {view.outcome.merged ? (
                <li className="flex items-start gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                  {view.outcome.merged} existing contact{view.outcome.merged === 1 ? "" : "s"} updated (empty fields only).
                </li>
              ) : null}
              <li className="flex items-start gap-2">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                {view.providerLabel} evidence added ({view.outcome.evidenceAdded} field{view.outcome.evidenceAdded === 1 ? "" : "s"}).
              </li>
              <li className="text-ink-muted">Estimated {view.providerLabel} credits used: {formatCredits(view.creditsUsedMillis)}</li>
            </ul>
            {view.outcome.notes.length ? (
              <div>
                <p className="text-[13.5px] font-medium text-ink">Kept existing values</p>
                <ul className="mt-1 flex flex-col gap-1 text-[13px] text-ink-muted">
                  {view.outcome.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-[12.5px] text-ink-subtle">Saved contacts appear in the company&apos;s Contacts. No outreach happens automatically; restrictions still apply.</p>
          </>
        ) : null}
      </div>
    </ConfigSheet>
  );
}

// -----------------------------------------------------------------------------

function existingText(c: ContactCandidateView): string {
  switch (c.matchState) {
    case "existing_contact":
      return `Existing contact${c.matched ? `: ${c.matched.name}` : ""}`;
    case "possible_duplicate":
      return `Possible duplicate of ${c.matched?.name ?? "a contact here"}`;
    case "conflict":
      return `Contact already belongs to another company${c.matched?.companyName ? ` (${c.matched.companyName})` : ""}`;
    default:
      return "New";
  }
}

function Existing({ c }: { c: ContactCandidateView }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-[13px] text-ink-muted">{existingText(c)}</span>
      {c.matched?.restricted ? <StatusPill tone="danger" className="h-6 px-2.5 text-[12px]">Restricted</StatusPill> : null}
    </div>
  );
}

function Labels({ c }: { c: ContactCandidateView }) {
  return (
    <div className="flex flex-wrap gap-1">
      {c.labels.map((l, i) => (
        <StatusPill key={l} tone={i === 0 ? ROLE_TONE[c.roleMatch] : "neutral"} className="h-6 px-2.5 text-[12px]">
          {l}
        </StatusPill>
      ))}
    </div>
  );
}

function EmailStatus({ c }: { c: ContactCandidateView }) {
  return <span className="text-[13px] text-ink">{c.verificationStatus ? VERIFICATION_LABEL[c.verificationStatus] : "Not provided"}</span>;
}

function Confidence({ c }: { c: ContactCandidateView }) {
  return <span className="text-[13px] tabular-nums text-ink">{c.confidence !== null ? `Confidence ${c.confidence}` : "—"}</span>;
}

function Decision({ c, busy, onDecide }: { c: ContactCandidateView; busy: boolean; onDecide: (c: ContactCandidateView, a: CandidateAction) => void }) {
  const who = <span className="sr-only"> {c.fullName}</span>;
  if (c.commitResult) {
    return <StatusPill tone="brand" className="h-6 px-2.5 text-[12px]">{c.commitResult === "created" ? "Saved" : "Updated"}</StatusPill>;
  }
  if (c.decision !== "unreviewed") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={c.decision === "selected" ? "brand" : "neutral"} className="h-6 px-2.5 text-[12px]">
          {c.decision === "dismissed" ? "Dismissed" : c.selectedAction === "merge" ? `Selected · add to ${c.matched?.name ?? "existing"}` : "Selected"}
        </StatusPill>
        <Button type="button" variant="ghost" className="h-11 px-2 text-[13px] lg:h-8" disabled={busy} onClick={() => onDecide(c, "reset")}>
          Undo{who}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Decision for ${c.fullName}`}>
      {c.matchState === "new" || c.matchState === "existing_contact" ? (
        <Button type="button" variant="soft" className="h-11 lg:h-8" disabled={busy} onClick={() => onDecide(c, "select")}>
          <Check aria-hidden className="size-4" />
          Select{who}
        </Button>
      ) : null}
      {c.matchState === "possible_duplicate" ? (
        <>
          <Button type="button" variant="soft" className="h-11 lg:h-8" disabled={busy} onClick={() => onDecide(c, "select_merge")}>
            Same person{who}
          </Button>
          <Button type="button" className="h-11 lg:h-8" disabled={busy} onClick={() => onDecide(c, "select_new")}>
            Add as new{who}
          </Button>
        </>
      ) : null}
      <Button type="button" className="h-11 lg:h-8" disabled={busy} onClick={() => onDecide(c, "dismiss")}>
        <X aria-hidden className="size-4" />
        Dismiss{who}
      </Button>
    </div>
  );
}

function CandidateTable({
  view,
  busyId,
  pending,
  onDecide,
}: {
  view: ContactSearchView;
  busyId: string | null;
  pending: boolean;
  onDecide: (c: ContactCandidateView, a: CandidateAction) => void;
}) {
  return (
    <>
      <div className="hidden lg:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">Professional contacts found by this search</caption>
          <thead>
            <tr className="border-b border-line text-[12.5px] text-ink-subtle">
              <th scope="col" className="w-[13%] py-2 pr-2 font-medium">Name</th>
              <th scope="col" className="w-[13%] px-2 py-2 font-medium">Role</th>
              <th scope="col" className="w-[17%] px-2 py-2 font-medium">Role match</th>
              <th scope="col" className="w-[17%] px-2 py-2 font-medium">Professional email</th>
              <th scope="col" className="w-[8%] px-2 py-2 font-medium">Email status</th>
              <th scope="col" className="w-[9%] px-2 py-2 font-medium">{view.providerLabel} confidence</th>
              <th scope="col" className="w-[11%] px-2 py-2 font-medium">Existing status</th>
              <th scope="col" className="px-2 py-2 font-medium">Decision</th>
            </tr>
          </thead>
          <tbody>
            {view.candidates.map((c) => (
              <tr key={c.id} data-candidate={c.email} className="border-b border-line align-top last:border-b-0">
                <td className="break-words py-2.5 pr-2 text-[14px] font-medium text-ink">{c.fullName}</td>
                <td className="break-words px-2 py-2.5 text-[13px] text-ink-muted">
                  {c.jobTitle ?? "—"}
                  {c.department ? <span className="block text-[12px] text-ink-subtle">{c.department.replace(/_/g, " ")}</span> : null}
                </td>
                <td className="px-2 py-2.5"><Labels c={c} /></td>
                <td className="break-all px-2 py-2.5 text-[13px] text-ink">
                  {c.email}
                  {c.phone ? <span className="block break-words text-[12px] text-ink-subtle">{c.phone}</span> : null}
                </td>
                <td className="px-2 py-2.5"><EmailStatus c={c} /></td>
                <td className="px-2 py-2.5"><Confidence c={c} /></td>
                <td className="px-2 py-2.5"><Existing c={c} /></td>
                <td className="px-2 py-2.5"><Decision c={c} busy={busyId === c.id || pending} onDecide={onDecide} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label="Professional contacts found by this search" className="flex flex-col divide-y divide-line rounded-lg border border-line lg:hidden">
        {view.candidates.map((c) => (
          <li key={c.id} data-candidate={c.email} className="flex flex-col gap-2 px-3.5 py-3">
            <div>
              <p className="text-[15px] font-semibold text-ink">{c.fullName}</p>
              {c.jobTitle ? <p className="text-[13px] text-ink-muted">{c.jobTitle}</p> : null}
            </div>
            <Labels c={c} />
            <p className="break-all text-[13.5px] text-ink">{c.email}</p>
            <p className="text-[13px] text-ink-muted">
              Email status: <EmailStatus c={c} /> · <Confidence c={c} />
            </p>
            {c.phone ? <p className="text-[13px] text-ink-muted">Phone: {c.phone}</p> : null}
            <Existing c={c} />
            <Decision c={c} busy={busyId === c.id || pending} onDecide={onDecide} />
          </li>
        ))}
      </ul>
    </>
  );
}
