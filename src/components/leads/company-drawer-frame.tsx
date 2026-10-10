"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

const DESKTOP = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Frame for the company drawer, whose open state lives in the URL
 * (`?company=<id>`), so it is shareable and re-authorized on every request.
 *
 *  - lg+: an inline column beside the table (non-modal; Escape closes).
 *  - < lg: a modal <dialog> sheet from the right (focus trapped, page inert,
 *    Escape/backdrop close).
 * Focus moves to the drawer title on open and back to the company's row link
 * on close.
 */
export function CompanyDrawerFrame({
  companyId,
  titleId,
  closeHref,
  children,
}: {
  companyId: string;
  titleId: string;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  // Server render assumes desktop; the aside is hidden below lg until hydration picks the sheet.
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP).matches, () => true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => router.push(closeHref, { scroll: false });

  useEffect(() => {
    if (!desktop && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    document.getElementById(titleId)?.focus();
  }, [desktop, titleId]);

  useEffect(
    () => () => {
      // Return focus to this company's (visible) row link when the drawer goes away.
      const links = document.querySelectorAll<HTMLElement>(`[data-company-link="${companyId}"]`);
      [...links].find((l) => l.offsetParent !== null)?.focus();
    },
    [companyId],
  );

  const closeButton = (
    <Link
      href={closeHref}
      scroll={false}
      aria-label="Close company details"
      className="absolute right-4 top-4 grid size-10 place-items-center rounded-full text-ink-muted hover:bg-sunken"
    >
      <X aria-hidden className="size-5" />
    </Link>
  );

  if (desktop) {
    return (
      <aside
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          // A sheet opened from inside the drawer handles its own Escape.
          if (e.key === "Escape" && !(e.target as Element).closest("dialog")) close();
        }}
        className="relative hidden max-h-[calc(100dvh-112px)] overflow-y-auto rounded-xl border border-line bg-surface shadow-card lg:sticky lg:top-[92px] lg:block"
      >
        {closeButton}
        {children}
      </aside>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (e.target !== dialogRef.current) return; // a nested sheet's own Escape
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) close();
      }}
      className="pb-safe fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-[440px] overflow-y-auto border-l border-line bg-surface p-0 text-ink shadow-drawer backdrop:bg-ink/25 sm:rounded-l-2xl"
    >
      <div className="relative">
        {closeButton}
        {children}
      </div>
    </dialog>
  );
}
