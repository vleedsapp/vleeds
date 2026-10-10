"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { uploadCsv } from "@/app/w/[workspaceId]/leads/import/actions";
import { Alert, Button } from "@/components/ui/primitives";
import { checkCsvFile, IMPORT_LIMITS } from "@/lib/imports/limits";

/** CSV file picker. Checked here for quick feedback and again on the server (which also parses it). */
export function UploadForm({ workspaceId, importBase }: { workspaceId: string; importBase: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!file) {
      setError("Choose a CSV file to upload.");
      return;
    }
    const local = checkCsvFile(file);
    if (local) {
      setError(local.message);
      return;
    }
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      try {
        const result = await uploadCsv(workspaceId, data);
        if (result.ok) router.push(`${importBase}/${result.data.batchId}`);
        else setError(result.error);
      } catch {
        setError("The file couldn't be uploaded. Check your connection and try again.");
      }
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <label
        htmlFor="csv-file"
        className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-line-strong bg-surface-muted px-5 py-10 text-center hover:border-brand/50"
      >
        <span aria-hidden className="grid size-14 place-items-center rounded-2xl bg-brand-tint text-brand-strong">
          <FileUp className="size-7 stroke-[1.6]" />
        </span>
        <span className="text-[16px] font-semibold text-ink">{file ? file.name : "Choose a CSV file"}</span>
        <span className="text-[13.5px] text-ink-muted">
          {file
            ? `${(file.size / 1024).toLocaleString("en", { maximumFractionDigits: 0 })} KB`
            : `CSV only · up to ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB · ${IMPORT_LIMITS.maxRows.toLocaleString("en")} rows · first row = column names`}
        </span>
        <input
          id="csv-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          aria-describedby={error ? "csv-file-error" : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="sr-only"
        />
      </label>
      {error ? (
        <div id="csv-file-error">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="lg" className="h-11 w-full sm:w-auto" disabled={pending}>
          {pending ? "Reading file…" : "Upload and continue"}
        </Button>
      </div>
      <p aria-live="polite" className="sr-only">
        {pending ? "Reading the file." : ""}
      </p>
    </form>
  );
}
