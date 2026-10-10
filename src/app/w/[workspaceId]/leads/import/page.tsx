import { ChevronLeft, FileUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ImportSteps, STATUS_LABEL } from "@/components/imports/import-steps";
import { UploadForm } from "@/components/imports/upload-form";
import { Panel, PanelHeader, PageHeader, StatusPill } from "@/components/ui/primitives";
import { getWorkspace, listRecentImports } from "@/lib/dal";
import { workspacePath } from "@/lib/navigation";

export const metadata: Metadata = { title: "Import CSV" };

/**
 * Import CSV, step 1: choose a file. Nothing is written to the lead core
 * here; rows are staged for mapping and review. Recent imports of this
 * workspace are listed so an unfinished one can be resumed.
 */
export default async function ImportPage({ params }: PageProps<"/w/[workspaceId]/leads/import">) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const leads = workspacePath(ws.id, "leads");
  const base = `${leads}/import`;
  const recent = await listRecentImports(ws.id, 10);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <Link href={leads} className="inline-flex min-h-11 w-fit items-center gap-1 text-[14px] font-medium text-ink-muted hover:text-ink sm:min-h-0">
        <ChevronLeft aria-hidden className="size-4" />
        Leads
      </Link>
      <PageHeader title="Import CSV" description="Add companies and contacts from a spreadsheet. You review everything before it is saved." />
      <ImportSteps current="Upload" />

      <Panel aria-labelledby="upload-heading" className="p-5 sm:p-6">
        <div className="mb-5">
          <PanelHeader id="upload-heading" icon={<FileUp className="stroke-[1.75]" />} title="Choose a file" description="Each row should describe one company, optionally with one contact." />
        </div>
        <UploadForm workspaceId={ws.id} importBase={base} />
      </Panel>

      {recent.length ? (
        <Panel aria-labelledby="recent-heading" className="overflow-hidden">
          <h2 id="recent-heading" className="border-b border-line px-5 py-4 text-[15px] font-semibold text-ink">
            Recent imports
          </h2>
          <ul className="divide-y divide-line">
            {recent.map((b) => (
              <li key={b.id}>
                <Link href={`${base}/${b.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-muted">
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px] font-medium text-ink">{b.filename}</span>
                    <span className="block text-[13px] text-ink-subtle">
                      {b.totalRows.toLocaleString("en")} rows · {new Date(b.createdAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
                      {b.status === "completed" ? ` · ${b.createdRows} created, ${b.mergedRows} merged` : ""}
                    </span>
                  </span>
                  <StatusPill tone={STATUS_LABEL[b.status].tone} className="h-6 px-2.5 text-[12px]">
                    {STATUS_LABEL[b.status].label}
                  </StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
