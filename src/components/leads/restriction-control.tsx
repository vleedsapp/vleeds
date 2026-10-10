"use client";

import { Ban } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { addRestriction, liftRestriction } from "@/app/w/[workspaceId]/leads/actions";
import { Alert, Button, inputClass } from "@/components/ui/primitives";

/**
 * Add or lift a do-not-contact restriction for a company or one contact.
 * Members can add; owners/admins can lift (the server and RLS enforce this;
 * for members the lift control is replaced by an explanation).
 */
export function RestrictionControl({
  workspaceId,
  companyId,
  contact,
  restriction,
  canLift,
}: {
  workspaceId: string;
  companyId: string;
  contact?: { id: string; name: string };
  restriction: { id: string; reason: string | null } | null;
  canLift: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reasonId = useId();
  const subject = contact ? contact.name : "this company";
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await fn();
        if (result.ok) {
          setAdding(false);
          setReason("");
        } else setError(result.error ?? "This couldn't be saved.");
      } catch {
        setError("This couldn't be saved. Check your connection and try again.");
      }
    });

  if (restriction) {
    return (
      <div className="flex flex-col gap-2">
        {canLift ? (
          <Button
            type="button"
            className="h-11 self-start sm:h-9"
            disabled={pending}
            onClick={() => run(() => liftRestriction(workspaceId, restriction.id) as Promise<{ ok: boolean; error?: string }>)}
          >
            {pending ? "Lifting…" : `Lift restriction${contact ? ` for ${contact.name}` : ""}`}
          </Button>
        ) : (
          <p className="text-[12.5px] text-ink-subtle">Only an owner or admin can lift this restriction.</p>
        )}
        {error ? <Alert>{error}</Alert> : null}
      </div>
    );
  }

  if (!adding) {
    return (
      <Button type="button" variant="ghost" className="h-11 self-start px-2 text-[13.5px] sm:h-9" onClick={() => setAdding(true)} aria-label={`Do not contact ${subject}`}>
        <Ban aria-hidden className="size-4" />
        {contact ? "Do not contact" : "Do not contact this company"}
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-line bg-surface-muted p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          addRestriction(workspaceId, {
            scope: contact ? "contact" : "company",
            companyId,
            contactId: contact?.id ?? null,
            reason,
          }) as Promise<{ ok: boolean; error?: string }>,
        );
      }}
    >
      <p className="text-[13.5px] font-medium text-ink">{contact ? `Do not contact ${contact.name}` : "Do not contact this company"}</p>
      <label htmlFor={reasonId} className="text-[12.5px] text-ink-subtle">
        Reason (optional)
      </label>
      <input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus className={inputClass} />
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" className="h-11 sm:h-9" onClick={() => setAdding(false)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" className="h-11 sm:h-9" disabled={pending}>
          {pending ? "Saving…" : "Restrict"}
        </Button>
      </div>
    </form>
  );
}
