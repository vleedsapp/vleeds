import { z } from "zod";
import { comparisonKey, type DecisionMaker, type DecisionMakerPriority, type SeniorityHint } from "@/lib/config/icp";
import { contactColumns, evidenceFor, type EvidenceItem } from "@/lib/imports/ingest";
import { planContactMerge, type ExistingContact } from "@/lib/imports/merge";
import type { NormalizedContact } from "@/lib/imports/rows";
import { matchContact } from "@/lib/lead-core/dedupe";
import { contactFieldsSchema } from "@/lib/lead-core/schemas";
import type { ContactCandidate, VerificationStatus } from "@/lib/providers/contact-discovery/types";
import { containsPhrase, textKey } from "@/lib/scoring/text";

/**
 * Contact-discovery rules (P1-E5), pure and provider-neutral:
 *   - which job titles a search uses (ICP decision-maker roles, ordered, ≤ 10)
 *   - how a returned person's title relates to them (transparent labels, no score)
 *   - presentation order
 *   - matching against existing contacts (the P1-E1/P1-E2 contact rules)
 *   - what selecting/saving a candidate writes (the P1-E2 contact planner)
 */

export const CONTACT_RUN_STATUSES = ["draft", "searching", "review", "completed", "cancelled", "failed"] as const;
export type ContactRunStatus = (typeof CONTACT_RUN_STATUSES)[number];

export const ROLE_MATCHES = ["primary", "secondary", "fallback", "search_title", "decision_maker", "other"] as const;
export type RoleMatch = (typeof ROLE_MATCHES)[number];

export const CONTACT_MATCH_STATES = ["new", "existing_contact", "possible_duplicate", "conflict"] as const;
export type ContactMatchState = (typeof CONTACT_MATCH_STATES)[number];

export type CandidateDecision = "unreviewed" | "selected" | "dismissed";
export type SelectedAction = "create" | "merge";

export const MAX_SEARCH_TITLES = 10;

// -----------------------------------------------------------------------------
// Target titles
// -----------------------------------------------------------------------------

/** A title used by one search: from the ICP (with its priority) or typed for this search only. */
export type TargetTitle = { title: string; priority: DecisionMakerPriority | "search" };

const PRIORITY_ORDER: Record<TargetTitle["priority"], number> = { primary: 0, secondary: 1, fallback: 2, search: 3 };

/** ICP roles ordered primary → secondary → fallback, then configured order. */
export function orderedRoles(roles: DecisionMaker[]): DecisionMaker[] {
  return roles.map((r, i) => ({ r, i })).sort((a, b) => PRIORITY_ORDER[a.r.priority] - PRIORITY_ORDER[b.r.priority] || a.i - b.i).map((x) => x.r);
}

/** The roles preselected for a search: the first 10 distinct titles in priority order. */
export function defaultRoleIds(roles: DecisionMaker[]): string[] {
  return buildTargetTitles(roles, null, []).ids;
}

/**
 * The titles one search will send: chosen ICP roles (or all, up to 10) in
 * priority order, then titles typed for this search. Duplicates (by the ICP
 * comparison key) are dropped; at most 10.
 */
export function buildTargetTitles(roles: DecisionMaker[], chosenIds: string[] | null, manual: string[]): { titles: TargetTitle[]; ids: string[] } {
  const seen = new Set<string>();
  const titles: TargetTitle[] = [];
  const ids: string[] = [];
  for (const r of orderedRoles(roles)) {
    if (chosenIds && !chosenIds.includes(r.id)) continue;
    const key = comparisonKey(r.title);
    if (!key || seen.has(key) || titles.length >= MAX_SEARCH_TITLES) continue;
    seen.add(key);
    titles.push({ title: r.title.trim(), priority: r.priority });
    ids.push(r.id);
  }
  for (const m of manual) {
    const t = m.replace(/\s+/g, " ").trim();
    const key = comparisonKey(t);
    if (!key || seen.has(key) || titles.length >= MAX_SEARCH_TITLES) continue;
    seen.add(key);
    titles.push({ title: t, priority: "search" });
  }
  return { titles, ids };
}

