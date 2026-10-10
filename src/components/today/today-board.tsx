"use client";

import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { refreshLeadScores } from "@/app/w/[workspaceId]/today/actions";
import { FitScore, LeadGradeBadge } from "@/components/leads/lead-ui";
import { Button, buttonClass, cx, StatusPill } from "@/components/ui/primitives";
import { StartContactButton } from "@/components/workflow/contact-sheet";
import { TaskActions, type TimeContext } from "@/components/workflow/task-controls";
import type { AttemptRowView, DueRowView, ReadyRowView, TodayView } from "@/lib/contact-workflow/view";
import { TodayQueue, type QueueTabSpec } from "./today-queue";

/**
 * Today's work (P1-E7), inside the canonical queue panel: Lead Queue (ready
 * to contact), Callbacks, Follow-ups and Contacted today. Data comes from the
 * server view model; every action re-checks on the server.
 */

type Tab = "queue" | "callbacks" | "followUps" | "contacted";

export function TodayBoard({ view, workspaceId, leadsPath, settingsPath, time }: { view: TodayView; workspaceId: string; leadsPath: string; settingsPath: string; time: TimeContext }) {
  const companyHref = (id: string) => `${leadsPath}?company=${id}`;
  const nothingLeft = view.ready.total === 0 && view.callbacks.length === 0 && view.followUps.length === 0;

  const tabs: QueueTabSpec<Tab>[] = [
    view.state === "no_default_icp"
      ? {
          key: "queue",
          label: "Lead Queue",
          emptyTitle: "Set a default ICP to build your Today queue",
          emptyBody: "Ready-to-contact prospects come from current A and B grades against the workspace's default ideal customer profile.",
          emptyAction: (
            <Link href={settingsPath} className={buttonClass("secondary", "h-11 sm:h-10")}>
              Open Settings
            </Link>
          ),
        }
      : nothingLeft && view.summary.contactedToday > 0
        ? {
            key: "queue",
            label: "Lead Queue",
            emptyTitle: "Today's work is done",
            emptyBody: `${view.summary.contactedToday} contact ${view.summary.contactedToday === 1 ? "attempt" : "attempts"} recorded today. New work appears here when tasks come due or leads become ready.`,
          }
        : view.attention.unscored > 0 || view.attention.outdated > 0
          ? {
              key: "queue",
              label: "Lead Queue",
              emptyTitle: "Evaluate leads to create your daily queue",
              emptyBody: "Only companies with a current A or B grade and a callable contact appear here. Refresh lead scores to evaluate unscored and outdated leads.",
            }
          : {
              key: "queue",
              label: "Lead Queue",
              emptyTitle: "No prospects are ready to contact right now",
              emptyBody: "Companies with a current A or B grade, a qualifying status and a callable contact will appear here.",
            },
    { key: "callbacks", label: "Callbacks", emptyTitle: "No callbacks due", emptyBody: "Callbacks requested by contacts appear here on the day they are due." },
    { key: "followUps", label: "Follow-ups", emptyTitle: "No follow-ups due", emptyBody: "Follow-ups and retry calls you schedule appear here on the day they are due." },
    { key: "contacted", label: "Contacted today", emptyTitle: "No contact attempts yet today", emptyBody: "Outcomes you log after a call are listed here." },
  ];

  const initial: Tab = view.callbacks.some((t) => t.state !== "later_today")
    ? "callbacks"
    : view.followUps.some((t) => t.state !== "later_today")
      ? "followUps"
      : "queue";

  return (
    <TodayQueue<Tab>
      tabs={tabs}
      initialTab={initial}
      showTabsOnMobile
      counts={{ queue: view.ready.total, callbacks: view.callbacks.length, followUps: view.followUps.length, contacted: view.contactedToday.total }}
      content={{
        queue: view.ready.rows.length ? <ReadyTable rows={view.ready.rows} total={view.ready.total} workspaceId={workspaceId} leadsPath={leadsPath} companyHref={companyHref} /> : undefined,
        callbacks: view.callbacks.length ? <DueList rows={view.callbacks} label="Callbacks due" workspaceId={workspaceId} companyHref={companyHref} time={time} /> : undefined,
        followUps: view.followUps.length ? <DueList rows={view.followUps} label="Follow-ups due" workspaceId={workspaceId} companyHref={companyHref} time={time} /> : undefined,
        contacted: view.contactedToday.rows.length ? <ContactedList rows={view.contactedToday.rows} total={view.contactedToday.total} companyHref={companyHref} /> : undefined,
      }}
    />
  );
}

