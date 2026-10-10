"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button, IconCircle } from "@/components/ui/primitives";

/** Shared body for error.tsx boundaries. Never renders raw error messages (may contain internals). */
export function ErrorPanel({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto my-10 flex max-w-md flex-col items-center rounded-2xl border border-line bg-surface p-6 text-center shadow-card sm:p-8"
    >
      <IconCircle tone="warning" size="lg">
        <TriangleAlert className="stroke-[1.75]" />
      </IconCircle>
      <h1 className="mt-4 text-[19px] font-semibold text-ink">Something went wrong</h1>
      <p className="mt-2 text-[15px] leading-6 text-ink-muted">
        This view couldn&apos;t be loaded. Try again; if the problem continues, contact your workspace administrator.
      </p>
      {error.digest ? <p className="mt-2 font-mono text-[11px] text-ink-subtle">Reference: {error.digest}</p> : null}
      <Button variant="secondary" className="mt-5" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
