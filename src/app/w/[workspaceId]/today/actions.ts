"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { outcomeProblem, DISPOSITION_LABEL, TASK_KIND_LABEL } from "@/lib/contact-workflow/dispositions";
import { TASK_BLOCKER_LABEL, taskBlocker } from "@/lib/contact-workflow/eligibility";
import { classifyDue, DUE_STATE_LABEL } from "@/lib/contact-workflow/queue";
import { dayBounds, formatWhen, localDateTimeToUtc, timeZoneLabel, utcToLocalInput } from "@/lib/contact-workflow/time";
import {
  recordAttemptSchema,
  rescheduleTaskSchema,
  scheduleTaskSchema,
  taskActionSchema,
  telHref,
  type ContactSheetData,
  type WorkflowResult,
} from "@/lib/contact-workflow/view";
import {
  closeFollowUp,
  companiesNeedingEvaluation,
  contactLatest,
  evaluateAndSaveFit,
  findWorkspace,
  getCompanyDetail,
  getCurrentUser,
  listIcpProfilesForScoring,
  openTask,
  recordContactAttempt,
  rescheduleFollowUp,
  scheduleFollowUp,
  type WorkflowFailure,
  type WorkspaceDetail,
} from "@/lib/dal";
import { isUuid } from "@/lib/navigation";
import { NOT_EVALUABLE_MESSAGE } from "@/lib/scoring/view";
import { trustedScoreWriterConfigured } from "@/lib/supabase/trusted-score-writer";

/**
 * Today + manual contact workflow actions (P1-E7).
 *
 * The browser sends ids, choices and local date/time text. Every action
 * re-authenticates, re-authorizes the workspace, re-reads company / contact /
 * task / restriction state, and interprets times in the WORKSPACE time zone.
 * The database functions check everything again in one transaction. Nothing
 * here calls a provider; opening a sheet, copying a number or following a
 * tel: link never records an attempt.
 */

async function authorize(workspaceId: unknown): Promise<WorkspaceDetail | null> {
  if (typeof workspaceId !== "string" || !isUuid(workspaceId)) return null;
  if (!(await getCurrentUser())) redirect("/login");
  return findWorkspace(workspaceId);
}

const NOT_AVAILABLE = "This company or contact is no longer available.";
const GENERIC = "That couldn't be saved. Try again.";

