import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AddLeadsMenu } from "@/components/leads/add-leads-menu";
import { CompanyDrawer } from "@/components/leads/company-drawer";
import { CompanyTable } from "@/components/leads/company-table";
import { LeadFilters } from "@/components/leads/lead-filters";
import { Pagination } from "@/components/leads/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass, cx, Panel, PageHeader } from "@/components/ui/primitives";
import { canConfigureWorkspace, companyWorkflow, getCompanyDetail, getWorkspace, latestContactRun, listCompanies, listIcpProfilesForDiscovery } from "@/lib/dal";
import { hasActiveFilters, leadQueryString, parseLeadQuery } from "@/lib/lead-core/list-query";
import { isUuid, workspacePath } from "@/lib/navigation";
import { DEFAULT_ENRICHMENT_PROVIDER, getEnrichmentProvider } from "@/lib/providers/company-enrichment/registry";
import { DEFAULT_CONTACT_PROVIDER, getContactProvider } from "@/lib/providers/contact-discovery/registry";

export const metadata: Metadata = { title: "Leads" };

/**
 * Leads = the workspace's companies (the lead core), paginated, filtered and
 * sorted on the server. All list state is in the URL; `?company=<id>` opens
 * the drawer and is resolved through RLS within this workspace (unknown or
 * foreign ids show no drawer). Real records only; no sample data.
 */
export default async function LeadsPage({ params, searchParams }: PageProps<"/w/[workspaceId]/leads">) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const sp = await searchParams;
  const query = parseLeadQuery(sp);
  const company = typeof sp.company === "string" && isUuid(sp.company) ? sp.company : null;
  const base = workspacePath(ws.id, "leads");
  const enrichment = getEnrichmentProvider(DEFAULT_ENRICHMENT_PROVIDER);

  const contacts = getContactProvider(DEFAULT_CONTACT_PROVIDER);
  const contactsConfigured = !!contacts?.isConfigured();

  const [list, detail, icps, lastRun] = await Promise.all([
    listCompanies(ws.id, query),
    company ? getCompanyDetail(ws.id, company) : Promise.resolve(null),
    company && contactsConfigured ? listIcpProfilesForDiscovery(ws.id) : Promise.resolve([]),
    company ? latestContactRun(ws.id, company) : Promise.resolve(null),
  ]);
  // P1-E7: each contact's next action / last contact, and the activity timeline.
  const workflow = detail
    ? await companyWorkflow(
        ws.id,
        detail.id,
        ws.timezone,
        detail.contacts.map((p) => ({ id: p.id, fullName: p.fullName, phone: p.phone, status: p.status, restricted: !!p.restriction })),
        !!detail.restriction,
      )
    : null;
  const filtered = hasActiveFilters(query);
  const href = (extra: Record<string, string | null> = {}, page = query.page) => `${base}${leadQueryString({ ...query, page }, extra)}`;
  const workspaceEmpty = list.total === 0 && !filtered && query.page === 1;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        title="Leads"
        description={<>Companies and decision-makers for {ws.name}.</>}
        actions={<AddLeadsMenu workspaceId={ws.id} leadsPath={base} />}
      />
      <div className={cx("items-start gap-5", detail && "lg:grid lg:grid-cols-[minmax(0,1fr)_400px]")}>
        <Panel aria-labelledby="companies-heading" className="min-w-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 id="companies-heading" className="text-[15px] font-semibold text-ink">
              {filtered ? "Matching companies" : "All companies"} ({list.total.toLocaleString("en")})
            </h2>
          </div>
          {workspaceEmpty ? (
            <EmptyState
              bare
              icon={<Users />}
              title="No companies yet"
              action={
                <Link href={`${base}/import`} className={buttonClass("secondary", "h-11")}>
                  Import a CSV
                </Link>
              }
            >
              Add companies one at a time with <strong className="font-medium text-ink">Add leads</strong>, or import a spreadsheet.
              Duplicates are checked before anything is saved.
            </EmptyState>
          ) : (
            <>
              <LeadFilters key={leadQueryString(query)} basePath={base} query={query} />
              {list.items.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-[16px] font-semibold text-ink">{filtered ? "No companies match these filters" : "This page is empty"}</p>
                  <Link href={filtered ? base : href({}, 1)} scroll={false} className="mt-2 inline-block text-[14px] font-medium text-brand hover:underline">
                    {filtered ? "Clear filters" : "Go to the first page"}
                  </Link>
                </div>
              ) : (
                <CompanyTable items={list.items} hrefFor={(id) => href({ company: id })} selectedId={detail?.id ?? null} />
              )}
              <Pagination
                page={list.page}
                pageCount={list.pageCount}
                total={list.total}
                pageSize={list.pageSize}
                noun={["company", "companies"]}
                hrefFor={(p) => href({}, p)}
              />
            </>
          )}
        </Panel>

        {detail ? (
          <CompanyDrawer
            key={detail.id}
            company={detail}
            workspaceId={ws.id}
            closeHref={href()}
            canLift={canConfigureWorkspace(ws.role)}
            enrichment={enrichment?.isConfigured() ? { label: enrichment.label, estimateMillis: enrichment.enrichmentCreditEstimate()?.millis ?? null } : null}
            leadsPath={base}
            settingsPath={workspacePath(ws.id, "settings")}
            workflow={workflow}
            contactDiscovery={{
              configured: contactsConfigured,
              label: contacts?.label ?? null,
              estimateMillis: contacts?.searchCreditEstimate()?.millis ?? null,
              icps: icps.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault, roles: p.decisionMakers.map((r) => ({ id: r.id, title: r.title, priority: r.priority })) })),
              settingsPath: workspacePath(ws.id, "settings"),
              lastRun: lastRun
                ? { resultCount: lastRun.resultCount, savedCount: lastRun.savedCount, icpName: lastRun.icpName, status: lastRun.status, createdAt: lastRun.createdAt }
                : null,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
