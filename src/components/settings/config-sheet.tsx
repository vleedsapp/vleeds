"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert, Button, cx, IconCircle } from "@/components/ui/primitives";

/**
 * The one editing surface for Settings: a right-side sheet on sm+ and a
 * near-full-height bottom sheet on phones. Built on a modal <dialog>, so focus
 * is trapped, the page is inert and Escape is handled natively.
 *
 * Mount it only while editing. It opens on mount, remembers the control that
 * opened it and returns focus there when it closes.
 *
 * Closing rules: Cancel discards immediately (explicit). Escape, the close
 * button and a backdrop click ask for confirmation when there are unsaved
 * changes. A dirty sheet also arms the browser's leave-page warning.
 */
export function ConfigSheet({
  title,
  description,
  icon,
  dirty,
  readOnly,
  pending,
  error,
  onSave,
  onClose,
  children,
  saveLabel = "Save",
  pendingLabel = "Saving…",
  hideCancel,
  wide,
  cancelLabel = "Cancel",
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  dirty: boolean;
  readOnly?: boolean;
  pending?: boolean;
  error?: string | null;
  onSave?: () => void;
  onClose: () => void;
  children: ReactNode;
  saveLabel?: string;
  /** Button text while `pending` (e.g. "Finding domains…"). */
  pendingLabel?: string;
  /** Hide Cancel when the primary action already closes (e.g. a final "Done"). */
  hideCancel?: boolean;
  /** A wider right sheet on sm+ for review tables (P1-E5); phones are unchanged. */
  wide?: boolean;
  /** Text of the secondary footer button (e.g. "Close" on a read-only result). */
  cancelLabel?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const guard = dirty && !readOnly;

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      // Return focus to the control that opened the sheet (if it still exists).
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (!guard) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guard]);

  useEffect(() => {
    if (confirming) keepEditingRef.current?.focus();
  }, [confirming]);

  const requestClose = () => {
    if (pending) return;
    if (guard) setConfirming(true);
    else onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!readOnly && !pending) onSave?.();
  };

  const titleId = "config-sheet-title";
  const descriptionId = "config-sheet-description";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (confirming) setConfirming(false);
        else requestClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) requestClose();
      }}
      // If the browser closes the dialog itself, keep React state in sync. The
      // `close` event is queued, so it can arrive after the dialog was already
      // re-opened: React Strict Mode (dev) runs the mount effect's cleanup and
      // then mounts again, and the cleanup's close() would otherwise dismiss
      // the sheet the moment it opens. Only a dialog that is still closed counts.
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      className={cx(
        "fixed inset-x-0 bottom-0 top-auto m-0 h-[92dvh] max-h-none w-full max-w-none overflow-hidden rounded-t-2xl border-t border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-ink/25 sm:inset-y-0 sm:left-auto sm:right-0 sm:h-dvh sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0 sm:shadow-drawer",
        wide ? "sm:w-[min(1040px,100vw)]" : "sm:w-[min(560px,100vw)]",
      )}
    >
      <form onSubmit={submit} noValidate className="flex h-full flex-col">
        <div className="relative flex items-start gap-3.5 border-b border-line px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <span aria-hidden className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong sm:hidden" />
          <IconCircle tone="brand" size="md">
            {icon}
          </IconCircle>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={titleId} className="text-[18px] font-semibold leading-6 tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-[13.5px] leading-5 text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1 grid size-10 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sunken hover:text-ink"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {error ? (
            <div className="mb-4">
              <Alert>{error}</Alert>
            </div>
          ) : null}
          {children}
        </div>

        <div className="pb-safe border-t border-line bg-surface">
          {confirming ? (
            <div role="alert" className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:px-6">
              <p className="flex-1 text-[14px] font-medium text-ink">Discard your unsaved changes?</p>
              <div className="flex gap-2">
                <Button ref={keepEditingRef} type="button" className="h-11 flex-1 sm:h-10 sm:flex-none" onClick={() => setConfirming(false)}>
                  Keep editing
                </Button>
                <Button type="button" variant="primary" className="h-11 flex-1 sm:h-10 sm:flex-none" onClick={onClose}>
                  Discard changes
                </Button>
              </div>
            </div>
          ) : readOnly ? (
            <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
              <p className="flex-1 text-[13px] text-ink-subtle">Only owners and admins can change this.</p>
              <Button type="button" className="h-11 sm:h-10" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-2 px-5 py-3.5 sm:px-6">
              {hideCancel ? null : (
                <Button type="button" className="h-11 flex-1 sm:h-10 sm:flex-none" onClick={onClose} disabled={pending}>
                  {cancelLabel}
                </Button>
              )}
              <Button type="submit" variant="primary" className="h-11 flex-1 sm:h-10 sm:min-w-24 sm:flex-none" disabled={pending}>
                {pending ? pendingLabel : saveLabel}
              </Button>
            </div>
          )}
        </div>
      </form>
    </dialog>
  );
}
