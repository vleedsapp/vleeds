"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  companyForMerge,
  createEnrichmentRun,
  discoveryReference,
  findWorkspace,
  getCurrentUser,
  getEnrichmentRun,
  openEnrichmentRunForCandidate,
  updateEnrichmentRun,
  type WorkspaceDetail,
} from "@/lib/dal";
import {
  companyNameSchema,
  decisionSchema,
  domainInputSchema,
  enrichmentMessage,
  inputKindFor,
  runIsFinal,
  startEnrichmentSchema,
  storableName,
  type EnrichmentActionResult,
  type EnrichmentView,
} from "@/lib/enrichment/model";
import { enrichRun, resolveDomainsForRun, saveRun, viewFor } from "@/lib/enrichment/service";
import { isUuid } from "@/lib/navigation";
import { DEFAULT_ENRICHMENT_PROVIDER, getEnrichmentProvider } from "@/lib/providers/company-enrichment/registry";
import type { CompanyEnrichmentProvider } from "@/lib/providers/company-enrichment/types";

/**
 * Interactive company enrichment (P1-E4). Every action authenticates,
 * re-authorizes the workspace, validates its input and talks to the provider
 * ONLY on the server. Credit-bearing company enrichment runs only on an
 * explicit "Enrich company" action, one company at a time. Errors are fixed,
 * calm messages; provider payloads and keys never reach the browser.
 */

const NOT_AVAILABLE = "This enrichment is not available.";

async function authorize(workspaceId: unknown): Promise<WorkspaceDetail | null> {
  if (typeof workspaceId !== "string" || !isUuid(workspaceId)) return null;
  if (!(await getCurrentUser())) redirect("/login");
  return findWorkspace(workspaceId);
}

function configuredProvider(key: string = DEFAULT_ENRICHMENT_PROVIDER): CompanyEnrichmentProvider | null {
  const p = getEnrichmentProvider(key);
  return p?.isConfigured() ? p : null;
}

const fail = (code: string, error: string, view: EnrichmentView | null = null): EnrichmentActionResult => ({ ok: false, code, error, view });
const notConfigured = () => fail("not_configured", enrichmentMessage("not_configured", ""));

async function loadRun(ws: WorkspaceDetail, runId: unknown) {
  if (typeof runId !== "string" || !isUuid(runId)) return null;
  return getEnrichmentRun(ws.id, runId);
}

/** Re-reads the run and returns its view (error codes become fixed messages). */
async function respond(ws: WorkspaceDetail, runId: string, provider: CompanyEnrichmentProvider, extra: Parameters<typeof viewFor>[3] = {}): Promise<EnrichmentActionResult> {
  const run = await getEnrichmentRun(ws.id, runId);
  if (!run) return fail("forbidden", NOT_AVAILABLE);
  const view = await viewFor(ws.id, run, provider, extra);
  return view.error && (extra.error || run.status === "failed") ? { ok: false, code: view.error.code, error: view.error.message, view } : { ok: true, view };
}

/**
 * Starts an enrichment from a discovery reference, a typed name/domain, or an
 * existing company. A name runs the (free) domain resolution; a domain runs
 * the company enrichment immediately (the user pressed "Enrich company").
 */
export async function startEnrichment(workspaceId: string, input: unknown): Promise<EnrichmentActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail("forbidden", NOT_AVAILABLE);
  const parsed = startEnrichmentSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the name or domain and try again.");
  const req = parsed.data;
  const provider = configuredProvider();
  if (!provider) return notConfigured();

  let discoveryCandidateId: string | null = null;
  let targetCompanyId: string | null = null;
  if (req.source === "discovery") {
    const ref = await discoveryReference(ws.id, req.discoveryRunId, req.candidateId);
    if (!ref) return fail("forbidden", NOT_AVAILABLE);
    if (ref.decision !== "needs_enrichment") return fail("reference_linked", enrichmentMessage("reference_linked", provider.label));
    // At most one open run per reference (P1-E4 F1): a second click/open continues the existing one.
    const open = await openEnrichmentRunForCandidate(ws.id, ref.id);
    if (open) return respond(ws, open.id, provider);
    discoveryCandidateId = ref.id;
  }
  if (req.source === "existing") {
    const company = await companyForMerge(ws.id, req.companyId);
    if (!company) return fail("forbidden", "This company is not available.");
    targetCompanyId = company.id;
  }

  const created = await createEnrichmentRun(ws.id, {
    providerKey: provider.providerKey,
    inputKind: inputKindFor(req),
    discoveryCandidateId,
    targetCompanyId,
    // Never the (transient) name of a discovery reference: see storableName.
    manualCompanyName: storableName(req),
    requestedDomain: req.lookup.by === "domain" ? req.lookup.domain : null,
    status: "draft",
  });
  if (!created.ok) {
    // A concurrent start for the same reference won the race (unique open-run index): continue that run.
    const open = discoveryCandidateId && created.reason === "conflict" ? await openEnrichmentRunForCandidate(ws.id, discoveryCandidateId) : null;
    if (open) return respond(ws, open.id, provider);
    return fail(created.reason, "The enrichment couldn't be started. Try again.");
  }
  const run = await getEnrichmentRun(ws.id, created.data.id);
  if (!run) return fail("failed", "The enrichment couldn't be started. Try again.");

  if (req.lookup.by === "name") {
    const step = await resolveDomainsForRun(ws.id, run, provider, req.lookup.companyName);
    return respond(ws, run.id, provider, step);
  }
  const step = await enrichRun(ws.id, run, provider, req.lookup.domain);
  refresh();
  return respond(ws, run.id, provider, step);
}

