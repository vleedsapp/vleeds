import "server-only";

import {
  activeSuppressions,
  commitContactCandidate,
  companySummaries,
  contactRunCreditMillis,
  contactsByEmails,
  contactsForMerge,
  insertContactCandidates,
  listContactCandidates,
  recordContactSearchUsage,
  updateContactRun,
  type ContactRunRecord,
} from "@/lib/dal";
import type { ContactDiscoveryProvider } from "@/lib/providers/contact-discovery/types";
import {
  classifyCandidate,
  contactMessage,
  matchRole,
  orderCandidates,
  planContactCommit,
  relevanceLabels,
  RETRYABLE_CONTACT_ERRORS,
  toNormalizedContact,
  type ContactSearchView,
} from "./model";

/**
 * Orchestrates ONE contact search on explicit user actions (server-side):
 *   provider search (one page, ≤ 10) → usage event (estimated credits) →
 *   classification against this workspace's contacts → candidates for review
 *   → selected candidates saved through commit_contact_candidate/ingest_lead.
 * Nothing is searched, paged or retried automatically beyond the client's one
 * bounded transport retry.
 */

export async function runContactSearch(
  workspaceId: string,
  run: ContactRunRecord,
  provider: ContactDiscoveryProvider,
): Promise<{ error: { code: string } | null; skipped: number }> {
  const r = await provider.searchContacts({
    domain: run.domain,
    titles: run.titles.map((t) => t.title),
    decisionMakerOnly: run.decisionMakerOnly,
    limit: run.requestedLimit,
  });
  if (r.usage) await recordContactSearchUsage(workspaceId, run.id, run.companyId, provider.providerKey, r.usage);
  if (!r.ok) {
    await updateContactRun(workspaceId, run.id, ["searching"], { status: "failed", error_code: r.code });
    return { error: { code: r.code }, skipped: 0 };
  }

  const companyContacts = await contactsForMerge(workspaceId, run.companyId);
  const owners = await contactsByEmails(workspaceId, r.candidates.map((c) => c.normalizedEmail));
  const rows = r.candidates.map((c, position) => ({
    ...c,
    position,
    roleMatch: matchRole(c.jobTitle, run.titles, c.providerDecisionMaker),
    ...classifyCandidate(c, run.companyId, companyContacts, owners),
  }));
  const stored = await insertContactCandidates(workspaceId, run.id, run.companyId, rows);
  if (!stored.ok) {
    await updateContactRun(workspaceId, run.id, ["searching"], { status: "failed", error_code: "storage" });
    return { error: { code: "storage" }, skipped: 0 };
  }
  // No results: nothing to review; the run is finished (another search is a new, explicit action).
  await updateContactRun(
    workspaceId,
    run.id,
    ["searching"],
    rows.length ? { status: "review", error_code: null } : { status: "completed", error_code: null, completed_at: new Date().toISOString() },
  );
  return { error: null, skipped: r.skipped };
}

export type SaveContactsOutcome = { created: number; merged: number; evidenceAdded: number; notes: string[]; failed: number };

