import "server-only";

import type { ProviderUsage } from "@/lib/providers/company-discovery/types";
import type { EnrichmentUsage } from "@/lib/providers/company-enrichment/types";
import type { ContactSearchUsage } from "@/lib/providers/contact-discovery/types";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";

/**
 * Provider usage accounting: one append-only row per provider request batch.
 * Counts, requested field names, a status category and (for credit-based
 * providers, P1-E4) an ESTIMATED credit figure; never API keys, continuation
 * tokens or provider payloads. No prices are computed here
 * (estimated_cost_micros stays null until a configured price snapshot exists).
 */

export async function recordProviderUsage(
  workspaceId: string,
  runId: string | null,
  providerKey: string,
  usage: ProviderUsage,
): Promise<MutationResult<null>> {
  await requireUser();
  const { error } = await (await supabase()).from("provider_usage_events").insert({
    workspace_id: workspaceId,
    discovery_run_id: runId,
    provider_key: providerKey,
    operation: usage.operation,
    requested_fields: usage.requestedFields,
    request_count: usage.requestCount,
    result_count: usage.resultCount,
    status: usage.status,
    sku_hint: usage.skuHint,
    pricing_reference: usage.pricingReference,
  });
  if (error) return { ok: false, reason: failureFromDbError("recordProviderUsage", error) };
  return { ok: true, data: null };
}

/** Records one enrichment-provider call (P1-E4), linked to its enrichment run. */
export async function recordEnrichmentUsage(
  workspaceId: string,
  enrichmentRunId: string | null,
  providerKey: string,
  usage: EnrichmentUsage,
): Promise<MutationResult<null>> {
  await requireUser();
  const { error } = await (await supabase()).from("provider_usage_events").insert({
    workspace_id: workspaceId,
    enrichment_run_id: enrichmentRunId,
    provider_key: providerKey,
    operation: usage.operation,
    request_count: usage.requestCount,
    result_count: usage.resultCount,
    status: usage.status,
    estimated_credit_millis: usage.estimatedCreditMillis,
    pricing_reference: usage.creditRule,
  });
  if (error) return { ok: false, reason: failureFromDbError("recordEnrichmentUsage", error) };
  return { ok: true, data: null };
}

/** Records one contact-discovery search (P1-E5), linked to its run and company. */
export async function recordContactSearchUsage(
  workspaceId: string,
  contactRunId: string,
  companyId: string,
  providerKey: string,
  usage: ContactSearchUsage,
): Promise<MutationResult<null>> {
  await requireUser();
  const { error } = await (await supabase()).from("provider_usage_events").insert({
    workspace_id: workspaceId,
    contact_discovery_run_id: contactRunId,
    company_id: companyId,
    provider_key: providerKey,
    operation: usage.operation,
    request_count: usage.requestCount,
    result_count: usage.resultCount,
    status: usage.status,
    estimated_credit_millis: usage.estimatedCreditMillis,
    pricing_reference: usage.creditRule,
  });
  if (error) return { ok: false, reason: failureFromDbError("recordContactSearchUsage", error) };
  return { ok: true, data: null };
}

/** Estimated credits (millis) recorded for one contact search (unknown estimates count as 0). */
export async function contactRunCreditMillis(workspaceId: string, contactRunId: string): Promise<number> {
  const { data, error } = await (await supabase())
    .from("provider_usage_events")
    .select("estimated_credit_millis")
    .eq("workspace_id", workspaceId)
    .eq("contact_discovery_run_id", contactRunId)
    .limit(100);
  if (error) throw new DataAccessError("contactRunCreditMillis", error);
  return (data ?? []).reduce((t, r) => t + (r.estimated_credit_millis ?? 0), 0);
}

/** Estimated credits (millis) recorded for one enrichment run (unknown estimates count as 0). */
export async function enrichmentRunCreditMillis(workspaceId: string, enrichmentRunId: string): Promise<number> {
  const { data, error } = await (await supabase())
    .from("provider_usage_events")
    .select("estimated_credit_millis")
    .eq("workspace_id", workspaceId)
    .eq("enrichment_run_id", enrichmentRunId)
    .limit(100);
  if (error) throw new DataAccessError("enrichmentRunCreditMillis", error);
  return (data ?? []).reduce((t, r) => t + (r.estimated_credit_millis ?? 0), 0);
}

export type UsageTotals = { requests: number; results: number };

const monthStart = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
};

/** Request/result totals for one run and for the current calendar month (UTC) of a provider. */
export async function providerUsageTotals(workspaceId: string, providerKey: string, runId: string | null): Promise<{ run: UsageTotals; month: UsageTotals }> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("provider_usage_events")
    .select("discovery_run_id, request_count, result_count")
    .eq("workspace_id", workspaceId)
    .eq("provider_key", providerKey)
    .gte("occurred_at", monthStart())
    .limit(5000);
  if (error) throw new DataAccessError("providerUsageTotals", error);
  const sum = (rows: { request_count: number; result_count: number }[]) =>
    rows.reduce((t, r) => ({ requests: t.requests + r.request_count, results: t.results + r.result_count }), { requests: 0, results: 0 });
  const rows = data ?? [];
  return { run: sum(rows.filter((r) => runId && r.discovery_run_id === runId)), month: sum(rows) };
}

/**
 * This month's enrichment usage for one provider in this workspace:
 * domain-resolution requests, company enrichments that returned data, and the
 * ESTIMATED credits (sum of known estimates; `unknown` counts calls whose
 * charge Vleeds couldn't determine). Not the provider's account balance.
 */
export type EnrichmentUsageSummary = {
  domainRequests: number;
  enrichmentRequests: number;
  enrichments: number;
  /** Estimated credits of company enrichment (domain resolution is free). */
  enrichmentCreditMillis: number;
  /** P1-E5: decision-maker (contact) searches and their estimated credits. */
  contactSearches: number;
  contactSearchCreditMillis: number;
  /** Total estimated credits for the provider this month. */
  estimatedCreditMillis: number;
  unknownCreditCalls: number;
};

export async function enrichmentUsageSummary(workspaceId: string, providerKey: string): Promise<EnrichmentUsageSummary> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("provider_usage_events")
    .select("operation, request_count, result_count, status, estimated_credit_millis")
    .eq("workspace_id", workspaceId)
    .eq("provider_key", providerKey)
    .gte("occurred_at", monthStart())
    .limit(5000);
  if (error) throw new DataAccessError("enrichmentUsageSummary", error);
  const out: EnrichmentUsageSummary = {
    domainRequests: 0, enrichmentRequests: 0, enrichments: 0, enrichmentCreditMillis: 0,
    contactSearches: 0, contactSearchCreditMillis: 0, estimatedCreditMillis: 0, unknownCreditCalls: 0,
  };
  for (const r of data ?? []) {
    const credits = r.estimated_credit_millis ?? 0;
    if (r.operation === "domain_finder") out.domainRequests += r.request_count;
    if (r.operation === "company_enrichment") {
      out.enrichmentRequests += r.request_count;
      if (r.status === "ok") out.enrichments += r.result_count;
      out.enrichmentCreditMillis += credits;
    }
    if (r.operation === "domain_search") {
      out.contactSearches += 1;
      out.contactSearchCreditMillis += credits;
    }
    if (r.estimated_credit_millis === null) out.unknownCreditCalls += r.operation === "domain_finder" ? 0 : 1;
    else out.estimatedCreditMillis += r.estimated_credit_millis;
  }
  return out;
}
