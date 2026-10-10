"use client";

import { Compass, Info, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  closeDiscovery,
  decideCandidate,
  loadMoreDiscovery,
  retryDiscovery,
  startDiscovery,
  type ActiveRun,
  type DiscoveryActionResult,
} from "@/app/w/[workspaceId]/discover/actions";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert, Button, buttonClass, cx, Field, inputClass, Panel, PanelHeader, StatusPill, type Tone } from "@/components/ui/primitives";
import { countryOptions } from "@/lib/config/countries";
import { PAGE_SIZES, type DecisionAction, type RunStatus, type TransientCandidateView, type UsageView } from "@/lib/discovery/model";
import { CompanyDataPanel, type EnrichmentInfo } from "@/components/enrichment/company-data-panel";
import { EnrichmentSheet, type EnrichmentDone, type EnrichmentStart } from "@/components/enrichment/enrichment-sheet";
import { DiscoverResults } from "./discover-results";
import { ProviderAttribution } from "./provider-attribution";

type IcpOption = { id: string; name: string; isDefault: boolean; suggestions: string[]; geographies: { id: string; label: string }[] };
type RunRow = {
  id: string;
  query: string;
  where: string | null;
  providerLabel: string;
  status: RunStatus;
  candidateCount: number;
  selectedCount: number;
  createdAt: string;
};
type ProviderInfo = { key: string; label: string; attribution: { text: string; rankingNote: string }; maxPageSize: number };

type Active = {
  run: ActiveRun | null;
  query: string;
  where: string | null;
  candidates: TransientCandidateView[];
  nextCursor: string | null;
  usage: UsageView | null;
  error: { message: string; code: string } | null;
};

