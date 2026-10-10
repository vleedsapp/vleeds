"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { countryName } from "@/lib/config/countries";
import {
  createDiscoveryRun,
  findWorkspace,
  getCandidate,
  getCurrentUser,
  getDiscoveryRun,
  listIcpProfilesForDiscovery,
  setCandidateDecision,
  updateDiscoveryRun,
  type DiscoveryRunView,
  type WorkspaceDetail,
} from "@/lib/dal";
import {
  cursorSchema,
  decisionActionSchema,
  decisionFor,
  discoverySearchSchema,
  PROVIDER_ERROR_MESSAGES,
  runIsOpen,
  type CandidateDecision,
  type TransientCandidateView,
  type UsageView,
} from "@/lib/discovery/model";
import { runDiscoveryPage, type PageOutcome } from "@/lib/discovery/service";
import { isUuid } from "@/lib/navigation";
import { DEFAULT_DISCOVERY_PROVIDER, getDiscoveryProvider } from "@/lib/providers/company-discovery/registry";
import type { DiscoveryGeography } from "@/lib/providers/company-discovery/types";

/**
 * Interactive discovery. Every action authenticates, re-authorizes the
 * workspace, validates its input, and talks to providers ONLY on the server
 * (the browser never sees API keys or provider responses, only the
 * transient candidate view). Errors are fixed, calm messages.
 */

export type ActiveRun = { id: string; status: DiscoveryRunView["status"]; hasMore: boolean };

export type DiscoveryActionResult =
  | { ok: true; run: ActiveRun; candidates: TransientCandidateView[]; nextCursor: string | null; usage: UsageView }
  | { ok: false; error: string; code: string; run: ActiveRun | null; usage: UsageView | null };

const NOT_AVAILABLE = "This search is not available.";
const GENERIC = "Something went wrong. Try again.";

async function authorize(workspaceId: unknown): Promise<WorkspaceDetail | null> {
  if (typeof workspaceId !== "string" || !isUuid(workspaceId)) return null;
  if (!(await getCurrentUser())) redirect("/login");
  return findWorkspace(workspaceId);
}

const message = (code: string) => PROVIDER_ERROR_MESSAGES[code] ?? GENERIC;
const fail = (code: string, error: string, run: ActiveRun | null = null, usage: UsageView | null = null): DiscoveryActionResult => ({ ok: false, error, code, run, usage });

async function finish(ws: WorkspaceDetail, runId: string, outcome: PageOutcome): Promise<DiscoveryActionResult> {
  const run = await getDiscoveryRun(ws.id, runId);
  const active: ActiveRun | null = run ? { id: run.id, status: run.status, hasMore: run.hasMore } : null;
  refresh();
  if (!outcome.ok) return fail(outcome.code, message(outcome.code), active, outcome.usage);
  return { ok: true, run: active!, candidates: outcome.candidates, nextCursor: outcome.nextCursor, usage: outcome.usage };
}

/** Starts a new discovery run and fetches its first page. */
export async function startDiscovery(workspaceId: string, input: unknown): Promise<DiscoveryActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail("forbidden", NOT_AVAILABLE);
  const parsed = discoverySearchSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the search and try again.");
  const req = parsed.data;

  const provider = getDiscoveryProvider(DEFAULT_DISCOVERY_PROVIDER);
  if (!provider || !provider.isConfigured()) return fail("not_configured", message("not_configured"));

  // The ICP and its geographies are re-read on the server; the browser only sends ids.
  let icp: { id: string; revision: number } | null = null;
  let geography: DiscoveryGeography | null = null;
  if (req.icpProfileId) {
    const profile = (await listIcpProfilesForDiscovery(ws.id)).find((p) => p.id === req.icpProfileId);
    if (!profile) return fail("invalid", "That ideal customer profile is not available.");
    icp = { id: profile.id, revision: profile.revision };
    if (req.geography.kind === "icp") {
      const g = profile.geographies.find((x) => x.id === (req.geography as { id: string }).id);
      if (!g) return fail("invalid", "That geography is not part of the selected profile.");
      geography = { countryCode: g.countryCode, countryName: g.countryName, region: g.region, city: g.city, label: g.label };
    }
  } else if (req.geography.kind === "icp") {
    return fail("invalid", "Choose a profile to use its geographies.");
  }
  if (req.geography.kind === "custom") {
    const g = req.geography;
    geography = { countryCode: g.countryCode, countryName: countryName(g.countryCode), region: g.region, city: g.city, label: null };
  }

  const created = await createDiscoveryRun(ws.id, {
    providerKey: provider.providerKey,
    icpProfileId: icp?.id ?? null,
    icpRevision: icp?.revision ?? null,
    query: req.query,
    geography,
    regionCode: geography?.countryCode ?? null,
    pageSize: Math.min(req.pageSize, provider.getCapabilities().maxPageSize),
  });
  if (!created.ok) return fail(created.reason, GENERIC);
  const run = await getDiscoveryRun(ws.id, created.data.id);
  if (!run) return fail("failed", GENERIC);
  return finish(ws, run.id, await runDiscoveryPage(ws.id, run, provider, null));
}

