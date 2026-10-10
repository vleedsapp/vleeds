import "server-only";

import {
  addCandidateReferences,
  companiesLinkedToProviderIds,
  providerIdsSeenBefore,
  providerUsageTotals,
  recordProviderUsage,
  updateDiscoveryRun,
  type DiscoveryRunView,
} from "@/lib/dal";
import type { CompanyDiscoveryProvider } from "@/lib/providers/company-discovery/types";
import { candidateMatchState, type TransientCandidateView, type UsageView } from "./model";

/**
 * Runs ONE provider page for a discovery run, on an explicit user action:
 *   provider call (server-side) → usage event → durable references only
 *   (provider id + Vleeds match state) → transient view for the browser.
 *
 * Provider display content goes into the returned view and nowhere else.
 * The continuation cursor is returned to the browser for "Load more" and is
 * never stored.
 *
 * A provider without durable company fields (durableCompanyFields: false,
 * e.g. the first discovery provider) stops here. A future provider
 * whose licence allows durable company fields would continue from selected
 * candidates into the P1-E2 pipeline (normalize → classify → review →
 * ingest_lead → evidence) instead of a parallel one.
 */

export type PageOutcome =
  | { ok: true; candidates: TransientCandidateView[]; nextCursor: string | null; usage: UsageView }
  | { ok: false; code: string; usage: UsageView | null };

export async function usageView(workspaceId: string, provider: CompanyDiscoveryProvider, runId: string | null): Promise<UsageView> {
  const totals = await providerUsageTotals(workspaceId, provider.providerKey, runId);
  return { providerLabel: provider.label, ...totals };
}

export async function runDiscoveryPage(
  workspaceId: string,
  run: DiscoveryRunView,
  provider: CompanyDiscoveryProvider,
  cursor: string | null,
): Promise<PageOutcome> {
  const result = await provider.searchCompanies({
    query: run.query,
    geography: run.geography,
    pageSize: run.pageSize ?? 10,
    cursor,
  });

  // Every request is accounted for, successful or not (none is made when unconfigured).
  if (result.usage) await recordProviderUsage(workspaceId, run.id, provider.providerKey, result.usage);

  if (!result.ok) {
    // A failed first page fails the run (retry is possible); a failed "Load more" keeps what was found.
    const firstPage = run.pagesLoaded === 0;
    await updateDiscoveryRun(workspaceId, run.id, ["running"], firstPage ? { status: "failed", error_code: result.code } : { status: "review", error_code: result.code });
    return { ok: false, code: result.code, usage: result.usage ? await usageView(workspaceId, provider, run.id) : null };
  }

  const ids = result.candidates.map((c) => c.externalId);
  const [linked, seen] = await Promise.all([
    companiesLinkedToProviderIds(workspaceId, provider.providerKey, ids),
    providerIdsSeenBefore(workspaceId, provider.providerKey, ids, run.id),
  ]);
  const offset = run.candidateCount;
  const stored = await addCandidateReferences(
    workspaceId,
    run.id,
    provider.providerKey,
    result.candidates.map((c, i) => ({ externalId: c.externalId, position: offset + i, ...candidateMatchState(c.externalId, linked, seen) })),
  );
  if (!stored.ok) {
    await updateDiscoveryRun(workspaceId, run.id, ["running"], { status: "failed", error_code: "storage" });
    return { ok: false, code: "storage", usage: await usageView(workspaceId, provider, run.id) };
  }
  const byId = new Map(stored.data.map((s) => [s.external_record_id, s]));

  await updateDiscoveryRun(workspaceId, run.id, ["running"], {
    status: "review",
    pages_loaded: run.pagesLoaded + 1,
    has_more: !!result.nextCursor,
    error_code: null,
  });

  const candidates: TransientCandidateView[] = [];
  for (const c of result.candidates) {
    const s = byId.get(c.externalId);
    if (!s) continue;
    candidates.push({
      candidateId: s.id,
      providerKey: c.providerKey,
      externalId: c.externalId,
      name: c.display.name,
      address: c.display.address,
      category: c.display.category,
      sourceUrl: c.sourceUrl,
      attributions: c.attributions,
      matchState: s.match_state ?? "new",
      matchCompanyId: s.match_company_id,
      decision: s.decision,
    });
  }
  return { ok: true, candidates, nextCursor: result.nextCursor, usage: await usageView(workspaceId, provider, run.id) };
}
