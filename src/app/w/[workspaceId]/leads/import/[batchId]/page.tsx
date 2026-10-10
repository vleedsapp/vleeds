import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImportRunner } from "@/components/imports/import-runner";
import { ImportSteps, STATUS_LABEL, type ImportStep } from "@/components/imports/import-steps";
import { MappingForm } from "@/components/imports/mapping-form";
import { ReviewRows } from "@/components/imports/review-rows";
import { Pagination } from "@/components/leads/pagination";
import { buttonClass, cx, Panel, PageHeader, StatusPill } from "@/components/ui/primitives";
import { getImportBatch, getWorkspace, listImportRows, sampleRows, type ImportBatchView, type ReviewFilter } from "@/lib/dal";
import { suggestMapping } from "@/lib/imports/fields";
import { IMPORT_LIMITS } from "@/lib/imports/limits";
import type { ImportSummary } from "@/lib/imports/summary";
import { workspacePath } from "@/lib/navigation";

export const metadata: Metadata = { title: "Import CSV" };

const REVIEW_VIEWS: [ReviewFilter, string][] = [
  ["all", "All"],
  ["ready", "Ready"],
  ["duplicates", "Duplicates"],
  ["undecided", "Needs decision"],
  ["invalid", "Invalid"],
];
const REPORT_VIEWS: [ReviewFilter, string][] = [
  ["all", "All"],
  ["created", "Created"],
  ["merged", "Merged"],
  ["skipped", "Skipped"],
  ["invalid", "Invalid"],
  ["failed", "Failed"],
];

const STEP: Record<ImportBatchView["status"], ImportStep> = {
  mapping: "Map",
  review: "Review",
  processing: "Import",
  completed: "Import",
  cancelled: "Upload",
};

/**
 * One CSV import, driven by its status: Map → Review (decisions) → Import
 * (chunked commit) → Report. View and page are URL state (?view=, ?page=).
 * Unknown, foreign and malformed batch ids are a 404.
 */
export default async function ImportBatchPage({ params, searchParams }: PageProps<"/w/[workspaceId]/leads/import/[batchId]">) {
  const { workspaceId, batchId } = await params;
  const ws = await getWorkspace(workspaceId);
  const batch = await getImportBatch(ws.id, batchId);
  if (!batch) notFound();

  const sp = await searchParams;
  const leads = workspacePath(ws.id, "leads");
  const importBase = `${leads}/import`;
  const self = `${importBase}/${batch.id}`;
  const views = batch.status === "completed" ? REPORT_VIEWS : REVIEW_VIEWS;
  const view = views.find(([v]) => v === sp.view)?.[0] ?? "all";
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);
  const viewHref = (v: ReviewFilter, p = 1) => `${self}?${new URLSearchParams({ ...(v !== "all" ? { view: v } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`.replace(/\?$/, "");

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <Link href={importBase} className="inline-flex min-h-11 w-fit items-center gap-1 text-[14px] font-medium text-ink-muted hover:text-ink sm:min-h-0">
        <ChevronLeft aria-hidden className="size-4" />
        Imports
      </Link>
      <PageHeader
        title={batch.status === "completed" ? "Import report" : "Import CSV"}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="break-all">{batch.filename}</span>
            <span aria-hidden>·</span>
            <span>{batch.totalRows.toLocaleString("en")} rows</span>
            <StatusPill tone={STATUS_LABEL[batch.status].tone} className="h-6 px-2.5 text-[12px]">
              {STATUS_LABEL[batch.status].label}
            </StatusPill>
          </span>
        }
      />
      {batch.status !== "cancelled" ? <ImportSteps current={STEP[batch.status]} complete={batch.status === "completed"} /> : null}

      {batch.status === "mapping" ? <MapStep workspaceId={ws.id} batch={batch} /> : null}

      {batch.status === "cancelled" ? (
        <Panel className="px-5 py-8 text-center sm:px-6">
          <h2 className="text-[17px] font-semibold text-ink">This import was cancelled</h2>
          <p className="mt-1 text-[14px] text-ink-muted">Nothing from this file was added to Leads.</p>
          <Link href={importBase} className={cx(buttonClass("primary", "mt-4 h-11"))}>
            Start a new import
          </Link>
        </Panel>
      ) : null}

      {batch.status === "review" || batch.status === "processing" || batch.status === "completed" ? (
        <RowsStep
          workspaceId={ws.id}
          batch={batch}
          view={view}
          page={page}
          views={views}
          viewHref={viewHref}
          companyHref={(id) => `${leads}?company=${id}`}
          leads={leads}
        />
      ) : null}
    </div>
  );
}

