import type { Grade, QualificationState } from "@/lib/lead-core/schemas";

/**
 * Contact workflow (P1-E7): manual phone attempts, their outcomes
 * (dispositions) and each contact's single open next action (task).
 * Database values are snake_case; product labels live in dispositions.ts.
 */

export const DISPOSITIONS = [
  "no_answer",
  "left_voicemail",
  "connected_interested",
  "connected_not_interested",
  "callback_requested",
  "follow_up_needed",
  "wrong_number",
  "do_not_contact",
  "other",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const TASK_KINDS = ["callback", "follow_up", "retry_call"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ["open", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const SUPPRESSION_SCOPES = ["contact", "company"] as const;
export type SuppressionScope = (typeof SUPPRESSION_SCOPES)[number];

export type ContactStatus = "active" | "left_company" | "unknown";

/** What the queue knows about one contact at a ready-candidate company. */
export type ContactFacts = {
  id: string;
  fullName: string;
  jobTitle: string | null;
  phone: string | null;
  isPrimary: boolean;
  status: ContactStatus;
  restricted: boolean;
  /** Due time of the contact's open task (any task, future or due). */
  openTaskDueAt: string | null;
  latestAttempt: { disposition: Disposition; attemptedAt: string } | null;
};

export type ScoreState = "current" | "excluded" | "outdated" | "none";

/** Company-level facts for Ready eligibility (default ICP). */
export type CompanyFacts = {
  qualification: QualificationState;
  restricted: boolean;
  scoreState: ScoreState;
  grade: Grade | null;
  score: number | null;
};

export type ReadyCandidate = CompanyFacts & {
  companyId: string;
  name: string;
  location: string | null;
  coveragePercent: number | null;
  contacts: ContactFacts[];
  lastAttempt: { disposition: Disposition; attemptedAt: string; contactName: string } | null;
};

/** An open task due before the end of the workspace-local day, with its blocking facts. */
export type DueTaskFacts = {
  id: string;
  kind: TaskKind;
  dueAt: string;
  note: string | null;
  companyId: string;
  companyName: string;
  companyArchived: boolean;
  companyRestricted: boolean;
  contactId: string;
  contactName: string;
  jobTitle: string | null;
  phone: string | null;
  contactStatus: ContactStatus;
  contactArchived: boolean;
  contactRestricted: boolean;
};