// -----------------------------------------------------------------------------
// Role matching (deterministic, explainable)
// -----------------------------------------------------------------------------

/** Same normalization and whole-word matching as scoring (src/lib/scoring/text.ts). */
export const titleKey = textKey;

/** True when `target` appears in `title` as whole words ("Senior Operations Manager" contains "operations manager"). */
export const titleContains = (title: string, target: string) => containsPhrase(title, target);

const PRIORITY_MATCH: Record<TargetTitle["priority"], RoleMatch> = { primary: "primary", secondary: "secondary", fallback: "fallback", search: "search_title" };

/** Highest-priority configured title the job title contains; else the provider's decision-maker flag; else "other". */
export function matchRole(jobTitle: string | null, targets: TargetTitle[], providerDecisionMaker: boolean | null): RoleMatch {
  if (jobTitle) {
    const hits = targets.filter((t) => titleContains(jobTitle, t.title)).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    if (hits.length) return PRIORITY_MATCH[hits[0].priority];
  }
  return providerDecisionMaker ? "decision_maker" : "other";
}

export const ROLE_MATCH_LABEL: Record<RoleMatch, string> = {
  primary: "Primary title match",
  secondary: "Secondary title match",
  fallback: "Fallback title match",
  search_title: "Search title match",
  decision_maker: "No configured-title match",
  other: "No configured-title match",
};

/** Transparent relevance labels (text, never a combined score). */
export function relevanceLabels(c: { roleMatch: RoleMatch; providerDecisionMaker: boolean | null; providerSeniority: string | null }, providerLabel: string): string[] {
  const out = [ROLE_MATCH_LABEL[c.roleMatch]];
  if (c.providerDecisionMaker) out.push(`${providerLabel} decision maker`);
  if (c.providerSeniority === "executive") out.push("Executive seniority");
  return out;
}

/**
 * Presentation order: primary → secondary → fallback → search-title matches
 * → provider-classified decision makers → others; provider order within a
 * group (`position`).
 */
const GROUP: Record<RoleMatch, number> = { primary: 0, secondary: 1, fallback: 2, search_title: 3, decision_maker: 4, other: 5 };
export function orderCandidates<T extends { roleMatch: RoleMatch; position: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => GROUP[a.roleMatch] - GROUP[b.roleMatch] || a.position - b.position);
}

// -----------------------------------------------------------------------------
// Matching against existing contacts (P1-E1 contact hierarchy)
// -----------------------------------------------------------------------------

export type CompanyContact = { id: string; company_id: string; full_name: string; normalized_email: string | null };

/**
 * email at this company → existing_contact; email at another company →
 * conflict (never moved or duplicated); same name at this company →
 * possible_duplicate (review); otherwise new. Phone is never used.
 */
export function classifyCandidate(
  candidate: Pick<ContactCandidate, "fullName" | "email" | "normalizedEmail">,
  companyId: string,
  companyContacts: CompanyContact[],
  emailOwners: CompanyContact[],
): { matchState: ContactMatchState; matchedContactId: string | null } {
  const elsewhere = emailOwners.find((o) => o.normalized_email === candidate.normalizedEmail && o.company_id !== companyId);
  const m = matchContact(
    { fullName: candidate.fullName, companyId, email: candidate.email },
    companyContacts.map((k) => ({ id: k.id, companyId: k.company_id, fullName: k.full_name, normalizedEmail: k.normalized_email, externalIds: [] })),
  );
  if (m.outcome === "match") return { matchState: "existing_contact", matchedContactId: m.id };
  if (elsewhere) return { matchState: "conflict", matchedContactId: elsewhere.id };
  if (m.outcome === "review") return { matchState: "possible_duplicate", matchedContactId: m.ids[0] };
  return { matchState: "new", matchedContactId: null };
}

// -----------------------------------------------------------------------------
// Decisions
// -----------------------------------------------------------------------------

export const decisionActionSchema = z.enum(["select", "select_new", "select_merge", "dismiss", "reset"]);
export type CandidateAction = z.output<typeof decisionActionSchema>;