async function loadRun(ws: WorkspaceDetail, runId: unknown) {
  if (typeof runId !== "string" || !isUuid(runId)) return null;
  return getDiscoveryRun(ws.id, runId);
}

/** Fetches the next provider page of a run, using the cursor the browser kept from the previous page. */
export async function loadMoreDiscovery(workspaceId: string, runId: string, cursor: unknown): Promise<DiscoveryActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail("forbidden", NOT_AVAILABLE);
  const run = await loadRun(ws, runId);
  if (!run) return fail("forbidden", NOT_AVAILABLE);
  const c = cursorSchema.safeParse(cursor);
  if (!c.success || run.status !== "review" || !run.hasMore) return fail("stale", "There are no more results for this search.", { id: run.id, status: run.status, hasMore: false });
  const provider = getDiscoveryProvider(run.providerKey);
  if (!provider || !provider.isConfigured()) return fail("not_configured", message("not_configured"));
  const moved = await updateDiscoveryRun(ws.id, run.id, ["review"], { status: "running" });
  if (!moved.ok) return fail("stale", "This search changed in the meantime. Reload the page.");
  return finish(ws, run.id, await runDiscoveryPage(ws.id, { ...run, status: "running" }, provider, c.data));
}

/** Retries a failed search from its first page (same query and geography). */
export async function retryDiscovery(workspaceId: string, runId: string): Promise<DiscoveryActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail("forbidden", NOT_AVAILABLE);
  const run = await loadRun(ws, runId);
  if (!run) return fail("forbidden", NOT_AVAILABLE);
  if (run.status !== "failed") return fail("stale", "Only a failed search can be retried.", { id: run.id, status: run.status, hasMore: run.hasMore });
  const provider = getDiscoveryProvider(run.providerKey);
  if (!provider || !provider.isConfigured()) return fail("not_configured", message("not_configured"));
  const moved = await updateDiscoveryRun(ws.id, run.id, ["failed"], { status: "running", error_code: null });
  if (!moved.ok) return fail("stale", "This search changed in the meantime. Reload the page.");
  return finish(ws, run.id, await runDiscoveryPage(ws.id, { ...run, status: "running", pagesLoaded: 0 }, provider, null));
}

export type DecisionResult = { ok: true; decision: CandidateDecision } | { ok: false; error: string };

/** Select / dismiss / reset one candidate reference. */
export async function decideCandidate(workspaceId: string, runId: string, candidateId: string, action: unknown): Promise<DecisionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return { ok: false, error: NOT_AVAILABLE };
  const run = await loadRun(ws, runId);
  if (!run || typeof candidateId !== "string") return { ok: false, error: NOT_AVAILABLE };
  if (!runIsOpen(run.status)) return { ok: false, error: "This search is finished; its decisions can't change." };
  const a = decisionActionSchema.safeParse(action);
  if (!a.success) return { ok: false, error: "That choice isn't available." };
  const candidate = await getCandidate(ws.id, run.id, candidateId);
  if (!candidate) return { ok: false, error: NOT_AVAILABLE };
  const decision = decisionFor(a.data, candidate.match_company_id);
  const r = await setCandidateDecision(ws.id, run.id, candidate.id, decision);
  if (!r.ok) return { ok: false, error: r.reason === "stale" ? "This search is finished; its decisions can't change." : GENERIC };
  refresh();
  return { ok: true, decision };
}

/** Ends the review (kept decisions stay) or cancels the search. */
export async function closeDiscovery(workspaceId: string, runId: string, how: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const ws = await authorize(workspaceId);
  if (!ws) return { ok: false, error: NOT_AVAILABLE };
  const run = await loadRun(ws, runId);
  if (!run) return { ok: false, error: NOT_AVAILABLE };
  const now = new Date().toISOString();
  const r =
    how === "complete"
      ? await updateDiscoveryRun(ws.id, run.id, ["review"], { status: "completed", completed_at: now })
      : how === "cancel"
        ? await updateDiscoveryRun(ws.id, run.id, ["running", "review", "failed"], { status: "cancelled", cancelled_at: now })
        : null;
  if (!r) return { ok: false, error: "That choice isn't available." };
  if (!r.ok) return { ok: false, error: "This search changed in the meantime. Reload the page." };
  refresh();
  return { ok: true };
}