/** Saves every selected, not-yet-saved candidate (presentation order). Idempotent: saved ones are skipped. */
export async function saveSelectedContacts(
  workspaceId: string,
  run: ContactRunRecord,
  provider: { providerKey: string; label: string },
): Promise<SaveContactsOutcome> {
  const candidates = orderCandidates(await listContactCandidates(workspaceId, run.id)).filter((c) => c.decision === "selected");
  const existing = await contactsForMerge(workspaceId, run.companyId);
  let primaryAvailable = !existing.some((k) => k.is_primary);
  const out: SaveContactsOutcome = { created: 0, merged: 0, evidenceAdded: 0, notes: [], failed: 0 };

  for (const c of candidates) {
    if (c.commitResult) {
      out[c.commitResult === "created" ? "created" : "merged"]++;
      continue;
    }
    const contact = toNormalizedContact(c);
    const target = c.selectedAction === "merge" ? (existing.find((k) => k.id === c.matchedContactId) ?? null) : null;
    const plan = contact && c.selectedAction ? planContactCommit(contact, c, c.selectedAction, target, provider, primaryAvailable) : null;
    if (!plan) {
      out.failed++;
      out.notes.push(`${c.fullName} wasn't saved: the contact it matched is no longer available.`);
      continue;
    }
    const r = await commitContactCandidate(workspaceId, c.id, plan.contact, plan.evidence);
    if (!r.ok) {
      out.failed++;
      out.notes.push(r.reason === "conflict" ? `${c.fullName} wasn't saved: the email already belongs to a contact.` : `${c.fullName} couldn't be saved. Try again.`);
      continue;
    }
    if (r.data.commitResult === "created") {
      out.created++;
      if (plan.contact.primary_if_none) primaryAvailable = false;
    } else out.merged++;
    if (!r.data.alreadyCommitted) out.evidenceAdded += plan.evidence.length;
    out.notes.push(...plan.notes.map((n) => `${c.fullName}: ${n}`));
  }
  if (out.failed === 0) {
    await updateContactRun(workspaceId, run.id, ["review"], { status: "completed", completed_at: new Date().toISOString() });
  }
  return out;
}

/** What the sheet shows for a run: ordered candidates with match/restriction context. */
export async function contactSearchView(
  workspaceId: string,
  run: ContactRunRecord,
  provider: { label: string },
  extra: { error?: { code: string } | null; skipped?: number; outcome?: ContactSearchView["outcome"] } = {},
): Promise<ContactSearchView> {
  const candidates = orderCandidates(await listContactCandidates(workspaceId, run.id));
  const atCompany = await contactsForMerge(workspaceId, run.companyId);
  const conflictEmails = candidates.filter((c) => c.matchState === "conflict").map((c) => c.normalizedEmail);
  const elsewhere = conflictEmails.length ? await contactsByEmails(workspaceId, conflictEmails) : [];
  const otherCompanies = await companySummaries(workspaceId, elsewhere.map((e) => e.company_id));
  const restricted = new Set((await activeSuppressions(workspaceId, [run.companyId])).filter((s) => s.scope === "contact").map((s) => s.contactId));

  const code = extra.error?.code ?? (run.status === "failed" ? run.errorCode : null);
  return {
    runId: run.id,
    status: run.status,
    providerLabel: provider.label,
    domain: run.domain,
    titles: run.titles,
    decisionMakerOnly: run.decisionMakerOnly,
    skipped: extra.skipped ?? 0,
    candidates: candidates.map((c) => {
      const here = c.matchedContactId ? atCompany.find((k) => k.id === c.matchedContactId) : undefined;
      const there = c.matchState === "conflict" ? elsewhere.find((e) => e.id === c.matchedContactId) : undefined;
      return {
        id: c.id,
        fullName: c.fullName,
        jobTitle: c.jobTitle,
        email: c.email,
        phone: c.phone,
        linkedinUrl: c.linkedinUrl,
        department: c.providerDepartment,
        verificationStatus: c.verificationStatus,
        confidence: c.confidence,
        labels: relevanceLabels(c, provider.label),
        roleMatch: c.roleMatch,
        matchState: c.matchState,
        matched: here
          ? { id: here.id, name: here.full_name, restricted: restricted.has(here.id), companyName: null }
          : there
            ? { id: there.id, name: there.full_name, restricted: false, companyName: otherCompanies.get(there.company_id)?.name ?? null }
            : null,
        decision: c.decision,
        selectedAction: c.selectedAction,
        commitResult: c.commitResult,
      };
    }),
    error: code ? { code, message: contactMessage(code), retry: RETRYABLE_CONTACT_ERRORS.has(code) } : null,
    outcome: extra.outcome ?? null,
    creditsUsedMillis: await contactRunCreditMillis(workspaceId, run.id),
  };
}
