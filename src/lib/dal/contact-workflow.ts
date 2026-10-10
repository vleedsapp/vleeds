import "server-only";

import { DISPOSITION_LABEL, TASK_KIND_LABEL } from "@/lib/contact-workflow/dispositions";
import { TASK_BLOCKER_LABEL, taskBlocker } from "@/lib/contact-workflow/eligibility";
import { classifyDue, DUE_STATE_LABEL } from "@/lib/contact-workflow/queue";
import { dayBounds, formatWhen, timeZoneLabel, utcToLocalInput } from "@/lib/contact-workflow/time";
import { DISPOSITIONS, TASK_KINDS, type Disposition, type SuppressionScope, type TaskKind } from "@/lib/contact-workflow/types";
import { isUuid } from "@/lib/navigation";
import { DataAccessError, requireUser, supabase } from "./core";

/**
 * Contact workflow data access (P1-E7). Every write is one database function
 * (record_contact_attempt, schedule/reschedule/complete/cancel_follow_up)
 * that acts as the signed-in user, re-checks membership, relationships,
 * restrictions and task state, and runs in one transaction. Attempts and
 * tasks are read-only tables for the API role.
 */

const asDisposition = (v: string): Disposition => ((DISPOSITIONS as readonly string[]).includes(v) ? (v as Disposition) : "other");
const asKind = (v: string): TaskKind => ((TASK_KINDS as readonly string[]).includes(v) ? (v as TaskKind) : "follow_up");

export type WorkflowFailure = "unavailable" | "restricted" | "not_contactable" | "task_closed" | "task_exists" | "invalid" | "conflict" | "failed";

function failure(operation: string, error: { code?: string; message?: string }): { reason: WorkflowFailure; detail: string | null } {
  switch (error.code) {
    case "42501":
      return { reason: "unavailable", detail: null };
    case "VL001":
      return { reason: "restricted", detail: error.message ?? null };
    case "VL002":
      return { reason: "not_contactable", detail: error.message ?? null };
    case "VL003":
      return { reason: "task_closed", detail: null };
    case "VL004":
      return { reason: "task_exists", detail: null };
    case "22023":
    case "23514":
      return { reason: "invalid", detail: null };
    case "23505":
      return { reason: "conflict", detail: null };
    default:
      console.error(`${operation} failed`, { code: error.code ?? "unknown" });
      return { reason: "failed", detail: null };
  }
}

export type WorkflowMutation<T> = { ok: true; data: T } | { ok: false; reason: WorkflowFailure; detail: string | null };

export async function recordContactAttempt(
  workspaceId: string,
  a: {
    companyId: string;
    contactId: string;
    requestId: string;
    sourceTaskId: string | null;
    disposition: Disposition;
    note: string | null;
    next: { kind: TaskKind; dueAt: Date; note: string | null } | null;
    scope: SuppressionScope | null;
    reason: string | null;
  },
): Promise<WorkflowMutation<{ attemptId: string; taskId: string | null; replayed: boolean }>> {
  await requireUser();
  const { data, error } = await (await supabase()).rpc("record_contact_attempt", {
    p_workspace_id: workspaceId,
    p_company_id: a.companyId,
    p_contact_id: a.contactId,
    p_request_id: a.requestId,
    p_disposition: a.disposition,
    p_note: a.note,
    p_source_task_id: a.sourceTaskId,
    p_next_kind: a.next?.kind ?? null,
    p_next_due_at: a.next ? a.next.dueAt.toISOString() : null,
    p_next_note: a.next?.note ?? null,
    p_suppression_scope: a.scope,
    p_suppression_reason: a.reason,
  });
  if (error) return { ok: false, ...failure("recordContactAttempt", error) };
  const r = (data ?? {}) as { attempt_id?: string; task_id?: string | null; replayed?: boolean };
  return { ok: true, data: { attemptId: String(r.attempt_id ?? ""), taskId: r.task_id ?? null, replayed: !!r.replayed } };
}

export async function scheduleFollowUp(
  workspaceId: string,
  t: { companyId: string; contactId: string; kind: TaskKind; dueAt: Date; note: string | null },
): Promise<WorkflowMutation<{ id: string }>> {
  await requireUser();
  const { data, error } = await (await supabase()).rpc("schedule_follow_up", {
    p_workspace_id: workspaceId,
    p_company_id: t.companyId,
    p_contact_id: t.contactId,
    p_kind: t.kind,
    p_due_at: t.dueAt.toISOString(),
    p_note: t.note,
  });
  if (error) return { ok: false, ...failure("scheduleFollowUp", error) };
  return { ok: true, data: { id: String(data) } };
}

