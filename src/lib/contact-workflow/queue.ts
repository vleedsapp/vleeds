import type { DecisionMakerPriority } from "@/lib/config/icp";
import { bestRoleFor, ROLE_RANK } from "@/lib/scoring/decision-maker-fit";
import { companyIneligibility, contactIneligibility, hasCallableContact, taskBlocker, type TaskBlocker } from "./eligibility";
import type { ContactFacts, DueTaskFacts, ReadyCandidate } from "./types";

/**
 * Today queue assembly (P1-E7): pure functions over stored facts.
 */

export const READY_LIMIT = 25;

type Role = { title: string; priority: DecisionMakerPriority };

/**
 * The contact to call at a company: among ELIGIBLE contacts, the best
 * default-ICP role match (primary, secondary, fallback; the same whole-word
 * matching as scoring and contact discovery), then the primary contact, then
 * a stable order (name, id).
 */
export function recommendContact(eligible: ContactFacts[], roles: readonly Role[]): { contact: ContactFacts; role: DecisionMakerPriority | null } | null {
  const ranked = eligible
    .map((contact) => ({ contact, role: bestRoleFor(contact.jobTitle, roles)?.priority ?? null }))
    .sort(
      (a, b) =>
        (a.role ? ROLE_RANK[a.role] : 3) - (b.role ? ROLE_RANK[b.role] : 3) ||
        Number(b.contact.isPrimary) - Number(a.contact.isPrimary) ||
        a.contact.fullName.localeCompare(b.contact.fullName, "en") ||
        a.contact.id.localeCompare(b.contact.id),
    );
  return ranked[0] ?? null;
}

export type ReadyItem = {
  candidate: ReadyCandidate;
  contact: ContactFacts;
  role: DecisionMakerPriority | null;
};

/** A before B, fit descending, then name and id. Coverage never reorders fit. */
export function compareReady(a: ReadyCandidate, b: ReadyCandidate): number {
  return (
    (a.grade === "A" ? 0 : 1) - (b.grade === "A" ? 0 : 1) ||
    (b.score ?? 0) - (a.score ?? 0) ||
    a.name.localeCompare(b.name, "en") ||
    a.companyId.localeCompare(b.companyId)
  );
}

/**
 * One Ready item per eligible company (its recommended contact), ordered, plus
 * the companies that are otherwise eligible but have nobody callable.
 */
export function buildReadyQueue(
  candidates: ReadyCandidate[],
  roles: readonly Role[],
  dayStart: Date,
  limit = READY_LIMIT,
): { items: ReadyItem[]; total: number; needsCallableContact: { companyId: string; name: string }[] } {
  const ready: ReadyItem[] = [];
  const needsCallableContact: { companyId: string; name: string }[] = [];
  for (const c of [...candidates].sort(compareReady)) {
    if (companyIneligibility(c)) continue;
    const eligible = c.contacts.filter((p) => contactIneligibility(p, dayStart) === null);
    const pick = recommendContact(eligible, roles);
    if (pick) ready.push({ candidate: c, contact: pick.contact, role: pick.role });
    else if (!hasCallableContact(c.contacts)) needsCallableContact.push({ companyId: c.companyId, name: c.name });
  }
  return { items: ready.slice(0, Math.max(0, limit)), total: ready.length, needsCallableContact };
}

export type DueState = "overdue" | "due_now" | "later_today";

export const DUE_STATE_LABEL: Record<DueState, string> = { overdue: "Overdue", due_now: "Due now", later_today: "Later today" };

/** Overdue: due before today began (workspace-local). Due now: today, at or before now. Later today: after now, still today. */
export function classifyDue(dueAt: string | Date, now: Date, dayStart: Date): DueState {
  const t = new Date(dueAt).getTime();
  if (t < dayStart.getTime()) return "overdue";
  if (t <= now.getTime()) return "due_now";
  return "later_today";
}

export type DueItem = DueTaskFacts & { state: DueState; blocker: TaskBlocker | null };

/** Overdue first, then due time ascending, then id. */
export function compareDue(a: DueItem, b: DueItem): number {
  return (
    (a.state === "overdue" ? 0 : 1) - (b.state === "overdue" ? 0 : 1) ||
    new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime() ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Splits open tasks due by the end of today into actionable callbacks,
 * actionable follow-ups (follow-ups and retry calls) and blocked tasks.
 * Tasks due later than today must not be passed in.
 */
export function buildDueQueue(tasks: DueTaskFacts[], now: Date, dayStart: Date): { callbacks: DueItem[]; followUps: DueItem[]; blocked: DueItem[] } {
  const items = tasks.map((t) => ({ ...t, state: classifyDue(t.dueAt, now, dayStart), blocker: taskBlocker(t) })).sort(compareDue);
  return {
    callbacks: items.filter((t) => !t.blocker && t.kind === "callback"),
    followUps: items.filter((t) => !t.blocker && t.kind !== "callback"),
    blocked: items.filter((t) => t.blocker),
  };
}