async function MapStep({ workspaceId, batch }: { workspaceId: string; batch: ImportBatchView }) {
  const samples = await sampleRows(workspaceId, batch.id, 5);
  const initial = batch.mapping && batch.mapping.length === batch.headers.length ? batch.mapping : suggestMapping(batch.headers);
  return (
    <Panel aria-labelledby="map-heading" className="overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <h2 id="map-heading" className="text-[16px] font-semibold text-ink">Match your columns</h2>
        <p className="mt-0.5 text-[13.5px] text-ink-muted">
          Choose the Vleeds field for each column. Suggestions come from the column names. Columns left on Ignore are not imported.
        </p>
      </div>
      <MappingForm workspaceId={workspaceId} batchId={batch.id} headers={batch.headers} samples={samples} initial={initial} />
    </Panel>
  );
}

function count(summary: ImportSummary, v: ReviewFilter): number {
  switch (v) {
    case "all":
      return summary.total;
    case "ready":
      return summary.toImport;
    case "duplicates":
      return summary.duplicates;
    case "undecided":
      return summary.undecided;
    case "invalid":
      return summary.invalid;
    case "created":
      return summary.created;
    case "merged":
      return summary.merged;
    case "skipped":
      return summary.skipped;
    case "failed":
      return summary.failed;
  }
}

async function RowsStep({
  workspaceId,
  batch,
  view,
  page,
  views,
  viewHref,
  companyHref,
  leads,
}: {
  workspaceId: string;
  batch: ImportBatchView;
  view: ReviewFilter;
  page: number;
  views: [ReviewFilter, string][];
  viewHref: (v: ReviewFilter, p?: number) => string;
  companyHref: (id: string) => string;
  leads: string;
}) {
  const result = await listImportRows(workspaceId, batch.id, view, page);
  const { summary } = result;
  const report = batch.status === "completed";

  return (
    <>
      {report ? (
        <Panel aria-labelledby="report-heading" className="px-5 py-5 sm:px-6">
          <h2 id="report-heading" className="text-[16px] font-semibold text-ink">Import complete</h2>
          <dl role="status" aria-live="polite" className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["Total rows", summary.total],
                ["Created", summary.created],
                ["Merged", summary.merged],
                ["Skipped", summary.skipped],
                ["Invalid", summary.invalid],
                ["Failed", summary.failed],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-lg border border-line bg-surface-muted px-3.5 py-2.5">
                <dt className="text-[12.5px] text-ink-subtle">{label}</dt>
                <dd className={cx("text-[22px] font-semibold tabular-nums", label === "Failed" && n > 0 ? "text-danger" : "text-ink")}>{n.toLocaleString("en")}</dd>
              </div>
            ))}
          </dl>
          <Link href={leads} className={buttonClass("primary", "mt-4 h-11")}>
            Go to Leads
          </Link>
        </Panel>
      ) : (
        <Panel aria-label="Import" className="overflow-hidden">
          <ImportRunner workspaceId={workspaceId} batchId={batch.id} summary={summary} processing={batch.status === "processing"} />
        </Panel>
      )}

      <Panel aria-labelledby="rows-heading" className="min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4">
          <h2 id="rows-heading" className="text-[15px] font-semibold text-ink">
            {report ? "Row outcomes" : "Review rows"}
          </h2>
          <nav aria-label={report ? "Filter outcomes" : "Filter rows"} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {views.map(([v, label]) => (
              <Link
                key={v}
                href={viewHref(v)}
                scroll={false}
                aria-current={v === view ? "page" : undefined}
                className={cx(
                  "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-medium sm:h-9",
                  v === view ? "border-brand bg-brand-tint text-brand-strong" : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
                )}
              >
                {label}
                <span className="tabular-nums text-ink-subtle">{count(summary, v).toLocaleString("en")}</span>
              </Link>
            ))}
          </nav>
        </div>
        {result.rows.length ? (
          <ReviewRows rows={result.rows} mode={report ? "report" : "review"} workspaceId={workspaceId} batchId={batch.id} companyHref={companyHref} />
        ) : (
          <p className="px-5 py-10 text-center text-[14px] text-ink-muted">No rows in this view.</p>
        )}
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          total={result.filterTotal}
          pageSize={IMPORT_LIMITS.reviewPageSize}
          noun={["row", "rows"]}
          hrefFor={(p) => viewHref(view, p)}
        />
      </Panel>
    </>
  );
}