function failureMessage(reason: WorkflowFailure, detail: string | null): string {
  switch (reason) {
    case "unavailable":
      return NOT_AVAILABLE;
    case "restricted":
      return detail === "company_restricted"
        ? "This company is restricted (do not contact). Nothing was saved."
        : "This contact is restricted (do not contact). Nothing was saved.";
    case "not_contactable":
      return detail === "contact_left" ? "This contact has left the company. Nothing was saved." : "This contact has no phone number. Nothing was saved.";
    case "task_closed":
      return "This task was already completed or cancelled.";
    case "task_exists":
      return "This contact already has an open task. Reschedule that task instead.";
    case "invalid":
      return "Check the details and try again.";
    case "conflict":
      return "Something changed meanwhile. Close this and try again.";
    default:
      return GENERIC;
  }
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

// -----------------------------------------------------------------------------
// Start contact (read-only: never records anything)
// -----------------------------------------------------------------------------

export async function loadContactSheet(
  workspaceId: string,
  input: unknown,
): Promise<{ ok: true; data: ContactSheetData } | { ok: false; error: string }> {
  const ws = await authorize(workspaceId);
  const req = input as { companyId?: unknown; contactId?: unknown; taskId?: unknown } | null;
  if (!ws || !req || typeof req.companyId !== "string" || typeof req.contactId !== "string" || !isUuid(req.companyId) || !isUuid(req.contactId)) {
    return fail(NOT_AVAILABLE);
  }
  const company = await getCompanyDetail(ws.id, req.companyId);
  const person = company?.contacts.find((p) => p.id === req.contactId);
  if (!company || !person) return fail(NOT_AVAILABLE);

  const now = new Date();
  const { start } = dayBounds(now, ws.timezone);
  const latest = await contactLatest(ws.id, person.id);
  const blocker = taskBlocker({
    companyArchived: false,
    contactArchived: false,
    companyRestricted: !!company.restriction,
    contactRestricted: !!person.restriction,
    contactStatus: person.status === "left_company" ? "left_company" : "active",
    phone: person.phone,
  });
  const fit = company.fit?.state === "current" ? company.fit : null;
  const task = latest.openTask;

  return {
    ok: true,
    data: {
      requestId: randomUUID(),
      timezone: ws.timezone,
      timezoneLabel: timeZoneLabel(ws.timezone, now),
      today: utcToLocalInput(now, ws.timezone).date,
      company: {
        id: company.id,
        name: company.name,
        grade: fit?.grade ?? null,
        score: fit?.score ?? null,
        fitLabel: fit?.grade
          ? `Grade ${fit.grade} · ${fit.score} fit`
          : company.fit?.state === "excluded"
            ? "Excluded for the default ICP"
            : company.fit?.state === "outdated"
              ? "Score outdated"
              : "Not scored",
      },
      contact: { id: person.id, name: person.fullName, jobTitle: person.jobTitle, phone: person.phone, telHref: blocker ? null : telHref(person.phone) },
      lastAttempt: latest.lastAttempt
        ? `${formatWhen(latest.lastAttempt.attemptedAt, now, ws.timezone)} · ${DISPOSITION_LABEL[latest.lastAttempt.disposition]}`
        : "Never contacted",
      task: task
        ? {
            id: task.id,
            kindLabel: TASK_KIND_LABEL[task.kind],
            dueLabel: formatWhen(task.dueAt, now, ws.timezone),
            stateLabel: new Date(task.dueAt) <= now ? DUE_STATE_LABEL[classifyDue(task.dueAt, now, start)] : null,
          }
        : null,
      blocked: blocker ? TASK_BLOCKER_LABEL[blocker] : null,
      otherContacts: company.contacts.filter((p) => p.id !== person.id && p.status !== "left_company" && !p.restriction).length,
    },
  };
}

// -----------------------------------------------------------------------------
// Log outcome
// -----------------------------------------------------------------------------

export async function recordContactOutcome(workspaceId: string, input: unknown): Promise<WorkflowResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail(NOT_AVAILABLE);
  const parsed = recordAttemptSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the outcome and try again.");
  const r = parsed.data;

  const dueAt = r.next ? localDateTimeToUtc(r.next.date, r.next.time, ws.timezone) : null;
  const now = new Date();
  const problem = outcomeProblem({ disposition: r.disposition, note: r.note, next: r.next ? { kind: r.next.kind, dueAt } : null, scope: r.scope }, now);
  if (problem) return fail(problem);

  const saved = await recordContactAttempt(ws.id, {
    companyId: r.companyId,
    contactId: r.contactId,
    requestId: r.requestId,
    sourceTaskId: r.sourceTaskId,
    disposition: r.disposition,
    note: r.note,
    next: r.next && dueAt ? { kind: r.next.kind, dueAt, note: r.next.note } : null,
    scope: r.scope,
    reason: r.disposition === "do_not_contact" ? r.reason : null,
  });
  if (!saved.ok) return fail(failureMessage(saved.reason, saved.detail));
  refresh();

  const parts = [`Saved: ${DISPOSITION_LABEL[r.disposition]}.`];
  if (r.sourceTaskId) parts.push("The task is complete.");
  if (r.next && dueAt) parts.push(`${TASK_KIND_LABEL[r.next.kind]} scheduled for ${formatWhen(dueAt, now, ws.timezone)}.`);
  if (r.disposition === "do_not_contact") parts.push(r.scope === "company" ? "The company is now restricted." : "This person is now restricted.");
  return {
    ok: true,
    message: parts.join(" "),
    hint: r.disposition === "wrong_number" ? "Try another contact at this company if one is available." : undefined,
  };
}

// -----------------------------------------------------------------------------
// Tasks
// -----------------------------------------------------------------------------