// -----------------------------------------------------------------------------
// Ready to contact (canonical lead table language)
// -----------------------------------------------------------------------------

function ReadyTable({ rows, total, workspaceId, leadsPath, companyHref }: { rows: ReadyRowView[]; total: number; workspaceId: string; leadsPath: string; companyHref: (id: string) => string }) {
  return (
    <div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <caption className="sr-only">Ready to contact, best fit first</caption>
          <thead>
            <tr className="border-b border-line text-[13px] font-medium text-ink-subtle">
              <th scope="col" className="w-16 py-3 pl-5 pr-2 font-medium">Grade</th>
              <th scope="col" className="px-2 py-3 font-medium">Company</th>
              <th scope="col" className="px-2 py-3 font-medium">Contact</th>
              <th scope="col" className="w-16 px-2 py-3 font-medium">Fit</th>
              <th scope="col" className="px-2 py-3 font-medium">Last contact</th>
              <th scope="col" className="w-32 py-3 pl-2 pr-5 font-medium">Next Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.companyId} className="border-b border-line last:border-b-0">
                <td className="py-3 pl-5 pr-2">
                  <LeadGradeBadge grade={r.grade} />
                </td>
                <th scope="row" className="px-2 py-3 text-left font-normal">
                  <Link href={companyHref(r.companyId)} className="text-[14.5px] font-semibold text-ink hover:underline">
                    {r.companyName}
                  </Link>
                  {r.location ? <div className="text-[13px] text-ink-subtle">{r.location}</div> : null}
                </th>
                <td className="px-2 py-3">
                  <div className="text-[14.5px] text-ink">{r.contactName}</div>
                  <div className="text-[13px] text-ink-subtle">{[r.jobTitle, r.phone].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="px-2 py-3">
                  <FitScore score={r.score} />
                </td>
                <td className="px-2 py-3 text-[13.5px] text-ink-muted">{r.lastContact}</td>
                <td className="py-3 pl-2 pr-5">
                  <StartContactButton
                    workspaceId={workspaceId}
                    companyId={r.companyId}
                    contactId={r.contactId}
                    accessibleLabel={`Call ${r.contactName} at ${r.companyName}`}
                    className="w-[88px]"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label="Ready to contact" className="divide-y divide-line md:hidden">
        {rows.map((r) => (
          <li key={r.companyId} className="flex gap-3 px-4 py-3.5">
            <LeadGradeBadge grade={r.grade} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={companyHref(r.companyId)} className="block truncate text-[15px] font-semibold text-ink hover:underline">
                    {r.companyName}
                  </Link>
                  <div className="truncate text-[13px] text-ink-subtle">
                    {r.contactName}
                    {r.jobTitle ? ` · ${r.jobTitle}` : ""}
                  </div>
                </div>
                <FitScore score={r.score} size={34} />
              </div>
              <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="mt-1 inline-flex min-h-8 items-center text-[13.5px] text-brand hover:underline">
                {r.phone}
                <span className="sr-only"> (opens your phone app; nothing is recorded)</span>
              </a>
              <div className="text-[12.5px] text-ink-subtle">{r.lastContact}</div>
            </div>
            <StartContactButton
              workspaceId={workspaceId}
              companyId={r.companyId}
              contactId={r.contactId}
              accessibleLabel={`Call ${r.contactName} at ${r.companyName}`}
              iconOnly
              className="self-center"
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5 text-[13px] text-ink-subtle">
        <span>
          Showing {rows.length} of {total} {total === 1 ? "lead" : "leads"}
        </span>
        <Link href={`${leadsPath}?sort=grade`} className="inline-flex min-h-8 items-center gap-1.5 font-medium text-brand hover:underline">
          View all Leads
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Due work
// -----------------------------------------------------------------------------

const STATE_TONE = { overdue: "danger", due_now: "warning", later_today: "neutral" } as const;

function DueList({ rows, label, workspaceId, companyHref, time }: { rows: DueRowView[]; label: string; workspaceId: string; companyHref: (id: string) => string; time: TimeContext }) {
  return (
    <ul aria-label={label} className="divide-y divide-line">
      {rows.map((t) => (
        <li key={t.taskId} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={STATE_TONE[t.state]} className="h-6 px-2.5 text-[12px]">
                {t.stateLabel}
              </StatusPill>
              <span className="text-[13.5px] font-medium text-ink">
                {t.kindLabel} · {t.dueLabel}
              </span>
            </div>
            <div className="mt-1 text-[14.5px] text-ink">
              <Link href={companyHref(t.companyId)} className="font-semibold hover:underline">
                {t.companyName}
              </Link>
              <span className="text-ink-muted"> · {t.contactName}</span>
              {t.jobTitle ? <span className="text-ink-subtle"> · {t.jobTitle}</span> : null}
            </div>
            {t.phone ? (
              <a href={`tel:${t.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-8 items-center text-[13.5px] text-brand hover:underline">
                {t.phone}
                <span className="sr-only"> (opens your phone app; nothing is recorded)</span>
              </a>
            ) : null}
            {t.note ? <p className="line-clamp-2 text-[13px] text-ink-subtle">{t.note}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <StartContactButton
              workspaceId={workspaceId}
              companyId={t.companyId}
              contactId={t.contactId}
              taskId={t.taskId}
              accessibleLabel={`Call ${t.contactName} for this ${t.kindLabel.toLowerCase()}`}
            />
            <TaskActions
              workspaceId={workspaceId}
              time={time}
              task={{ id: t.taskId, kindLabel: t.kindLabel, contactName: t.contactName, dueLabel: t.dueLabel, date: t.date, time: t.time }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ContactedList({ rows, total, companyHref }: { rows: AttemptRowView[]; total: number; companyHref: (id: string) => string }) {
  return (
    <div>
      <ul aria-label="Contacted today" className="divide-y divide-line">
        {rows.map((a) => (
          <li key={a.id} className="px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
              <span className="text-ink-subtle">{a.when}</span>
              <span className="font-medium text-ink">{a.contactName}</span>
              <Link href={companyHref(a.companyId)} className="text-ink-muted hover:underline">
                {a.companyName}
              </Link>
              <StatusPill className="h-6 px-2.5 text-[12px]">{a.disposition}</StatusPill>
              <span className="text-[12.5px] text-ink-subtle">{a.by}</span>
            </div>
            {a.note ? <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-muted">{a.note}</p> : null}
          </li>
        ))}
      </ul>
      {total > rows.length ? <p className="border-t border-line px-5 py-3 text-[13px] text-ink-subtle">Showing the {rows.length} most recent of {total} attempts today.</p> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Needs attention + Refresh lead scores
// -----------------------------------------------------------------------------

export function NeedsAttention({ view, workspaceId, leadsPath, time }: { view: TodayView; workspaceId: string; leadsPath: string; time: TimeContext }) {
  const a = view.attention;
  if (!a.outdated && !a.needsCallableContact.length && !a.blocked) return null;
  return (
    <section aria-labelledby="attention-title" className="rounded-xl border border-line bg-surface px-4 py-4 shadow-card sm:px-5">
      <h2 id="attention-title" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <AlertTriangle aria-hidden className="size-4 text-warning" />
        Needs attention
      </h2>
      <ul className="mt-2.5 flex flex-col gap-2 text-[14px]">
        {a.outdated ? (
          <li className="flex flex-wrap items-center gap-x-2">
            <span className="text-ink">
              {a.outdated} outdated {a.outdated === 1 ? "score" : "scores"}
            </span>
            <span className="text-ink-subtle">— not used for Today until re-evaluated.</span>
            <Link href={`${leadsPath}?grade=outdated`} className="inline-flex min-h-8 items-center font-medium text-brand hover:underline">
              Review in Leads
            </Link>
          </li>
        ) : null}
        {a.needsCallableContact.length ? (
          <li>
            <span className="text-ink">
              {a.needsCallableContact.length} A/B {a.needsCallableContact.length === 1 ? "company needs" : "companies need"} a callable contact
            </span>
            <span className="text-ink-subtle"> — add a contact with a phone number or find decision makers: </span>
            {a.needsCallableContact.slice(0, 3).map((c, i) => (
              <span key={c.companyId}>
                {i ? ", " : ""}
                <Link href={`${leadsPath}?company=${c.companyId}`} className="font-medium text-brand hover:underline">
                  {c.name}
                </Link>
              </span>
            ))}
            {a.needsCallableContact.length > 3 ? <span className="text-ink-subtle"> and {a.needsCallableContact.length - 3} more</span> : null}
          </li>
        ) : null}
        {view.blocked.map((t) => (
          <li key={t.taskId} className="flex flex-col gap-2 rounded-md border border-line bg-surface-muted px-3 py-2.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <span className="font-medium text-ink">Blocked {t.kindLabel.toLowerCase()}</span>
              <span className="text-ink-muted">
                {" "}
                · {t.contactName} at{" "}
                <Link href={`${leadsPath}?company=${t.companyId}`} className="text-brand hover:underline">
                  {t.companyName}
                </Link>{" "}
                · {t.dueLabel}
              </span>
              <p className="text-[13px] text-ink-subtle">Reason: {t.blocker}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <TaskActions
                workspaceId={workspaceId}
                time={time}
                canReschedule={false}
                canComplete={false}
                task={{ id: t.taskId, kindLabel: t.kindLabel, contactName: t.contactName, dueLabel: t.dueLabel, date: t.date, time: t.time }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RefreshScoresButton({ workspaceId, pendingCount }: { workspaceId: string; pendingCount: number }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof refreshLeadScores>> | null>(null);
  const run = async () => {
    setPending(true);
    try {
      setResult(await refreshLeadScores(workspaceId));
    } catch {
      setResult({ ok: false, error: "Lead scores couldn't be refreshed. Try again." });
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="button" className="h-11 sm:h-10" onClick={run} disabled={pending} aria-describedby="refresh-scores-hint">
        <RefreshCw aria-hidden className={cx("size-4", pending && "animate-spin")} />
        {pending ? "Evaluating…" : "Refresh lead scores"}
      </Button>
      <div role="status" aria-live="polite" id="refresh-scores-hint" className="text-[12.5px] text-ink-subtle sm:text-right">
        {result?.ok ? (
          <>
            <span className="font-medium text-ink">Evaluated {result.evaluated}</span> · A: {result.grades.A} · B: {result.grades.B} · C: {result.grades.C} · Excluded: {result.grades.excluded}
            {result.skipped ? ` · ${result.skipped} changed meanwhile` : ""}
            {result.remaining ? (
              <span className="block">
                {result.remaining} more {result.remaining === 1 ? "lead needs" : "leads need"} evaluation.
              </span>
            ) : null}
          </>
        ) : result && !result.ok ? (
          <span className="text-danger">{result.error}</span>
        ) : pendingCount ? (
          `${pendingCount} ${pendingCount === 1 ? "lead needs" : "leads need"} evaluation (up to 50 per refresh).`
        ) : (
          "All leads are evaluated against the default ICP."
        )}
      </div>
    </div>
  );
}
