"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  companyForContactDiscovery,
  createContactRun,
  findWorkspace,
  getContactRun,
  getCurrentUser,
  listContactCandidates,
  listIcpProfilesForDiscovery,
  setContactCandidateDecision,
  updateContactRun,
  type WorkspaceDetail,
} from "@/lib/dal";
import {
  buildTargetTitles,
  contactMessage,
  decisionActionSchema,
  decisionFor,
  startContactSearchSchema,
  type ContactActionResult,
  type ContactSearchView,
} from "@/lib/contact-discovery/model";
import { contactSearchView, runContactSearch, saveSelectedContacts } from "@/lib/contact-discovery/service";
import { isUuid } from "@/lib/navigation";
import { DEFAULT_CONTACT_PROVIDER, getContactProvider } from "@/lib/providers/contact-discovery/registry";
import type { ContactDiscoveryProvider } from "@/lib/providers/contact-discovery/types";

/**
 * Decision-maker / professional contact discovery (P1-E5). Every action
 * authenticates, re-authorizes the workspace, validates input and RE-READS
 * the company (domain, restriction) and ICP roles on the server: the browser
 * only sends ids, chosen role ids and typed titles. One provider search per
 * explicit click; nothing is paged, retried or saved automatically.
 */

const NOT_AVAILABLE = "This company is not available.";

async function authorize(workspaceId: unknown): Promise<WorkspaceDetail | null> {
  if (typeof workspaceId !== "string" || !isUuid(workspaceId)) return null;
  if (!(await getCurrentUser())) redirect("/login");
  return findWorkspace(workspaceId);
}

const fail = (code: string, view: ContactSearchView | null = null, error = contactMessage(code)): ContactActionResult => ({ ok: false, code, error, view });

function configuredProvider(key: string = DEFAULT_CONTACT_PROVIDER): ContactDiscoveryProvider | null {
  const p = getContactProvider(key);
  return p?.isConfigured() ? p : null;
}

async function respond(ws: WorkspaceDetail, runId: string, provider: ContactDiscoveryProvider, extra: Parameters<typeof contactSearchView>[3] = {}): Promise<ContactActionResult> {
  const run = await getContactRun(ws.id, runId);
  if (!run) return fail("forbidden", null, NOT_AVAILABLE);
  const view = await contactSearchView(ws.id, run, provider, extra);
  return view.error && (extra.error || run.status === "failed") ? { ok: false, code: view.error.code, error: view.error.message, view } : { ok: true, view };
}

/** Starts a search: re-reads company + ICP, builds the titles, runs ONE provider request. */
export async function startContactSearch(workspaceId: string, input: unknown): Promise<ContactActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail("forbidden", null, NOT_AVAILABLE);
  const parsed = startContactSearchSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", null, parsed.error.issues[0]?.message ?? "Check the search and try again.");
  const req = parsed.data;
  const provider = configuredProvider();
  if (!provider) return fail("not_configured");

  const company = await companyForContactDiscovery(ws.id, req.companyId);
  if (!company) return fail("forbidden", null, NOT_AVAILABLE);
  if (!company.domain) return fail("no_domain");
  if (company.restricted) return fail("restricted_company");

  let icp: { id: string; revision: number } | null = null;
  let roles: Parameters<typeof buildTargetTitles>[0] = [];
  if (req.icpProfileId) {
    const profile = (await listIcpProfilesForDiscovery(ws.id)).find((p) => p.id === req.icpProfileId);
    if (!profile) return fail("invalid", null, "That ideal customer profile is not available.");
    icp = { id: profile.id, revision: profile.revision };
    roles = profile.decisionMakers;
  }
  const { titles } = buildTargetTitles(roles, req.roleIds, req.manualTitles);
  if (!titles.length && !req.decisionMakerOnly) return fail("no_titles");

  const created = await createContactRun(ws.id, {
    companyId: company.id,
    icpProfileId: icp?.id ?? null,
    icpRevision: icp?.revision ?? null,
    providerKey: provider.providerKey,
    domain: company.domain,
    titles,
    decisionMakerOnly: req.decisionMakerOnly,
    limit: provider.getCapabilities().maxResults,
  });
  if (!created.ok) return fail("storage");
  const run = await getContactRun(ws.id, created.data.id);
  if (!run) return fail("storage");
  const step = await runContactSearch(ws.id, run, provider);
  refresh();
  return respond(ws, run.id, provider, step);
}

