"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { backToMapping, cancelImport, continueImport, startImport } from "@/app/w/[workspaceId]/leads/import/actions";
import { Alert, Button } from "@/components/ui/primitives";
import type { ImportSummary } from "@/lib/imports/summary";
import { CancelImportButton } from "./cancel-import-button";

/**
 * Confirmation + commit. The commit runs in chunks (one server action per
 * chunk, one transaction per row) so large files never depend on one long
 * request; progress is announced. A reload while processing resumes here.
 */
export function ImportRunner({
  workspaceId,
  batchId,
  summary,
  processing,
}: {
  workspaceId: string;
  batchId: string;
  summary: ImportSummary;
  processing: boolean;
}) {
  const [running, setRunning] = useState(processing);
  const [progress, setProgress] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);

  const loop = async (first: () => ReturnType<typeof continueImport>) => {
    setRunning(true);
    setError(null);
    try {
      let result = await first();
      while (result.ok && !result.data.done) {
        setProgress(result.data.summary);
        result = await continueImport(workspaceId, batchId);
      }
      if (!result.ok) {
        setError(result.error);
        setRunning(false);
      } else setProgress(result.data.summary);
    } catch {
      setError("The import was interrupted. Reload the page to continue where it stopped.");
      setRunning(false);
    }
  };

  // Resume an import that was already processing (e.g. after a reload).
  useEffect(() => {
    if (processing && !started.current) {
      started.current = true;
      void loop(() => continueImport(workspaceId, batchId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processing]);

  const total = summary.total;

  if (running) {
    return (
      <div className="flex flex-col gap-3 px-5 py-5">
        <p role="status" aria-live="polite" className="text-[15px] font-medium text-ink">
          Importing… {progress ? `${(progress.total - progress.pending).toLocaleString("en")} of ${total.toLocaleString("en")} rows processed` : "starting"}
        </p>
        <div aria-hidden className="h-2 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${progress ? Math.round(((progress.total - progress.pending) / Math.max(total, 1)) * 100) : 2}%` }} />
        </div>
        <p className="text-[13px] text-ink-subtle">Keep this page open. If it closes, opening the import again continues where it stopped.</p>
        {error ? <Alert>{error}</Alert> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-5">
      <div>
        <h2 className="text-[16px] font-semibold text-ink">Ready to import</h2>
        <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[14px] text-ink-muted sm:grid-cols-3 lg:grid-cols-6">
          <li><span className="font-semibold tabular-nums text-ink">{summary.toCreate}</span> new companies</li>
          <li><span className="font-semibold tabular-nums text-ink">{summary.toMerge}</span> merges</li>
          <li><span className="font-semibold tabular-nums text-ink">{summary.toSkip}</span> skipped</li>
          <li><span className="font-semibold tabular-nums text-ink">{summary.invalid}</span> invalid</li>
          <li className={summary.undecided ? "text-warning" : undefined}><span className="font-semibold tabular-nums">{summary.undecided}</span> need a decision</li>
          <li><span className="font-semibold tabular-nums text-ink">{summary.total}</span> rows in file</li>
        </ul>
        {summary.undecided ? (
          <p className="mt-2 text-[13px] text-warning">Rows without a decision will be skipped. Use the Duplicates or Needs decision view to decide.</p>
        ) : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="h-11" disabled={pending} onClick={() => startTransition(async () => { const r = await backToMapping(workspaceId, batchId); if (!r.ok) setError(r.error); })}>
            Back to mapping
          </Button>
          <CancelImportButton disabled={pending} onConfirm={() => startTransition(async () => { const r = await cancelImport(workspaceId, batchId); if (!r.ok) setError(r.error); })} />
        </div>
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="h-11"
          disabled={summary.toImport === 0 || pending}
          onClick={() => void loop(() => startImport(workspaceId, batchId))}
        >
          Import {summary.toImport.toLocaleString("en")} {summary.toImport === 1 ? "row" : "rows"}
        </Button>
      </div>
    </div>
  );
}
