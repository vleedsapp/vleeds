"use client";

import { Building2 } from "lucide-react";
import { Button, Panel, PanelHeader } from "@/components/ui/primitives";
import { formatCredits } from "@/lib/enrichment/model";
import type { EnrichmentStart } from "./enrichment-sheet";

/** What Discover knows about company enrichment (Vleeds data only; no provider content). */
export type EnrichmentInfo = {
  configured: boolean;
  label: string | null;
  estimateMillis: number | null;
  usage: {
    domainRequests: number;
    enrichmentRequests: number;
    enrichments: number;
    enrichmentCreditMillis: number;
    contactSearches: number;
    contactSearchCreditMillis: number;
    estimatedCreditMillis: number;
    unknownCreditCalls: number;
  } | null;
  /** References saved for enrichment in earlier searches (no names: those were transient). */
  waiting: { id: string; runId: string; query: string; decidedAt: string | null }[];
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/**
 * Company data on Discover: whether enrichment is available, this month's
 * (estimated) provider usage, a standalone "Enrich a company" entry (name or
 * domain) and references from earlier searches still waiting for data.
 */
export function CompanyDataPanel({ enrichment, onStart }: { enrichment: EnrichmentInfo; onStart: (s: EnrichmentStart) => void }) {
  return (
    <Panel aria-labelledby="company-data-heading" className="p-5 sm:p-6">
      <PanelHeader
        id="company-data-heading"
        icon={<Building2 className="stroke-[1.75]" />}
        title="Company data"
        description={
          enrichment.configured
            ? `Look up durable company data with ${enrichment.label}, one company at a time. Nothing is saved until you review it.`
            : undefined
        }
        action={
          enrichment.configured ? (
            <Button type="button" className="h-11 sm:h-9" aria-haspopup="dialog" onClick={() => onStart({ source: "manual" })}>
              Enrich a company
            </Button>
          ) : undefined
        }
      />

      {!enrichment.configured ? (
        <div className="mt-4 rounded-md border border-line bg-surface-muted px-4 py-3">
          <p className="text-[14px] font-medium text-ink">Company enrichment is not configured yet.</p>
          <p className="mt-0.5 text-[13.5px] text-ink-muted">
            Selected search results stay saved for enrichment until an owner connects an enrichment provider in the server configuration.
            Discovery and Leads work as usual.
          </p>
        </div>
      ) : (
        <>
          {enrichment.usage ? (
            <div className="mt-4 rounded-lg border border-line bg-surface-muted px-3.5 py-2.5 text-[13px] text-ink-muted">
              <p className="font-medium text-ink">{enrichment.label} this month</p>
              <dl aria-label={`${enrichment.label} usage this month`} className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
                <dt className="text-ink">Company enrichment</dt>
                <dd className="flex flex-wrap gap-x-4">
                  <span>Domain resolution: {plural(enrichment.usage.domainRequests, "request", "requests")}</span>
                  <span>Company enrichments: {enrichment.usage.enrichments.toLocaleString("en")}</span>
                  <span>{plural(enrichment.usage.enrichmentRequests, "request", "requests")} · estimated {formatCredits(enrichment.usage.enrichmentCreditMillis)} credits</span>
                </dd>
                <dt className="text-ink">Decision-maker searches</dt>
                <dd>
                  {plural(enrichment.usage.contactSearches, "search", "searches")} · estimated {formatCredits(enrichment.usage.contactSearchCreditMillis)} credits
                </dd>
                <dt className="font-medium text-ink">Total estimated {enrichment.label} credits</dt>
                <dd className="font-medium text-ink">
                  Estimated credits: {formatCredits(enrichment.usage.estimatedCreditMillis)}
                  {enrichment.usage.unknownCreditCalls ? ` (+${enrichment.usage.unknownCreditCalls} unknown)` : ""}
                </dd>
              </dl>
            </div>
          ) : null}
          <p className="mt-2 text-[12.5px] text-ink-subtle">
            Estimates by Vleeds from the provider&apos;s published credit rules. Your {enrichment.label} account is the authoritative balance (and plan limits).
          </p>

          <h3 className="mt-5 text-[14px] font-semibold text-ink">Saved for enrichment ({enrichment.waiting.length})</h3>
          {enrichment.waiting.length === 0 ? (
            <p className="mt-1 text-[13.5px] text-ink-muted">Results you select in a search appear here until they have company data.</p>
          ) : (
            <ul aria-label="References saved for enrichment" className="mt-2 divide-y divide-line rounded-lg border border-line">
              {enrichment.waiting.map((w) => (
                <li key={w.id} data-waiting={w.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-ink">Selected from “{w.query}”</p>
                    <p className="text-[12.5px] text-ink-subtle">
                      {w.decidedAt ? new Date(w.decidedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : ""} · enter its name or domain to look it up
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="soft"
                    className="h-11 sm:h-8"
                    aria-haspopup="dialog"
                    onClick={() => onStart({ source: "discovery", discoveryRunId: w.runId, candidateId: w.id, transientName: null, referenceLabel: w.query })}
                  >
                    Find company data<span className="sr-only"> for the reference selected from {w.query}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