export async function scheduleTask(workspaceId: string, input: unknown): Promise<WorkflowResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail(NOT_AVAILABLE);
  const parsed = scheduleTaskSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the details and try again.");
  const t = parsed.data;
  const dueAt = localDateTimeToUtc(t.date, t.time, ws.timezone);
  const now = new Date();
  if (!dueAt) return fail("Enter a valid date and time.");
  if (dueAt <= now) return fail("Choose a date and time in the future.");
  const saved = await scheduleFollowUp(ws.id, { companyId: t.companyId, contactId: t.contactId, kind: t.kind, dueAt, note: t.note });
  if (!saved.ok) return fail(failureMessage(saved.reason, saved.detail));
  refresh();
  return { ok: true, message: `${TASK_KIND_LABEL[t.kind]} scheduled for ${formatWhen(dueAt, now, ws.timezone)}.` };
}

export async function rescheduleTask(workspaceId: string, input: unknown): Promise<WorkflowResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail(NOT_AVAILABLE);
  const parsed = rescheduleTaskSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the date and time.");
  const dueAt = localDateTimeToUtc(parsed.data.date, parsed.data.time, ws.timezone);
  const now = new Date();
  if (!dueAt) return fail("Enter a valid date and time.");
  if (dueAt <= now) return fail("Choose a date and time in the future.");
  const task = await openTask(ws.id, parsed.data.taskId);
  if (!task) return fail(failureMessage("task_closed", null));
  const saved = await rescheduleFollowUp(ws.id, task.id, dueAt);
  if (!saved.ok) return fail(failureMessage(saved.reason, saved.detail));
  refresh();
  return { ok: true, message: `${TASK_KIND_LABEL[task.kind]} moved to ${formatWhen(dueAt, now, ws.timezone)}.` };
}

export async function completeTask(workspaceId: string, input: unknown): Promise<WorkflowResult> {
  return closeTask(workspaceId, input, "complete");
}

export async function cancelTask(workspaceId: string, input: unknown): Promise<WorkflowResult> {
  return closeTask(workspaceId, input, "cancel");
}

async function closeTask(workspaceId: string, input: unknown, outcome: "complete" | "cancel"): Promise<WorkflowResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail(NOT_AVAILABLE);
  const parsed = taskActionSchema.safeParse(input);
  if (!parsed.success) return fail(failureMessage("task_closed", null));
  const saved = await closeFollowUp(ws.id, parsed.data.taskId, outcome);
  if (!saved.ok) return fail(failureMessage(saved.reason, saved.detail));
  refresh();
  return { ok: true, message: outcome === "complete" ? "Task completed. No contact attempt was recorded." : "Task cancelled." };
}

// -----------------------------------------------------------------------------
// Refresh lead scores (explicit, bounded batch; same evaluator + trusted writer)
// -----------------------------------------------------------------------------

const SCORE_BATCH_SIZE = 50;

export type RefreshScoresResult =
  | { ok: true; evaluated: number; grades: { A: number; B: number; C: number; excluded: number }; skipped: number; remaining: number }
  | { ok: false; error: string };

export async function refreshLeadScores(workspaceId: string): Promise<RefreshScoresResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail(NOT_AVAILABLE);
  const profile = (await listIcpProfilesForScoring(ws.id)).find((p) => p.isDefault);
  if (!profile) return fail("Set a default ICP to build your Today queue.");
  if (!trustedScoreWriterConfigured()) return fail("Scores can't be saved on this server yet: the trusted score writer isn't configured.");

  const batch = await companiesNeedingEvaluation(ws.id, SCORE_BATCH_SIZE);
  const grades = { A: 0, B: 0, C: 0, excluded: 0 };
  let evaluated = 0;
  let skipped = 0;
  for (const companyId of batch.ids) {
    const r = await evaluateAndSaveFit(ws.id, companyId, profile.id);
    if (r.ok) {
      evaluated++;
      if (r.outcome === "excluded") grades.excluded++;
      else if (r.grade) grades[r.grade]++;
    } else if (r.reason === "not_evaluable") {
      return fail(NOT_EVALUABLE_MESSAGE);
    } else if (r.reason === "not_configured") {
      return fail("Scores can't be saved on this server yet: the trusted score writer isn't configured.");
    } else {
      skipped++;
    }
  }
  if (evaluated) refresh();
  return { ok: true, evaluated, grades, skipped, remaining: Math.max(0, batch.total - evaluated) };
}
