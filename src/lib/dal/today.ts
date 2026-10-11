import "server-only";

import { DISPOSITION_LABEL, TASK_KIND_LABEL } from "@/lib/contact-workflow/dispositions";
import { TASK_BLOCKER_LABEL } from "@/lib/contact-workflow/eligibility";
import { buildDueQueue, buildReadyQueue, DUE_STATE_LABEL, READY_LIMIT, type DueItem } from "@/lib/contact-workflow/queue";
import { dayBounds, formatWhen, timeZoneLabel, utcToLocalInput } from "@/lib/contact-workflow/time";
import { DISPOSITIONS, TASK_KINDS, type ContactFacts, type Disposition, type DueTaskFacts, type ReadyCandidate, type TaskKind } from "@/lib/contact-workflow/types";
import type { DueRowView, TodayView } from "@/lib/contact-workflow/view";
import { formatLocation } from "@/lib/lead-core/display";
import { GRADES, locationSchema, QUALIFICATION_STATES, type Grade, type QualificationState } from "@/lib/lead-core/schemas";
import type { TodayDueTaskRow, TodayReadyCandidateRow } from "@/lib/supabase/app-types";
import type { Json } from "@/lib/supabase/database.types";
import { DataAccessError, requireUser, supabase } from "./core";
import { listIcpProfilesForDiscovery } from "./discovery";

/**
 * Today (P1-E7): the workspace's operational queue, built from real data.
 *
 *  - "Today" is the calendar day in the WORKSPACE time zone; its bounds are
 *    computed here and passed to the database as UTC instants.
 *  - Ready to contact: public.today_ready_candidates returns current A/B
 *    companies (default ICP) with contact facts; the pure workflow module
 *    decides eligibility, the recommended contact and the order.
 *  - Due work: open tasks due before the end of today (public.today_due_tasks),
 *    classified Overdue / Due now / Later today; blocked ones go to Needs attention.
 *  - Contacted today: attempts whose attempted_at falls inside today.
 *
 * Reads are bounded (ready candidates ≤ 2,000 companies, due tasks ≤ 200,
 * rows shown ≤ 25). Nothing here scores, calls a provider or writes.
 */

const DUE_LIMIT = 200;
const ACTIVITY_ROWS = 25;

const asGrade = (v: string | null): Grade | null => ((GRADES as readonly string[]).includes(v ?? "") ? (v as Grade) : null);
const asQualification = (v: string): QualificationState => ((QUALIFICATION_STATES as readonly string[]).includes(v) ? (v as QualificationState) : "needs_review");
const asDisposition = (v: unknown): Disposition => ((DISPOSITIONS as readonly unknown[]).includes(v) ? (v as Disposition) : "other");
const asKind = (v: string): TaskKind => ((TASK_KINDS as readonly string[]).includes(v) ? (v as TaskKind) : "follow_up");
const asStatus = (v: unknown): ContactFacts["status"] => (v === "left_company" ? "left_company" : v === "active" ? "active" : "unknown");
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function parseContacts(value: Json): ContactFacts[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.full_name !== "string") return [];
    const latest = (o.latest_attempt ?? null) as Record<string, unknown> | null;
    return [
      {
        id: o.id,
        fullName: o.full_name,
        jobTitle: str(o.job_title),
        phone: str(o.phone),
        isPrimary: o.is_primary === true,
        status: asStatus(o.status),
        restricted: o.restricted === true,
        openTaskDueAt: str(o.open_task_due_at),
        latestAttempt: latest && typeof latest.attempted_at === "string" ? { disposition: asDisposition(latest.disposition), attemptedAt: latest.attempted_at } : null,
      },
    ];
  });
}

function parseLastAttempt(value: Json | null): ReadyCandidate["lastAttempt"] {
  const o = (value ?? null) as Record<string, unknown> | null;
  if (!o || typeof o.attempted_at !== "string") return null;
  return { disposition: asDisposition(o.disposition), attemptedAt: o.attempted_at, contactName: str(o.contact_name) ?? "" };
}

function location(value: Json | null): string | null {
  const parsed = value ? locationSchema.safeParse(value) : null;
  return parsed?.success ? formatLocation(parsed.data) : null;
}

/** Counts of default-ICP score states (via list_companies' total). */
async function scoreStateCount(workspaceId: string, state: "outdated" | "none"): Promise<number> {
  const { data, error } = await (await supabase()).rpc("list_companies", { p_workspace_id: workspaceId, p_grade: state, p_limit: 1, p_offset: 0 });
  if (error) throw new DataAccessError("scoreStateCount", error);
  return Number(data?.[0]?.total_count ?? 0);
}