export async function rescheduleFollowUp(workspaceId: string, taskId: string, dueAt: Date): Promise<WorkflowMutation<null>> {
  await requireUser();
  const { error } = await (await supabase()).rpc("reschedule_follow_up", { p_workspace_id: workspaceId, p_task_id: taskId, p_due_at: dueAt.toISOString() });
  if (error) return { ok: false, ...failure("rescheduleFollowUp", error) };
  return { ok: true, data: null };
}

export async function closeFollowUp(workspaceId: string, taskId: string, outcome: "complete" | "cancel"): Promise<WorkflowMutation<null>> {
  await requireUser();
  const fn = outcome === "complete" ? "complete_follow_up" : "cancel_follow_up";
  const { error } = await (await supabase()).rpc(fn, { p_workspace_id: workspaceId, p_task_id: taskId });
  if (error) return { ok: false, ...failure(fn, error) };
  return { ok: true, data: null };
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export type OpenTask = {
  id: string;
  companyId: string;
  contactId: string;
  kind: TaskKind;
  dueAt: string;
  note: string | null;
};

/** One open task (any contact in the workspace), or null. */
export async function openTask(workspaceId: string, taskId: string): Promise<OpenTask | null> {
  if (!isUuid(taskId)) return null;
  const { data, error } = await (await supabase())
    .from("follow_up_tasks")
    .select("id, company_id, contact_id, kind, due_at, note")
    .eq("workspace_id", workspaceId)
    .eq("id", taskId)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw new DataAccessError("openTask", error);
  return data ? { id: data.id, companyId: data.company_id, contactId: data.contact_id, kind: asKind(data.kind), dueAt: data.due_at, note: data.note } : null;
}

export type ActivityItem = {
  id: string;
  type: "attempt" | "task";
  /** Workspace-local label of when it happened (attempt) or "Due …" (task). Items are ordered by when they happened. */
  when: string;
  title: string;
  contactName: string;
  note: string | null;
  /** "by you" / "by a teammate" (attempts) · "Open" / "Completed" / "Cancelled" (tasks). */
  detail: string;
  status: "open" | "completed" | "cancelled" | null;
};

export type ContactWorkflow = {
  openTask: { id: string; kind: TaskKind; kindLabel: string; dueLabel: string; stateLabel: string | null; date: string; time: string; note: string | null } | null;
  lastContact: string;
  /** Why this contact can't be called now (restricted, left, no phone), or null. */
  blocker: string | null;
};

export type CompanyWorkflow = {
  timezone: string;
  timezoneLabel: string;
  today: string;
  lastContact: string;
  contacts: Record<string, ContactWorkflow>;
  activity: ActivityItem[];
  /** True when older activity exists beyond the shown entries. */
  activityTruncated: boolean;
};

export const ACTIVITY_LIMIT = 30;

const STATUS_LABEL = { open: "Open", completed: "Completed", cancelled: "Cancelled" } as const;

const lastContactLabel = (a: { attempted_at: string; disposition: string } | undefined, now: Date, tz: string) =>
  a ? `Last contact: ${formatWhen(a.attempted_at, now, tz)} · ${DISPOSITION_LABEL[asDisposition(a.disposition)]}` : "Never contacted";

/**
 * The drawer's workflow view of a company: each contact's open task and last
 * contact, and a bounded, newest-first activity timeline (attempts + tasks).
 */
export async function companyWorkflow(
  workspaceId: string,
  companyId: string,
  timezone: string,
  people: { id: string; fullName: string; phone: string | null; status: string; restricted: boolean }[],
  companyRestricted: boolean,
  now: Date = new Date(),
): Promise<CompanyWorkflow> {
  const user = await requireUser();
  const client = await supabase();
  const [attempts, tasks] = await Promise.all([
    client
      .from("contact_attempts")
      .select("id, contact_id, disposition, note, attempted_at, created_by")
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId)
      .order("attempted_at", { ascending: false })
      .limit(ACTIVITY_LIMIT + 1),
    client
      .from("follow_up_tasks")
      .select("id, contact_id, kind, due_at, status, note, created_at, completed_at, cancelled_at")
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT + 1),
  ]);
  if (attempts.error) throw new DataAccessError("companyWorkflow.attempts", attempts.error);
  if (tasks.error) throw new DataAccessError("companyWorkflow.tasks", tasks.error);
  const a = attempts.data ?? [];
  const t = tasks.data ?? [];
  const { start } = dayBounds(now, timezone);
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));

  const contacts: Record<string, ContactWorkflow> = {};
  for (const p of people) {
    const open = t.find((x) => x.contact_id === p.id && x.status === "open");
    const blocker = taskBlocker({
      companyArchived: false,
      contactArchived: false,
      companyRestricted,
      contactRestricted: p.restricted,
      contactStatus: p.status === "left_company" ? "left_company" : "active",
      phone: p.phone,
    });
    const local = open ? utcToLocalInput(open.due_at, timezone) : null;
    contacts[p.id] = {
      openTask:
        open && local
          ? {
              id: open.id,
              kind: asKind(open.kind),
              kindLabel: TASK_KIND_LABEL[asKind(open.kind)],
              dueLabel: formatWhen(open.due_at, now, timezone),
              stateLabel: new Date(open.due_at) <= now ? DUE_STATE_LABEL[classifyDue(open.due_at, now, start)] : null,
              date: local.date,
              time: local.time,
              note: open.note,
            }
          : null,
      lastContact: lastContactLabel(a.find((x) => x.contact_id === p.id), now, timezone),
      blocker: blocker ? TASK_BLOCKER_LABEL[blocker] : null,
    };
  }

  const items: (ActivityItem & { sort: number })[] = [
    ...a.slice(0, ACTIVITY_LIMIT).map((x) => ({
      id: x.id,
      type: "attempt" as const,
      when: formatWhen(x.attempted_at, now, timezone),
      title: DISPOSITION_LABEL[asDisposition(x.disposition)],
      contactName: nameOf.get(x.contact_id) ?? "Former contact",
      note: x.note,
      detail: x.created_by === user.id ? "by you" : "by a teammate",
      status: null,
      sort: new Date(x.attempted_at).getTime(),
    })),
    ...t.slice(0, ACTIVITY_LIMIT).map((x) => ({
      id: x.id,
      type: "task" as const,
      when: `Due ${formatWhen(x.due_at, now, timezone)}`,
      title: TASK_KIND_LABEL[asKind(x.kind)],
      contactName: nameOf.get(x.contact_id) ?? "Former contact",
      note: x.note,
      detail: STATUS_LABEL[(x.status as keyof typeof STATUS_LABEL) ?? "open"] ?? "Open",
      status: (x.status as ActivityItem["status"]) ?? null,
      sort: new Date(x.cancelled_at ?? x.completed_at ?? x.created_at).getTime(),
    })),
  ].sort((x, y) => y.sort - x.sort || y.id.localeCompare(x.id));

  return {
    timezone,
    timezoneLabel: timeZoneLabel(timezone, now),
    today: utcToLocalInput(now, timezone).date,
    lastContact: lastContactLabel(a[0], now, timezone),
    contacts,
    activity: items.slice(0, ACTIVITY_LIMIT).map((item) => ({ id: item.id, type: item.type, when: item.when, title: item.title, contactName: item.contactName, note: item.note, detail: item.detail, status: item.status })),
    activityTruncated: a.length > ACTIVITY_LIMIT || t.length > ACTIVITY_LIMIT || items.length > ACTIVITY_LIMIT,
  };
}

/** The latest attempt for a contact (label), its open task, used by the Start contact sheet. */
export async function contactLatest(workspaceId: string, contactId: string): Promise<{ lastAttempt: { attemptedAt: string; disposition: Disposition } | null; openTask: OpenTask | null }> {
  const client = await supabase();
  const [a, t] = await Promise.all([
    client
      .from("contact_attempts")
      .select("attempted_at, disposition")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .order("attempted_at", { ascending: false })
      .limit(1),
    client
      .from("follow_up_tasks")
      .select("id, company_id, contact_id, kind, due_at, note")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .eq("status", "open")
      .limit(1),
  ]);
  if (a.error) throw new DataAccessError("contactLatest.attempt", a.error);
  if (t.error) throw new DataAccessError("contactLatest.task", t.error);
  const at = a.data?.[0];
  const tk = t.data?.[0];
  return {
    lastAttempt: at ? { attemptedAt: at.attempted_at, disposition: asDisposition(at.disposition) } : null,
    openTask: tk ? { id: tk.id, companyId: tk.company_id, contactId: tk.contact_id, kind: asKind(tk.kind), dueAt: tk.due_at, note: tk.note } : null,
  };
}
