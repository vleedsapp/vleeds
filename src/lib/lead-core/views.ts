import type { ContactStatus, Grade, QualificationState, ScoreStatus, SourceKind } from "./schemas";

/**
 * Narrow view models returned by the DAL for the Leads page and company
 * drawer. Safe to pass to Client Components: no raw rows, no internal ids
 * beyond the record ids the UI links to.
 */

export type CompanyListItem = {
  id: string;
  name: string;
  domain: string | null;
  location: string | null;
  qualification: QualificationState;
  primaryContact: { name: string; title: string | null } | null;
  contactCount: number;
  evidenceCount: number;
  /** An active company-level suppression exists. */
  restricted: boolean;
  /** Only a CURRENT result for the default ICP (current revision + current input fingerprint). */
  grade: Grade | null;
  score: number | null;
  /** current | excluded | outdated | none (default ICP). */
  scoreState: "current" | "excluded" | "outdated" | "none";
  coveragePercent: number | null;
  updatedAt: string;
};

/** Compact description used for duplicate warnings and import review. */
export type CompanySummary = {
  id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  location: string | null;
  primaryContact: string | null;
};

export type CompanyList ={ items: CompanyListItem[]; total: number; page: number; pageSize: number; pageCount: number };

export type ContactView = {
  id: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  isPrimary: boolean;
  status: ContactStatus;
  restriction: { id: string; reason: string | null } | null;
};

export type EvidenceView = {
  id: string;
  subject: "company" | "contact";
  contactName: string | null;
  fieldKey: string | null;
  sourceKind: SourceKind;
  providerKey: string | null;
  sourceUrl: string | null;
  value: string | null;
  confidence: number | null;
  observedAt: string | null;
};

export type ScoreView = {
  id: string;
  profileId: string;
  profileName: string;
  profileIsDefault: boolean;
  revision: number;
  /** Not current: the profile changed ("profile"), or the company/contact/signal data changed ("data"). */
  outdated: boolean;
  outdatedReason: "profile" | "data" | null;
  excluded: boolean;
  coveragePercent: number | null;
  status: ScoreStatus;
  score: number | null;
  grade: Grade | null;
  scoredAt: string | null;
};

export type CompanyDetail = {
  id: string;
  name: string;
  websiteUrl: string | null;
  domain: string | null;
  phone: string | null;
  location: string | null;
  address: string | null;
  employees: string | null;
  industry: string | null;
  description: string | null;
  qualification: QualificationState;
  qualificationReason: string | null;
  notes: string | null;
  updatedAt: string;
  restriction: { id: string; reason: string | null } | null;
  contacts: ContactView[];
  evidence: EvidenceView[];
  evidenceTotal: number;
  scores: ScoreView[];
  /** Fit against the workspace default ICP (null when there is no default profile). */
  fit: FitSummary | null;
};

export type FitSummary = {
  profileId: string;
  profileName: string;
  /** The profile's current revision. */
  revision: number;
  state: "current" | "excluded" | "outdated" | "none";
  grade: Grade | null;
  score: number | null;
  coveragePercent: number | null;
  outdatedReason: "profile" | "data" | null;
  /** Configured, enabled signals of the profile: how many have an observation for its current revision. */
  signals: { confirmed: number; unknown: number };
};