/** Retries a failed search (same criteria). Explicit; never automatic. */
export async function retryContactSearch(workspaceId: string, runId: string): Promise<ContactActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws || typeof runId !== "string") return fail("forbidden", null, NOT_AVAILABLE);
  const run = await getContactRun(ws.id, runId);
  if (!run) return fail("forbidden", null, NOT_AVAILABLE);
  const provider = configuredProvider(run.providerKey);
  if (!provider) return fail("not_configured");
  const company = await companyForContactDiscovery(ws.id, run.companyId);
  if (!company) return fail("forbidden", null, NOT_AVAILABLE);
  if (company.restricted) return fail("restricted_company");
  const moved = await updateContactRun(ws.id, run.id, ["failed"], { status: "searching", error_code: null });
  if (!moved.ok) return fail("stale");
  const step = await runContactSearch(ws.id, { ...run, status: "searching" }, provider);
  refresh();
  return respond(ws, run.id, provider, step);
}

/** Select / select as new / select as merge / dismiss / undo for one candidate. */
export async function decideContactCandidate(workspaceId: string, runId: string, candidateId: string, action: unknown): Promise<ContactActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws || typeof runId !== "string" || typeof candidateId !== "string" || !isUuid(candidateId)) return fail("forbidden", null, NOT_AVAILABLE);
  const run = await getContactRun(ws.id, runId);
  const provider = run ? getContactProvider(run.providerKey) : null;
  if (!run || !provider) return fail("forbidden", null, NOT_AVAILABLE);
  if (run.status !== "review") return fail("stale");
  const a = decisionActionSchema.safeParse(action);
  const candidate = (await listContactCandidates(ws.id, run.id)).find((c) => c.id === candidateId);
  if (!a.success || !candidate) return fail("decision");
  const d = decisionFor(candidate.matchState, a.data);
  if (!d) return fail("decision", await contactSearchView(ws.id, run, provider));
  const r = await setContactCandidateDecision(ws.id, run.id, candidate.id, d.decision, d.selectedAction);
  if (!r.ok) return fail(r.reason === "stale" ? "stale" : "decision", await contactSearchView(ws.id, run, provider));
  return respond(ws, run.id, provider);
}

/** Saves the selected candidates as contacts (one transaction each; repeatable without duplicates). */
export async function saveContactSelection(workspaceId: string, runId: string): Promise<ContactActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws || typeof runId !== "string") return fail("forbidden", null, NOT_AVAILABLE);
  const run = await getContactRun(ws.id, runId);
  const provider = run ? getContactProvider(run.providerKey) : null;
  if (!run || !provider) return fail("forbidden", null, NOT_AVAILABLE);
  if (run.status !== "review") return fail("stale");
  if (run.selectedCount === 0) return fail("nothing_selected", await contactSearchView(ws.id, run, provider));
  const company = await companyForContactDiscovery(ws.id, run.companyId);
  if (!company) return fail("forbidden", null, NOT_AVAILABLE);
  if (company.restricted) return fail("restricted_company", await contactSearchView(ws.id, run, provider));
  const out = await saveSelectedContacts(ws.id, run, provider);
  refresh();
  const outcome = { created: out.created, merged: out.merged, evidenceAdded: out.evidenceAdded, notes: out.notes };
  if (out.failed) return fail("storage", (await respond(ws, run.id, provider, { outcome })).view, out.notes.at(-1) ?? contactMessage("storage"));
  return respond(ws, run.id, provider, { outcome });
}

/** Cancels an unfinished search; nothing is saved. */
export async function cancelContactSearch(workspaceId: string, runId: string): Promise<{ ok: boolean }> {
  const ws = await authorize(workspaceId);
  if (!ws || typeof runId !== "string") return { ok: false };
  const run = await getContactRun(ws.id, runId);
  if (!run || run.status === "completed" || run.status === "cancelled") return { ok: true };
  const r = await updateContactRun(ws.id, run.id, ["draft", "searching", "review", "failed"], { status: "cancelled", cancelled_at: new Date().toISOString() });
  refresh();
  return { ok: r.ok };
}