export async function getTodayView(workspace: { id: string; timezone: string }, now: Date = new Date()): Promise<TodayView> {
  const user = await requireUser();
  const client = await supabase();
  const tz = workspace.timezone;
  const { start, end } = dayBounds(now, tz);

  const profiles = await listIcpProfilesForDiscovery(workspace.id);
  const defaultProfile = profiles.find((p) => p.isDefault) ?? null;

  const [candidates, due, attempts, outdated, unscored] = await Promise.all([
    defaultProfile ? client.rpc("today_ready_candidates", { p_workspace_id: workspace.id, p_limit: 2000 }) : Promise.resolve({ data: [], error: null }),
    client.rpc("today_due_tasks", { p_workspace_id: workspace.id, p_until: end.toISOString(), p_limit: DUE_LIMIT }),
    client
      .from("contact_attempts")
      .select("id, company_id, contact_id, disposition, note, attempted_at, created_by", { count: "exact" })
      .eq("workspace_id", workspace.id)
      .gte("attempted_at", start.toISOString())
      .lt("attempted_at", end.toISOString())
      .order("attempted_at", { ascending: false })
      .limit(ACTIVITY_ROWS),
    defaultProfile ? scoreStateCount(workspace.id, "outdated") : Promise.resolve(0),
    defaultProfile ? scoreStateCount(workspace.id, "none") : Promise.resolve(0),
  ]);
  if (candidates.error) throw new DataAccessError("today.ready", candidates.error);
  if (due.error) throw new DataAccessError("today.due", due.error);
  if (attempts.error) throw new DataAccessError("today.attempts", attempts.error);

  // Ready to contact
  const readyRows: TodayReadyCandidateRow[] = candidates.data ?? [];
  const ready = buildReadyQueue(
    readyRows.map((r) => ({
      companyId: r.company_id,
      name: r.canonical_name,
      location: location(r.location),
      qualification: asQualification(r.qualification_state),
      restricted: r.company_restricted,
      scoreState: "current" as const,
      grade: asGrade(r.grade),
      score: r.score,
      coveragePercent: r.coverage_percent,
      contacts: parseContacts(r.contacts),
      lastAttempt: parseLastAttempt(r.last_attempt),
    })),
    defaultProfile?.decisionMakers ?? [],
    start,
    READY_LIMIT,
  );

  // Due work
  const dueRows: TodayDueTaskRow[] = due.data ?? [];
  const queues = buildDueQueue(
    dueRows.map(
      (r): DueTaskFacts => ({
        id: r.id,
        kind: asKind(r.kind),
        dueAt: r.due_at,
        note: r.note,
        companyId: r.company_id,
        companyName: r.company_name,
        companyArchived: r.company_archived,
        companyRestricted: r.company_restricted,
        contactId: r.contact_id,
        contactName: r.contact_name,
        jobTitle: r.job_title,
        phone: r.phone,
        contactStatus: asStatus(r.contact_status),
        contactArchived: r.contact_archived,
        contactRestricted: r.contact_restricted,
      }),
    ),
    now,
    start,
  );
  const dueView = (t: DueItem): DueRowView => ({
    taskId: t.id,
    kind: t.kind,
    kindLabel: TASK_KIND_LABEL[t.kind],
    dueLabel: formatWhen(t.dueAt, now, tz),
    ...utcToLocalInput(t.dueAt, tz),
    state: t.state,
    stateLabel: DUE_STATE_LABEL[t.state],
    companyId: t.companyId,
    companyName: t.companyName,
    contactId: t.contactId,
    contactName: t.contactName,
    jobTitle: t.jobTitle,
    phone: t.phone,
    note: t.note,
    blocker: t.blocker ? TASK_BLOCKER_LABEL[t.blocker] : null,
  });

  // Contacted today (names for the shown rows)
  const shown = attempts.data ?? [];
  const [people, companies] = await Promise.all([
    shown.length
      ? client.from("contacts").select("id, full_name").eq("workspace_id", workspace.id).in("id", [...new Set(shown.map((a) => a.contact_id))])
      : Promise.resolve({ data: [], error: null }),
    shown.length
      ? client.from("companies").select("id, canonical_name").eq("workspace_id", workspace.id).in("id", [...new Set(shown.map((a) => a.company_id))])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (people.error) throw new DataAccessError("today.people", people.error);
  if (companies.error) throw new DataAccessError("today.companies", companies.error);
  const personName = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.canonical_name]));
  const contactedToday = attempts.count ?? shown.length;

  return {
    timezone: tz,
    timezoneLabel: timeZoneLabel(tz, now),
    state: defaultProfile ? "ok" : "no_default_icp",
    summary: { ready: ready.total, callbacks: queues.callbacks.length, followUps: queues.followUps.length, contactedToday },
    ready: {
      total: ready.total,
      rows: ready.items.map(({ candidate: c, contact: p }) => ({
        companyId: c.companyId,
        companyName: c.name,
        location: c.location,
        grade: c.grade as Grade,
        score: c.score ?? 0,
        contactId: p.id,
        contactName: p.fullName,
        jobTitle: p.jobTitle,
        phone: p.phone ?? "",
        lastContact: c.lastAttempt ? `${formatWhen(c.lastAttempt.attemptedAt, now, tz)} · ${DISPOSITION_LABEL[c.lastAttempt.disposition]}` : "Never contacted",
      })),
    },
    callbacks: queues.callbacks.map(dueView),
    followUps: queues.followUps.map(dueView),
    blocked: queues.blocked.map(dueView),
    contactedToday: {
      total: contactedToday,
      rows: shown.map((a) => ({
        id: a.id,
        when: formatWhen(a.attempted_at, now, tz),
        companyId: a.company_id,
        companyName: companyName.get(a.company_id) ?? "Company",
        contactName: personName.get(a.contact_id) ?? "Contact",
        disposition: DISPOSITION_LABEL[asDisposition(a.disposition)],
        note: a.note,
        by: a.created_by === user.id ? "by you" : "by a teammate",
      })),
    },
    attention: { outdated, unscored, needsCallableContact: ready.needsCallableContact, blocked: queues.blocked.length },
    truncated: dueRows.length >= DUE_LIMIT,
  };
}
