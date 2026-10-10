import { z } from "zod";
import type { Grade } from "@/lib/lead-core/schemas";
import { isValidTimeZone } from "@/lib/config/timezone";
import { DISPOSITIONS, SUPPRESSION_SCOPES, TASK_KINDS, type TaskKind } from "./types";
import type { DueState } from "./queue";

/**
 * What the browser sends and receives for the contact workflow (P1-E7).
 * Inputs are ids, choices and typed local date/time text only; the server
 * re-reads company, contact, task, restriction and workspace state, converts
 * times with the workspace zone, and the database re-checks everything.
 * Schemas are strict: unknown keys (an actor id, a timestamp) are rejected.
 */

const text = (max: number, message: string) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().max(max, message))
    .nullable()
    .transform((v) => v || null);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time.");

export const recordAttemptSchema = z.strictObject({
  companyId: z.uuid(),
  contactId: z.uuid(),
  requestId: z.uuid(),
  sourceTaskId: z.uuid().nullable(),
  disposition: z.enum(DISPOSITIONS),
  note: text(1000, "Use 1,000 characters or fewer."),
  next: z.strictObject({ kind: z.enum(TASK_KINDS), date, time, note: text(1000, "Use 1,000 characters or fewer.") }).nullable(),
  scope: z.enum(SUPPRESSION_SCOPES).nullable(),
  reason: text(500, "Use 500 characters or fewer."),
});
export type RecordAttemptInput = z.output<typeof recordAttemptSchema>;

export const scheduleTaskSchema = z.strictObject({
  companyId: z.uuid(),
  contactId: z.uuid(),
  kind: z.enum(TASK_KINDS),
  date,
  time,
  note: text(1000, "Use 1,000 characters or fewer."),
});

export const rescheduleTaskSchema = z.strictObject({ taskId: z.uuid(), date, time });
export const taskActionSchema = z.strictObject({ taskId: z.uuid() });
export const timezoneSchema = z.strictObject({
  timezone: z.string().refine((v) => isValidTimeZone(v), "Choose a time zone from the list."),
});

// -----------------------------------------------------------------------------
// View models (plain, serializable)
// -----------------------------------------------------------------------------

export type ReadyRowView = {
  companyId: string;
  companyName: string;
  location: string | null;
  grade: Grade;
  score: number;
  contactId: string;
  contactName: string;
  jobTitle: string | null;
  phone: string;
  /** "Never contacted" or "Yesterday · No answer". */
  lastContact: string;
};

export type DueRowView = {
  taskId: string;
  kind: TaskKind;
  kindLabel: string;
  dueLabel: string;
  /** Workspace-local date and time of the due instant (reschedule prefill). */
  date: string;
  time: string;
  state: DueState;
  stateLabel: string;
  companyId: string;
  companyName: string;
  contactId: string;
  contactName: string;
  jobTitle: string | null;
  phone: string | null;
  note: string | null;
  /** Set when the task can't be worked (it is shown under Needs attention). */
  blocker: string | null;
};

export type AttemptRowView = {
  id: string;
  when: string;
  companyId: string;
  companyName: string;
  contactName: string;
  disposition: string;
  note: string | null;
  by: string;
};

export type TodayView = {
  timezone: string;
  timezoneLabel: string;
  state: "ok" | "no_default_icp";
  summary: { ready: number; callbacks: number; followUps: number; contactedToday: number };
  ready: { rows: ReadyRowView[]; total: number };
  callbacks: DueRowView[];
  followUps: DueRowView[];
  blocked: DueRowView[];
  contactedToday: { rows: AttemptRowView[]; total: number };
  attention: { outdated: number; unscored: number; needsCallableContact: { companyId: string; name: string }[]; blocked: number };
  /** Bounded reads: true when the due list hit its cap. */
  truncated: boolean;
};

export type ContactSheetData = {
  requestId: string;
  timezone: string;
  timezoneLabel: string;
  /** Today's workspace-local date, to prefill date inputs. */
  today: string;
  company: { id: string; name: string; grade: Grade | null; score: number | null; fitLabel: string };
  contact: { id: string; name: string; jobTitle: string | null; phone: string | null; telHref: string | null };
  lastAttempt: string;
  task: { id: string; kindLabel: string; dueLabel: string; stateLabel: string | null } | null;
  /** Why no new attempt can be logged (restricted, left, no phone), or null. */
  blocked: string | null;
  /** Other contacts at the company (for "try another contact"). */
  otherContacts: number;
};

export type WorkflowResult = { ok: true; message: string; hint?: string } | { ok: false; error: string };

/** A dialable tel: URI from a stored phone value (digits and a leading +), or null. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return digits.replace(/\D/g, "").length >= 3 ? `tel:${digits}` : null;
}