const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  running: { label: "Searching", tone: "info" },
  review: { label: "In review", tone: "warning" },
  completed: { label: "Completed", tone: "brand" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/**
 * Discover: search form, the active search's results (transient provider
 * content, kept only in this component's state), usage, and recent activity.
 * Every provider call happens in a server action after an explicit click.
 */
export function DiscoverWorkspace({
  workspaceId,
  leadsPath,
  settingsPath,
  configured,
  provider,
  icps,
  runs,
  monthUsage,
  enrichment,
}: {
  workspaceId: string;
  leadsPath: string;
  settingsPath: string;
  configured: boolean;
  provider: ProviderInfo | null;
  icps: IcpOption[];
  runs: RunRow[];
  monthUsage: { requests: number; results: number } | null;
  enrichment: EnrichmentInfo;
}) {
  const initialIcp = icps.find((p) => p.isDefault) ?? icps[0] ?? null;
  const [icpId, setIcpId] = useState<string>(initialIcp?.id ?? "");
  const icp = icps.find((p) => p.id === icpId) ?? null;
  const [query, setQuery] = useState(initialIcp?.suggestions[0] ?? "");
  const [geo, setGeo] = useState<string>(initialIcp?.geographies[0] ? `icp:${initialIcp.geographies[0].id}` : "none");
  const [custom, setCustom] = useState({ countryCode: "", region: "", city: "" });
  const [pageSize, setPageSize] = useState<number>(10);
  const [formError, setFormError] = useState<string | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [announce, setAnnounce] = useState("");
  const [enrichStart, setEnrichStart] = useState<EnrichmentStart | null>(null);
  const countries = useMemo(() => countryOptions(), []);
  const sizes = PAGE_SIZES.filter((n) => n <= (provider?.maxPageSize ?? 20));

  const geographyChoice = () =>
    geo.startsWith("icp:")
      ? { kind: "icp" as const, id: geo.slice(4) }
      : geo === "custom"
        ? { kind: "custom" as const, countryCode: custom.countryCode, region: custom.region || null, city: custom.city || null }
        : { kind: "none" as const };

  const whereLabel = () =>
    geo.startsWith("icp:")
      ? (icp?.geographies.find((g) => `icp:${g.id}` === geo)?.label ?? null)
      : geo === "custom"
        ? [custom.city, custom.region, countries.find((c) => c.code === custom.countryCode)?.name].filter(Boolean).join(", ") || null
        : null;

  /** Applies an action result to the active search. `append` keeps earlier pages (Load more). */
  const apply = (r: DiscoveryActionResult, base: Active, append: boolean) => {
    if (r.ok) {
      const candidates = append ? [...base.candidates, ...r.candidates.filter((c) => !base.candidates.some((x) => x.candidateId === c.candidateId))] : r.candidates;
      setActive({ ...base, run: r.run, candidates, nextCursor: r.nextCursor, usage: r.usage, error: null });
      setAnnounce(
        candidates.length
          ? `${plural(candidates.length, "company", "companies")} found${r.nextCursor ? ". More results are available." : "."}`
          : "No companies found for this search.",
      );
    } else {
      setActive({ ...base, run: r.run ?? base.run, nextCursor: append ? base.nextCursor : null, usage: r.usage ?? base.usage, error: { message: r.error, code: r.code } });
      setAnnounce(r.error);
    }
  };

  const search = () => {
    if (query.trim().length < 2) {
      setFormError("Describe what you are looking for (at least 2 characters).");
      return;
    }
    if (geo === "custom" && !custom.countryCode) {
      setFormError("Choose a country for the location.");
      return;
    }
    setFormError(null);
    const base: Active = { run: null, query: query.trim(), where: whereLabel(), candidates: [], nextCursor: null, usage: null, error: null };
    setAnnounce("Searching…");
    startTransition(async () => {
      try {
        const r = await startDiscovery(workspaceId, { icpProfileId: icp?.id ?? null, query, geography: geographyChoice(), pageSize });
        if (!r.ok && !r.run) {
          setFormError(r.error);
          setAnnounce(r.error);
          return;
        }
        apply(r, base, false);
      } catch {
        setFormError("The search couldn't be started. Check your connection and try again.");
      }
    });
  };

  const loadMore = () => {
    if (!active?.run || !active.nextCursor) return;
    const base = active;
    setAnnounce("Loading more results…");
    startTransition(async () => {
      try {
        apply(await loadMoreDiscovery(workspaceId, base.run!.id, base.nextCursor), base, true);
      } catch {
        setActive({ ...base, error: { message: "More results couldn't be loaded. Try again.", code: "network" } });
      }
    });
  };

  const retry = (runId: string, label: { query: string; where: string | null }) => {
    const base: Active = { run: null, query: label.query, where: label.where, candidates: [], nextCursor: null, usage: null, error: null };
    setAnnounce("Searching…");
    startTransition(async () => {
      try {
        apply(await retryDiscovery(workspaceId, runId), base, false);
      } catch {
        setActive({ ...base, error: { message: "The search couldn't be retried. Check your connection.", code: "network" } });
      }
    });
  };

  const decide = (c: TransientCandidateView, action: DecisionAction) => {
    if (!active?.run) return;
    const runId = active.run.id;
    setBusyId(c.candidateId);
    startTransition(async () => {
      try {
        const r = await decideCandidate(workspaceId, runId, c.candidateId, action);
        if (r.ok) {
          setActive((a) => (a ? { ...a, candidates: a.candidates.map((x) => (x.candidateId === c.candidateId ? { ...x, decision: r.decision } : x)) } : a));
          setAnnounce(`${c.name ?? "Result"}: ${r.decision === "dismissed" ? "dismissed" : r.decision === "unreviewed" ? "decision undone" : r.decision === "selected" ? "selected" : "saved for enrichment"}.`);
        } else setActive((a) => (a ? { ...a, error: { message: r.error, code: "decision" } } : a));
      } catch {
        setActive((a) => (a ? { ...a, error: { message: "The decision couldn't be saved. Try again.", code: "network" } } : a));
      } finally {
        setBusyId(null);
      }
    });
  };

  const close = (how: "complete" | "cancel") => {
    if (!active?.run) return;
    const runId = active.run.id;
    startTransition(async () => {
      const r = await closeDiscovery(workspaceId, runId, how);
      if (r.ok) {
        setActive(null);
        setAnnounce(how === "complete" ? "Review finished. Selected references are kept." : "Search cancelled.");
      } else setActive((a) => (a ? { ...a, error: { message: r.error, code: "close" } } : a));
    });
  };

  /** After an enrichment from a reference of the open search: that reference now IS the saved company. */
  const enriched = (start: EnrichmentStart, done: EnrichmentDone) => {
    if (start.source !== "discovery" || !done.companyId || done.commitResult === "skipped") return;
    setActive((a) =>
      a
        ? {
            ...a,
            candidates: a.candidates.map((x) =>
              x.candidateId === start.candidateId ? { ...x, decision: "selected", matchState: "existing_company", matchCompanyId: done.companyId } : x,
            ),
          }
        : a,
    );
  };

  const runOpen = !!active?.run && (active.run.status === "review" || active.run.status === "running");
  const selected = active?.candidates.filter((c) => c.decision === "selected" || c.decision === "needs_enrichment").length ?? 0;

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {/* 1. Ready to search ------------------------------------------------ */}
      {!configured || !provider ? (
        <Panel>
          <EmptyState bare icon={<Compass />} title="Company discovery is not configured yet">
            Searching for companies needs a discovery source. An owner can connect one in the server configuration; until then, you
            can still add companies by hand or import a spreadsheet from Leads.
          </EmptyState>
          <div className="flex justify-center pb-8">
            <Link href={leadsPath} className={buttonClass("secondary", "h-11")}>
              Go to Leads
            </Link>
          </div>
        </Panel>
      ) : (
        <Panel aria-labelledby="find-heading" className="p-5 sm:p-6">
          <PanelHeader id="find-heading" icon={<Search className="stroke-[1.75]" />} title="Find companies" description={`Searches ${provider.label} when you press Find companies.`} />
          <form
            className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.6fr)]"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
            noValidate
            aria-busy={pending}
          >
            <Field label="Ideal customer profile" htmlFor="dc-icp" hint={icps.length ? undefined : "No profile yet. You can still search."}>
              <select
                id="dc-icp"
                value={icpId}
                onChange={(e) => {
                  const next = icps.find((p) => p.id === e.target.value) ?? null;
                  setIcpId(e.target.value);
                  setGeo(next?.geographies[0] ? `icp:${next.geographies[0].id}` : "none");
                }}
                disabled={!icps.length}
                className={inputClass}
              >
                {icps.length ? null : <option value="">None</option>}
                {icps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-col gap-1.5">
              <Field label="What are you looking for?" htmlFor="dc-query" error={formError ?? undefined}>
                <input
                  id="dc-query"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setFormError(null);
                  }}
                  maxLength={120}
                  placeholder="Type of business"
                  aria-invalid={formError ? true : undefined}
                  aria-describedby={formError ? "dc-query-error" : icp?.suggestions.length ? "dc-suggestions" : undefined}
                  className={inputClass}
                />
              </Field>
              {icp?.suggestions.length ? (
                <div id="dc-suggestions" className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] text-ink-subtle">From the profile:</span>
                  {icp.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setQuery(s)}
                      aria-pressed={query === s}
                      className={cx(
                        "inline-flex h-11 items-center rounded-full border px-3 text-[12.5px] sm:h-7",
                        query === s ? "border-brand bg-brand-tint text-brand-strong" : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-3">
              <Field label="Where" htmlFor="dc-geo">
                <select id="dc-geo" value={geo} onChange={(e) => setGeo(e.target.value)} className={inputClass}>
                  {icp?.geographies.length ? (
                    <optgroup label="Profile geographies">
                      {icp.geographies.map((g) => (
                        <option key={g.id} value={`icp:${g.id}`}>
                          {g.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <option value="custom">Another location…</option>
                  <option value="none">No specific location</option>
                </select>
              </Field>
              {geo === "custom" ? (
                <fieldset className="grid gap-3 rounded-md border border-line bg-surface-muted p-3">
                  <legend className="sr-only">Location</legend>
                  <Field label="Country" htmlFor="dc-country">
                    <select id="dc-country" value={custom.countryCode} onChange={(e) => setCustom((c) => ({ ...c, countryCode: e.target.value }))} className={inputClass}>
                      <option value="">Choose a country</option>
                      {countries.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Region" htmlFor="dc-region" optional>
                      <input id="dc-region" value={custom.region} maxLength={120} onChange={(e) => setCustom((c) => ({ ...c, region: e.target.value }))} className={inputClass} />
                    </Field>
                    <Field label="City" htmlFor="dc-city" optional>
                      <input id="dc-city" value={custom.city} maxLength={120} onChange={(e) => setCustom((c) => ({ ...c, city: e.target.value }))} className={inputClass} />
                    </Field>
                  </div>
                </fieldset>
              ) : null}
            </div>
            <Field label="Results per page" htmlFor="dc-size">
              <select id="dc-size" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className={inputClass}>
                {sizes.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-col gap-2 md:col-span-2 xl:col-span-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-ink-subtle">
                {!icps.length ? (
                  <>
                    Profiles and their geographies come from{" "}
                    <Link href={settingsPath} className="font-medium text-brand hover:underline">
                      Settings
                    </Link>
                    .{" "}
                  </>
                ) : null}
                One page of results per search. Nothing is added to Leads automatically.
              </p>
              <Button type="submit" variant="primary" size="lg" className="h-11 w-full sm:w-auto" disabled={pending}>
                <Search aria-hidden className="size-4" />
                {pending && !busyId ? "Searching…" : "Find companies"}
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {/* 2. Results / review ----------------------------------------------- */}
      {active && provider ? (
        <Panel aria-labelledby="results-heading" className="min-w-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 id="results-heading" className="text-[16px] font-semibold text-ink">
                Results
              </h2>
              <p className="text-[13.5px] text-ink-muted">
                “{active.query}”{active.where ? ` in ${active.where}` : ""} · {plural(active.candidates.length, "company", "companies")}
                {selected ? ` · ${selected} selected` : ""}
              </p>
            </div>
            {active.usage ? (
              <dl aria-label="Provider usage" className="grid grid-cols-2 gap-x-5 gap-y-0.5 rounded-lg border border-line bg-surface-muted px-3.5 py-2 text-[12.5px] text-ink-muted">
                <dt className="font-medium text-ink">This search</dt>
                <dd>
                  {active.usage.providerLabel} · {plural(active.usage.run.requests, "request", "requests")} · {plural(active.usage.run.results, "candidate", "candidates")}
                </dd>
                <dt className="font-medium text-ink">This month</dt>
                <dd>{plural(active.usage.month.requests, "request", "requests")}</dd>
              </dl>
            ) : null}
          </div>

          {active.error ? (
            <div className="flex flex-col gap-2 px-5 pt-4">
              <Alert>{active.error.message}</Alert>
              {active.run?.status === "failed" ? (
                <Button type="button" className="h-11 self-start" disabled={pending} onClick={() => retry(active.run!.id, { query: active.query, where: active.where })}>
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}

          {active.candidates.length ? (
            <DiscoverResults
              candidates={active.candidates}
              leadsPath={leadsPath}
              busyId={busyId}
              open={runOpen}
              onDecide={decide}
              onEnrich={
                enrichment.configured && active.run
                  ? (c) =>
                      setEnrichStart({ source: "discovery", discoveryRunId: active.run!.id, candidateId: c.candidateId, transientName: c.name, referenceLabel: active.query })
                  : undefined
              }
            />
          ) : !active.error ? (
            <div className="px-6 py-10 text-center">
              <p className="text-[16px] font-semibold text-ink">No companies found</p>
              <p className="mt-1 text-[14px] text-ink-muted">Try other words, a broader location, or no specific location.</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-line px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-col gap-1.5">
              <ProviderAttribution text={provider.attribution.text} extra={active.candidates.flatMap((c) => c.attributions)} />
              <details className="text-[12.5px] text-ink-subtle">
                <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 font-medium text-ink-muted sm:min-h-0">
                  <Info aria-hidden className="size-3.5" />
                  About these results
                </summary>
                <p className="mt-1 max-w-xl">
                  {provider.attribution.rankingNote} Names, addresses and categories are shown during this search only; Vleeds keeps the
                  provider reference and your decisions.
                </p>
              </details>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {active.nextCursor && active.run?.status === "review" ? (
                <Button type="button" className="h-11" disabled={pending} onClick={loadMore}>
                  {pending && !busyId ? "Loading…" : "Load more"}
                </Button>
              ) : null}
              {active.run && active.run.status !== "failed" ? (
                <>
                  <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={() => close("cancel")}>
                    Cancel search
                  </Button>
                  <Button type="button" variant="primary" className="h-11" disabled={pending || active.run.status !== "review"} onClick={() => close("complete")}>
                    Done reviewing
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </Panel>
      ) : null}

      {/* 3. Company data (enrichment) ---------------------------------------- */}
      <CompanyDataPanel
        enrichment={enrichment}
        onStart={setEnrichStart}
      />
      {enrichStart && enrichment.configured && enrichment.label ? (
        <EnrichmentSheet
          workspaceId={workspaceId}
          start={enrichStart}
          providerLabel={enrichment.label}
          estimateMillis={enrichment.estimateMillis}
          leadsPath={leadsPath}
          onClose={() => setEnrichStart(null)}
          onDone={(done) => enriched(enrichStart, done)}
        />
      ) : null}

      {/* 4. Recent discovery activity --------------------------------------- */}
      <Panel aria-labelledby="recent-discovery" className="overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="recent-discovery" className="text-[15px] font-semibold text-ink">
            Recent discovery activity
          </h2>
          {monthUsage && provider ? (
            <p className="text-[13px] text-ink-subtle">
              {provider.label} this month: {plural(monthUsage.requests, "request", "requests")} · {plural(monthUsage.results, "candidate", "candidates")}
            </p>
          ) : null}
        </div>
        {runs.length === 0 ? (
          <p className="px-5 py-8 text-center text-[14px] text-ink-muted">No searches yet. Searches you run appear here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-medium text-ink">
                    {r.query}
                    {r.where ? <span className="font-normal text-ink-muted"> · {r.where}</span> : null}
                  </p>
                  <p className="text-[13px] text-ink-subtle">
                    {r.providerLabel} · {new Date(r.createdAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })} ·{" "}
                    {plural(r.candidateCount, "reference", "references")} · {r.selectedCount} selected
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={RUN_STATUS[r.status].tone} className="h-6 px-2.5 text-[12px]">
                    {RUN_STATUS[r.status].label}
                  </StatusPill>
                  {r.status === "failed" && configured ? (
                    <Button type="button" className="h-11 sm:h-8" disabled={pending} onClick={() => retry(r.id, { query: r.query, where: r.where })}>
                      Retry<span className="sr-only"> {r.query}</span>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-line px-5 py-3 text-[12.5px] text-ink-subtle">
          Provider details such as names and addresses are shown only while a search is open. History keeps your query, counts and
          decisions.
        </p>
      </Panel>
    </>
  );
}