/**
 * (Re)runs domain resolution for an open run. For discovery references the
 * name comes from the browser again (it was never stored).
 */
export async function resolveDomains(workspaceId: string, runId: string, companyName: unknown): Promise<EnrichmentActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail("forbidden", NOT_AVAILABLE);
  const run = await loadRun(ws, runId);
  if (!run) return fail("forbidden", NOT_AVAILABLE);
  const provider = configuredProvider(run.providerKey);
  if (!provider) return notConfigured();
  const name = companyNameSchema.safeParse(typeof companyName === "string" ? companyName : (run.manualCompanyName ?? ""));
  if (!name.success) return fail("invalid_name", enrichmentMessage("invalid_name", provider.label));
  const step = await resolveDomainsForRun(ws.id, run, provider, name.data);
  return respond(ws, run.id, provider, step);
}

/** Enriches the chosen (or typed) domain. Explicit, credit-bearing action. Also "Try another domain". */
export async function enrichDomain(workspaceId: string, runId: string, domain: unknown): Promise<EnrichmentActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail("forbidden", NOT_AVAILABLE);
  const run = await loadRun(ws, runId);
  if (!run) return fail("forbidden", NOT_AVAILABLE);
  const provider = configuredProvider(run.providerKey);
  if (!provider) return notConfigured();
  const d = domainInputSchema.safeParse(domain);
  if (!d.success) return fail("invalid", d.error.issues[0]?.message ?? "Enter a domain like example.com.", await viewFor(ws.id, run, provider));
  if (!["draft", "domain_review", "failed"].includes(run.status)) return fail("stale", enrichmentMessage("stale", provider.label));
  const step = await enrichRun(ws.id, run, provider, d.data);
  refresh();
  return respond(ws, run.id, provider, step);
}

/** Retries the last provider request of a failed run (same domain). */
export async function retryEnrichment(workspaceId: string, runId: string): Promise<EnrichmentActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail("forbidden", NOT_AVAILABLE);
  const run = await loadRun(ws, runId);
  if (!run) return fail("forbidden", NOT_AVAILABLE);
  const provider = configuredProvider(run.providerKey);
  if (!provider) return notConfigured();
  if (run.status !== "failed" || !run.requestedDomain) return fail("stale", enrichmentMessage("stale", provider.label));
  const step = await enrichRun(ws.id, run, provider, run.requestedDomain);
  refresh();
  return respond(ws, run.id, provider, step);
}

/** Create / merge / skip, then commit through the ingestion pipeline. */
export async function saveEnrichment(workspaceId: string, runId: string, decision: unknown): Promise<EnrichmentActionResult> {
  const ws = await authorize(workspaceId);
  if (!ws) return fail("forbidden", NOT_AVAILABLE);
  const run = await loadRun(ws, runId);
  if (!run) return fail("forbidden", NOT_AVAILABLE);
  const provider = getEnrichmentProvider(run.providerKey);
  if (!provider) return fail("forbidden", NOT_AVAILABLE);
  const d = decisionSchema.safeParse(decision);
  if (!d.success) return fail("decision", enrichmentMessage("decision", provider.label), await viewFor(ws.id, run, provider));
  const saved = await saveRun(ws.id, run, provider, d.data);
  if (!saved.ok) {
    const fresh = (await getEnrichmentRun(ws.id, run.id)) ?? run;
    return fail(saved.code, enrichmentMessage(saved.code, provider.label), await viewFor(ws.id, fresh, provider));
  }
  refresh();
  return respond(ws, run.id, provider, {
    outcome: {
      commitResult: saved.commitResult,
      companyId: saved.companyId,
      companyName: saved.companyName,
      evidenceAdded: saved.evidenceAdded,
      identityLinked: saved.identityLinked,
      notes: saved.notes,
    },
  });
}

/** Cancels an unfinished run. Nothing is written to Leads. */
export async function cancelEnrichment(workspaceId: string, runId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ws = await authorize(workspaceId);
  if (!ws) return { ok: false, error: NOT_AVAILABLE };
  const run = await loadRun(ws, runId);
  if (!run) return { ok: false, error: NOT_AVAILABLE };
  if (runIsFinal(run.status)) return { ok: true };
  const r = await updateEnrichmentRun(ws.id, run.id, ["draft", "resolving_domain", "domain_review", "enriching", "review", "failed"], {
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
  });
  return r.ok ? { ok: true } : { ok: false, error: "This enrichment changed in the meantime." };
}
