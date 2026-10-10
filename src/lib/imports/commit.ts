import { matchContact } from "@/lib/lead-core/dedupe";
import type { Decision, MatchState } from "./classify";
import { companyColumns, contactColumns, evidenceFor, type EvidenceItem, type EvidenceProvider, type IngestSource } from "./ingest";
import { planCompanyMerge, planContactMerge, type ExistingCompany, type ExistingContact } from "./merge";
import type { StagedRow } from "./rows";
import type { CommitResult } from "./summary";

/**
 * Decides what committing ONE row means, from the row and the CURRENT data
 * (read just before the write). Pure, so the rules are unit-tested; the DAL
 * executes the result through public.ingest_lead() as one transaction.
 *
 * Idempotency: a row that already has a commit result is never planned again
 * (and ingest_lead() refuses it under a row lock as a second line of defence).
 */

export type CommitRow = {
  commitResult: CommitResult | null;
  matchState: MatchState;
  decision: Decision | null;
  staged: StagedRow | null;
};

export type CommitContext = {
  /** The company to merge into (resolved from the row's match, or the earlier row that created it). */
  target: (ExistingCompany & { id: string }) | null;
  /** Active contacts of the target company. */
  targetContacts: (ExistingContact & { id: string; company_id: string })[];
  /** Active contacts anywhere in the workspace that have the row's email. */
  emailOwners: { id: string; company_id: string; full_name: string }[];
};

export type IngestCall = {
  company: { id?: string; fields: Record<string, unknown> };
  contact: { id?: string; fields: Record<string, unknown>; primary_if_none?: boolean } | null;
  evidence: EvidenceItem[];
};

export type CommitPlan =
  | { kind: "already_committed" }
  | { kind: "skip"; notes: string[] }
  | { kind: "fail"; notes: string[] }
  | { kind: "ingest"; call: IngestCall; notes: string[] };

/**
 * Options for non-CSV callers (P1-E4 enrichment): the provider identity that
 * evidence carries, and the source label used in conflict notes.
 */
export type CommitOptions = { provider?: EvidenceProvider; sourceLabel?: string };

export function planRowCommit(row: CommitRow, ctx: CommitContext, source: IngestSource = "csv", options: CommitOptions = {}): CommitPlan {
  if (row.commitResult !== null) return { kind: "already_committed" };
  if (row.matchState === "invalid" || !row.staged?.company) return { kind: "skip", notes: ["Not imported: the row has errors."] };
  if (row.decision === null) return { kind: "skip", notes: ["Not imported: no decision was made for this possible duplicate."] };
  if (row.decision === "skip") return { kind: "skip", notes: ["Skipped by decision."] };

  const { company, contact } = row.staged;
  const notes: string[] = [];
  let call: IngestCall;

  if (row.decision === "merge") {
    if (!ctx.target) return { kind: "fail", notes: ["The company to merge into is no longer available."] };
    const plan = planCompanyMerge(ctx.target, company, options.sourceLabel);
    notes.push(...plan.conflicts);
    call = { company: { id: ctx.target.id, fields: plan.patch }, contact: null, evidence: evidenceFor(company, null, source, options.provider) };
  } else {
    call = { company: { fields: companyColumns(company) }, contact: null, evidence: evidenceFor(company, null, source, options.provider) };
  }

  if (contact) {
    const merging = row.decision === "merge" && ctx.target;
    // Email is a strong identity: if it belongs to someone at ANOTHER company, never move or duplicate them.
    const owner = contact.normalizedEmail ? ctx.emailOwners.find((o) => !merging || o.company_id !== ctx.target!.id) : undefined;
    if (owner) {
      notes.push(`Contact not imported: ${contact.email} belongs to ${owner.full_name} at another company.`);
    } else {
      const known = merging
        ? ctx.targetContacts.map((k) => ({ id: k.id, companyId: k.company_id, fullName: k.full_name, normalizedEmail: k.normalized_email, externalIds: [] }))
        : [];
      const m = merging ? matchContact({ fullName: contact.fullName, companyId: ctx.target!.id, email: contact.email }, known) : { outcome: "new" as const };
      const matchedId = m.outcome === "match" ? m.id : m.outcome === "review" ? m.ids[0] : null;
      const existing = matchedId ? ctx.targetContacts.find((k) => k.id === matchedId) : undefined;
      if (existing) {
        const plan = planContactMerge(existing, contact);
        notes.push(...plan.conflicts);
        if (m.outcome === "review") notes.push(`Contact merged into ${existing.full_name} (same name at this company).`);
        call.contact = { id: existing.id, fields: plan.patch };
      } else {
        call.contact = { fields: contactColumns(contact), primary_if_none: true };
      }
      call.evidence.push(...evidenceFor(null, contact, source));
    }
  }

  return { kind: "ingest", call, notes };
}
