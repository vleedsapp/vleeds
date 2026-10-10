"use client";

import { Bell, ChevronDown, LogOut, Search } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import { cx, IconButton, Kbd } from "@/components/ui/primitives";
import { useDismiss } from "@/components/ui/use-dismiss";
import { initialsFromEmail } from "@/lib/format";

/**
 * Global search field. There is no search backend in this phase, so the
 * field is honest about it: it focuses with ⌘K / Ctrl+K and explains when
 * search becomes available. No queries are sent anywhere.
 */
export function SearchField() {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const hintId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      ref={rootRef}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
      className="relative w-full max-w-[740px]"
    >
      <label htmlFor="global-search" className="sr-only">
        Search companies, contacts, or keywords
      </label>
      <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-subtle" />
      <input
        ref={inputRef}
        id="global-search"
        type="search"
        autoComplete="off"
        placeholder="Search companies, contacts, or keywords..."
        aria-describedby={open ? hintId : undefined}
        aria-keyshortcuts="Meta+K Control+K"
        onFocus={() => setOpen(true)}
        className="h-11 w-full rounded-lg border border-line bg-surface pl-12 pr-20 text-[14.5px] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15 [&::-webkit-search-cancel-button]:hidden"
      />
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 gap-1">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </span>
      {open ? (
        <div
          id={hintId}
          role="status"
          className="absolute inset-x-0 top-full z-40 mt-1.5 rounded-xl border border-line bg-surface px-4 py-3 text-[13.5px] text-ink-muted shadow-pop"
        >
          Search across companies and contacts becomes available once this workspace has leads.
        </div>
      ) : null}
    </form>
  );
}

/** Notifications. None exist in this phase; the panel says so (no unread dot is shown). */
export function NotificationsButton({ align = "right", compact }: { align?: "right" | "left"; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef, triggerRef);

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        ref={triggerRef}
        label="Notifications"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        size={compact ? "sm" : "md"}
      >
        <Bell aria-hidden className="size-[22px] stroke-[1.75]" />
      </IconButton>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className={cx(
            "absolute top-full z-40 mt-2 w-[min(320px,calc(100vw-32px))] rounded-xl border border-line bg-surface p-4 shadow-pop",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <p className="text-[14px] font-semibold text-ink">No notifications</p>
          <p className="mt-1 text-[13.5px] leading-5 text-ink-muted">
            Reminders about callbacks and follow-ups will appear here.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function Avatar({ email, size = "md" }: { email: string | null; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid shrink-0 place-items-center rounded-full bg-sunken font-semibold text-ink",
        size === "sm" ? "size-9 text-[13px]" : "size-11 text-[14px]",
      )}
    >
      {initialsFromEmail(email)}
    </span>
  );
}

/** Desktop account/avatar menu: identity + sign out. */
export function AccountMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef, triggerRef);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full p-0.5 pr-1.5 hover:bg-sunken"
      >
        <Avatar email={email} />
        <ChevronDown aria-hidden className={cx("size-4 text-ink-muted transition-transform", open && "rotate-180")} />
        <span className="sr-only">Account menu</span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-line bg-surface py-1.5 shadow-pop"
        >
          <div className="px-4 pb-2.5 pt-1.5">
            <p className="text-[12px] text-ink-subtle">Signed in as</p>
            <p className="truncate text-[14px] font-medium text-ink" title={email ?? undefined}>
              {email ?? "Signed in"}
            </p>
          </div>
          <div className="border-t border-line pt-1.5">
            <form action={signOut}>
              <button
                type="submit"
                role="menuitem"
                className="mx-1.5 flex w-[calc(100%-12px)] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[14px] text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                <LogOut aria-hidden className="size-4" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
