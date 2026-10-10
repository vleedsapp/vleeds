import type { Disposition, SuppressionScope, TaskKind } from "./types";

/**
 * What each outcome means and requires. The database function
 * record_contact_attempt enforces the same rules; this module drives the form
 * and the server action's validation so users get a clear message first.
 *
 * Nothing here changes qualification, ICP score or grade. Only "Do not
 * contact" creates a restriction (suppression), with an explicit scope.
 */

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  no_answer: "No answer",
  left_voicemail: "Left voicemail",
  connected_interested: "Connected — interested",
  connected_not_interested: "Connected — not interested",
  callback_requested: "Callback requested",
  follow_up_needed: "Follow-up needed",
  wrong_number: "Wrong number",
  do_not_contact: "Do not contact",
  other: "Other",
};

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  callback: "Callback",
  follow_up: "Follow-up",
  retry_call: "Retry call",
};

export const SCOPE_LABEL: Record<SuppressionScope, string> = { contact: "This person", company: "Entire company" };

export type DispositionRule = {
  /** none: no next action in this step · optional: the user may add one · required: must schedule one. */
  next: "none" | "optional" | "required";
  nextKinds: TaskKind[];
  noteRequired: boolean;
  scopeRequired: boolean;
  /**
   * How the contact behaves in Ready afterwards (when no task is open):
   *  same_day   — not shown again on this workspace-local day
   *  terminal   — not returned to Ready automatically
   *  restricted — governed by the do-not-contact record
   */
  ready: "same_day" | "terminal" | "restricted";
};

export const DISPOSITION_RULES: Record<Disposition, DispositionRule> = {
  no_answer: { next: "optional", nextKinds: ["retry_call"], noteRequired: false, scopeRequired: false, ready: "same_day" },
  left_voicemail: { next: "optional", nextKinds: ["retry_call"], noteRequired: false, scopeRequired: false, ready: "same_day" },
  connected_interested: { next: "optional", nextKinds: ["follow_up"], noteRequired: false, scopeRequired: false, ready: "same_day" },
  connected_not_interested: { next: "none", nextKinds: [], noteRequired: false, scopeRequired: false, ready: "terminal" },
  callback_requested: { next: "required", nextKinds: ["callback"], noteRequired: false, scopeRequired: false, ready: "same_day" },
  follow_up_needed: { next: "required", nextKinds: ["follow_up"], noteRequired: false, scopeRequired: false, ready: "same_day" },
  wrong_number: { next: "none", nextKinds: [], noteRequired: false, scopeRequired: false, ready: "terminal" },
  do_not_contact: { next: "none", nextKinds: [], noteRequired: false, scopeRequired: true, ready: "restricted" },
  other: { next: "optional", nextKinds: ["follow_up", "callback", "retry_call"], noteRequired: true, scopeRequired: false, ready: "same_day" },
};

/** Label of the optional next-action switch for an outcome (null when it has none or it's required). */
export const OPTIONAL_NEXT_LABEL: Partial<Record<Disposition, string>> = {
  no_answer: "Schedule another attempt",
  left_voicemail: "Schedule another attempt",
  connected_interested: "Schedule follow-up",
  other: "Schedule a next action",
};

/** Words for the required date/time fields. */
export const NEXT_FIELD_WORD: Record<TaskKind, string> = { callback: "Callback", follow_up: "Follow-up", retry_call: "Next attempt" };

export type OutcomeDraft = {
  disposition: Disposition;
  note: string | null;
  next: { kind: TaskKind; dueAt: Date | null } | null;
  scope: SuppressionScope | null;
};

/**
 * The first problem with an outcome, as a user-facing sentence, or null.
 * `dueAt` null means the date/time couldn't be read.
 */
export function outcomeProblem(o: OutcomeDraft, now: Date): string | null {
  const rule = DISPOSITION_RULES[o.disposition];
  if (rule.noteRequired && !o.note?.trim()) return "Add a note describing what happened.";
  if (rule.scopeRequired && !o.scope) return "Choose who should not be contacted: this person or the entire company.";
  if (!rule.scopeRequired && o.scope) return "Only “Do not contact” creates a restriction.";
  if (rule.next === "required" && !o.next) return `Choose the ${NEXT_FIELD_WORD[rule.nextKinds[0]].toLowerCase()} date and time.`;
  if (o.next) {
    if (rule.next === "none" || !rule.nextKinds.includes(o.next.kind)) return "This outcome can't schedule that next action.";
    if (!o.next.dueAt) return "Enter a valid date and time.";
    if (o.next.dueAt.getTime() <= now.getTime()) return "Choose a date and time in the future.";
  }
  return null;
}
