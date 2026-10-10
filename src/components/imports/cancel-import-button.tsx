"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";

/**
 * "Cancel import" with a confirmation step: cancelling can't be undone, and
 * the button sits next to the primary action (stacked on phones).
 */
export function CancelImportButton({ disabled, onConfirm }: { disabled?: boolean; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" className="h-11" disabled={disabled} onClick={() => setConfirming(true)}>
        Cancel import
      </Button>
    );
  }
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-line bg-surface-muted px-3 py-2.5 sm:flex-row sm:items-center">
      <p className="text-[13.5px] text-ink">Cancel this import? Nothing from the file will be added.</p>
      <div className="flex gap-2">
        <Button ref={keep} type="button" className="h-11 flex-1 sm:h-9 sm:flex-none" onClick={() => setConfirming(false)}>
          Keep import
        </Button>
        <Button type="button" variant="primary" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={disabled} onClick={onConfirm}>
          Yes, cancel
        </Button>
      </div>
    </div>
  );
}
