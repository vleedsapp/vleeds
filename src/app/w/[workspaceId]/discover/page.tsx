import type { Metadata } from "next";
import { DiscoverWorkspace } from "@/components/discover/discover-workspace";
import { PageHeader } from "@/components/ui/primitives";
import { geographyLabel } from "@/lib/config/icp";
import { enrichmentUsageSummary, getWorkspace, listIcpProfilesForDiscovery, listRecentDiscoveryRuns, providerUsageTotals, waitingReferences } from "@/lib/dal";
import { DEFAULT_ENRICHMENT_PROVIDER, getEnrichmentProvider } from "@/lib/providers/company-enrichment/registry";
import { geographyText } from "@/lib/providers/company-discovery/query";
import { DEFAULT_DISCOVERY_PROVIDER, getDiscoveryProvider } from "@/lib/providers/company-discovery/registry";
import { workspacePath } from "@/lib/navigation";

export const metadata: Metadata = { title: "Discover" };

/**
 * Discover: interactive company discovery through a configured provider
 * (see the provider registry). Searches run only when the user asks. Provider
 * content is transient and lives in the client component's state; this page
 * passes only Vleeds data (ICP options, recent runs, usage counts).
 */
export default async function DiscoverPage({ params }: PageProps<"/w/[workspaceId]/discover">) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const provider = getDiscoveryProvider(DEFAULT_DISCOVERY_PROVIDER);
  const configured = !!provider?.isConfigured();

  const enrichment = getEnrichmentProvider(DEFAULT_ENRICHMENT_PROVIDER);
  const enrichmentConfigured = !!enrichment?.isConfigured();

  const [icps, runs, usage, enrichmentUsage, waiting] = await Promise.all([
    listIcpProfilesForDiscovery(ws.id),
    listRecentDiscoveryRuns(ws.id, 10),
    provider ? providerUsageTotals(ws.id, provider.providerKey, null) : Promise.resolve(null),
    enrichment && enrichmentConfigured ? enrichmentUsageSummary(ws.id, enrichment.providerKey) : Promise.resolve(null),
    enrichmentConfigured ? waitingReferences(ws.id, 10) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <PageHeader title="Discover" description={<>Search for businesses that match {ws.name}&apos;s target market.</>} />
      <DiscoverWorkspace
        workspaceId={ws.id}
        leadsPath={workspacePath(ws.id, "leads")}
        settingsPath={workspacePath(ws.id, "settings")}
        configured={configured}
        provider={
          provider
            ? { key: provider.providerKey, label: provider.label, attribution: provider.attribution, maxPageSize: provider.getCapabilities().maxPageSize }
            : null
        }
        icps={icps.map((p) => ({
          id: p.id,
          name: p.name,
          isDefault: p.isDefault,
          suggestions: [...p.industries, ...p.keywords].slice(0, 12),
          geographies: p.geographies.map((g) => ({ id: g.id, label: geographyLabel(g) })),
        }))}
        runs={runs.map((r) => ({
          id: r.id,
          query: r.query,
          where: r.geography ? geographyText(r.geography) : null,
          providerLabel: r.providerKey === provider?.providerKey ? provider.label : r.providerKey,
          status: r.status,
          candidateCount: r.candidateCount,
          selectedCount: r.selectedCount,
          createdAt: r.createdAt,
        }))}
        monthUsage={usage?.month ?? null}
        enrichment={{
          configured: enrichmentConfigured,
          label: enrichment?.label ?? null,
          estimateMillis: enrichment?.enrichmentCreditEstimate()?.millis ?? null,
          usage: enrichmentUsage,
          waiting: waiting.map((w) => ({ id: w.id, runId: w.runId, query: w.query, decidedAt: w.decidedAt })),
        }}
      />
    </div>
  );
}