/** What an action means for a candidate's match; null = not allowed. */
export function decisionFor(matchState: ContactMatchState, action: CandidateAction): { decision: CandidateDecision; selectedAction: SelectedAction | null } | null {
  if (action === "dismiss") return { decision: "dismissed", selectedAction: null };
  if (action === "reset") return { decision: "unreviewed", selectedAction: null };
  if (matchState === "conflict") return null;
  if (matchState === "new") return action === "select" || action === "select_new" ? { decision: "selected", selectedAction: "create" } : null;
  if (matchState === "existing_contact") return action === "select" || action === "select_merge" ? { decision: "selected", selectedAction: "merge" } : null;
  // possible duplicate: the user must say which (no silent merge)
  if (action === "select_new") return { decision: "selected", selectedAction: "create" };
  if (action === "select_merge") return { decision: "selected", selectedAction: "merge" };
  return null;
}

// -----------------------------------------------------------------------------
// Commit planning
// -----------------------------------------------------------------------------

/** Only a safe mapping into Vleeds' seniority hints; everything else stays empty. */
export function vleedsSeniority(providerSeniority: string | null): SeniorityHint | null {
  return providerSeniority === "executive" ? "executive" : null;
}

export type StoredCandidate = {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string;
  phone: string | null;
  linkedinUrl: string | null;
  providerSeniority: string | null;
  providerDepartment: string | null;
  providerDecisionMaker: boolean | null;
  verificationStatus: VerificationStatus | null;
};

/** Candidate → lead-core contact (same validation as manual/CSV contacts). A rejected optional field is dropped. */
export function toNormalizedContact(c: StoredCandidate): NormalizedContact | null {
  const input: Record<string, unknown> = {
    fullName: c.fullName,
    firstName: c.firstName,
    lastName: c.lastName,
    jobTitle: c.jobTitle,
    seniority: vleedsSeniority(c.providerSeniority),
    email: c.email,
    phone: c.phone,
    linkedinUrl: c.linkedinUrl,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const parsed = contactFieldsSchema.safeParse(input);
    if (parsed.success) {
      const k = parsed.data;
      return {
        fullName: k.fullName!, firstName: k.firstName, lastName: k.lastName, jobTitle: k.jobTitle, seniority: k.seniority,
        email: k.email, normalizedEmail: k.normalizedEmail, phone: k.phone, phoneNormalized: k.phoneNormalized, linkedinUrl: k.linkedinUrl, notes: null,
      };
    }
    const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    if (bad.has("fullName") || bad.has("email")) return null;
    for (const k of bad) input[k] = null;
  }
  return null;
}

export type ContactCommitPlan = {
  contact: { id?: string; fields: Record<string, unknown>; primary_if_none?: boolean };
  evidence: EvidenceItem[];
  notes: string[];
};

/**
 * One selected candidate → the ingest_lead contact write + evidence:
 *   create: the contact's columns (primary only if the company has none and
 *           this is the first saved contact)
 *   merge:  the P1-E2 conservative contact merge (fill empty fields, keep
 *           conflicts and report them, never rename)
 * Evidence: one row per non-empty observed field, stamped with the provider
 * key (no record id: Domain Search has none), plus provider context fields.
 */
