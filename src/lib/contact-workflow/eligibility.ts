import { DISPOSITION_RULES } from "./dispositions";
import type { CompanyFacts, ContactFacts, DueTaskFacts } from "./types";

/**
 * Ready-to-contact eligibility (P1-E7), decided from stored facts only.
 *
 * Company (default ICP): a CURRENT score with grade A or B (not C, Excluded,
 * Outdated or Not scored), qualification unreviewed or qualified, and no
 * active company restriction.
 *
 * Contact (phone queue): not left the company, a usable phone, not restricted,
 * no open task (a future task waits for its day; a due task is listed under
 * due work instead), and a latest attempt that doesn't keep it out:
 *   not interested / wrong number → not returned automatically;
 *   any other outcome today → not again on this workspace-local day.
 */

export type CompanyIneligibility = "not_scored" | "outdated" | "excluded" | "grade" | "qualification" | "restricted";

export function companyIneligibility(c: CompanyFacts): CompanyIneligibility | null {
  if (c.scoreState === "none") return "not_scored";
  if (c.scoreState === "outdated") return "outdated";
  if (c.scoreState === "excluded") return "excluded";
  if (c.grade !== "A" && c.grade !== "B") return "grade";
  if (c.qualification !== "unreviewed" && c.qualification !== "qualified") return "qualification";
  if (c.restricted) return "restricted";
  return null;
}

/** A phone value someone can dial: at least 3 digits. */
export const hasUsablePhone = (phone: string | null | undefined): phone is string => !!phone && (phone.match(/\d/g)?.length ?? 0) >= 3;

export type ContactIneligibility = "left_company" | "restricted" | "no_phone" | "open_task" | "not_returned" | "attempted_today";

export function contactIneligibility(c: ContactFacts, dayStart: Date): ContactIneligibility | null {
  if (c.status === "left_company") return "left_company";
  if (c.restricted) return "restricted";
  if (!hasUsablePhone(c.phone)) return "no_phone";
  if (c.openTaskDueAt) return "open_task";
  const latest = c.latestAttempt;
  if (latest) {
    const rule = DISPOSITION_RULES[latest.disposition].ready;
    if (rule === "terminal") return "not_returned";
    if (rule === "same_day" && new Date(latest.attemptedAt).getTime() >= dayStart.getTime()) return "attempted_today";
  }
  return null;
}

/** Could anyone at the company be called, ignoring today's workflow state? (For "Needs callable contact".) */
export function hasCallableContact(contacts: ContactFacts[]): boolean {
  return contacts.some((c) => c.status !== "left_company" && !c.restricted && hasUsablePhone(c.phone));
}

export type TaskBlocker = "unavailable" | "company_restricted" | "contact_restricted" | "contact_left" | "no_phone";

export const TASK_BLOCKER_LABEL: Record<TaskBlocker, string> = {
  unavailable: "The company or contact was archived",
  company_restricted: "Company is restricted (do not contact)",
  contact_restricted: "Contact is restricted (do not contact)",
  contact_left: "Contact left the company",
  no_phone: "Contact has no phone number",
};

/** Why a due task can't be worked now (it stays visible under Needs attention), or null. */
export function taskBlocker(t: Pick<DueTaskFacts, "companyArchived" | "contactArchived" | "companyRestricted" | "contactRestricted" | "contactStatus" | "phone">): TaskBlocker | null {
  if (t.companyArchived || t.contactArchived) return "unavailable";
  if (t.companyRestricted) return "company_restricted";
  if (t.contactRestricted) return "contact_restricted";
  if (t.contactStatus === "left_company") return "contact_left";
  if (!hasUsablePhone(t.phone)) return "no_phone";
  return null;
}