export function planContactCommit(
  contact: NormalizedContact,
  candidate: StoredCandidate,
  action: SelectedAction,
  existing: (ExistingContact & { id: string }) | null,
  provider: { providerKey: string; label: string },
  primaryIfNone: boolean,
): ContactCommitPlan | null {
  const notes: string[] = [];
  let write: ContactCommitPlan["contact"];
  if (action === "merge") {
    if (!existing) return null;
    const plan = planContactMerge(existing, contact);
    notes.push(...plan.conflicts.map((c) => c.replace(/\(import had/g, `(${provider.label} had`)));
    write = { id: existing.id, fields: plan.patch };
  } else {
    write = { fields: contactColumns(contact), primary_if_none: primaryIfNone };
  }
  const evidence = evidenceFor(null, contact, "api", { providerKey: provider.providerKey, externalRecordId: null });
  const add = (field_key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    evidence.push({ subject: "contact", field_key, observed_value: value, source_kind: "api", provider_key: provider.providerKey });
  };
  if (!evidence.some((e) => e.field_key === "contact.seniority")) add("contact.seniority", candidate.providerSeniority);
  add("contact.department", candidate.providerDepartment);
  add("contact.verification_status", candidate.verificationStatus);
  if (candidate.providerDecisionMaker !== null) add("contact.provider_decision_maker", candidate.providerDecisionMaker);
  return { contact: write, evidence, notes };
}

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

export const startContactSearchSchema = z.strictObject({
  companyId: z.uuid(),
  icpProfileId: z.uuid().nullable(),
  /** ICP role ids to include (server re-reads the profile; unknown ids are ignored). */
  roleIds: z.array(z.uuid()).max(50),
  /** Titles typed for this search only (never written back to the ICP). */
  manualTitles: z
    .array(z.string().transform((v) => v.replace(/\s+/g, " ").trim()).pipe(z.string().max(200, "Use 200 characters or fewer per title.")))
    .max(MAX_SEARCH_TITLES, `Use at most ${MAX_SEARCH_TITLES} titles.`),
  decisionMakerOnly: z.boolean(),
});
export type StartContactSearchInput = z.output<typeof startContactSearchSchema>;

// -----------------------------------------------------------------------------
// What the browser receives
// -----------------------------------------------------------------------------

export type ContactCandidateView = {
  id: string;
  fullName: string;
  jobTitle: string | null;
  email: string;
  phone: string | null;
  linkedinUrl: string | null;
  department: string | null;
  verificationStatus: VerificationStatus | null;
  confidence: number | null;
  labels: string[];
  roleMatch: RoleMatch;
  matchState: ContactMatchState;
  matched: { id: string; name: string; restricted: boolean; companyName: string | null } | null;
  decision: CandidateDecision;
  selectedAction: SelectedAction | null;
  commitResult: "created" | "merged" | null;
};

export type ContactSearchView = {
  runId: string;
  status: ContactRunStatus;
  providerLabel: string;
  domain: string;
  titles: TargetTitle[];
  decisionMakerOnly: boolean;
  candidates: ContactCandidateView[];
  skipped: number;
  error: { code: string; message: string; retry: boolean } | null;
  outcome: { created: number; merged: number; evidenceAdded: number; notes: string[] } | null;
  creditsUsedMillis: number;
};

export type ContactActionResult = { ok: true; view: ContactSearchView } | { ok: false; error: string; code: string; view: ContactSearchView | null };

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  valid: "Valid",
  accept_all: "Accept-all",
  unknown: "Unknown",
  invalid: "Invalid",
};

export const CONTACT_MESSAGES: Record<string, string> = {
  not_configured: "Contact discovery is not configured yet.",
  no_domain: "Add or enrich this company with a domain before finding contacts.",
  restricted_company: "This company is marked do not contact.",
  no_titles: "Choose at least one target role, type a title, or search only for classified decision makers.",
  quota_exhausted: "The provider's monthly quota for this account appears to be used up. Usage resets with the provider's plan; check the provider account for details.",
  rate_limited: "The provider is limiting requests right now. Wait a minute and try again.",
  timeout: "The provider took too long to respond. Try again in a moment.",
  unavailable: "The provider is temporarily unavailable. Try again in a moment.",
  malformed: "The provider returned something Vleeds couldn't read. Try again.",
  setup: "The provider rejected the request. Its setup (API key) needs checking by an owner.",
  invalid_request: "The provider couldn't run this search. Adjust the target roles and try again.",
  restricted: "This data isn't available from the provider.",
  storage: "The results couldn't be saved. Try again.",
  stale: "This search changed in the meantime. Close it and try again.",
  decision: "That choice isn't available for this person.",
  conflict: "This email already belongs to a contact; nothing was duplicated.",
  nothing_selected: "Select at least one contact to save.",
};

export const RETRYABLE_CONTACT_ERRORS = new Set(["timeout", "unavailable", "rate_limited", "malformed", "storage"]);

export function contactMessage(code: string): string {
  return CONTACT_MESSAGES[code] ?? "Something went wrong. Try again.";
}
