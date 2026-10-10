"use client";

import { Briefcase, ChevronDown, LogOut, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import { VleedsLogo, VleedsMark } from "@/components/ui/brand";
import type { WorkspaceSummary } from "@/lib/dal";
import { Avatar, NotificationsButton } from "./top-bar";
import { WorkspaceList } from "./workspace-switcher";

/**
 * Mobile/tablet header (< lg): logo, workspace pill, notifications, avatar.
 * The pill and avatar open the workspace & account sheet, which holds the
 * SECONDARY functions only (switch workspace/org, new workspace, sign out).
 * Primary navigation lives in the persistent bottom bar.
 */
export function MobileHeader({
  workspace,
  workspaces,
  userEmail,
}: {
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  userEmail: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <>
      <header className="pt-safe sticky top-0 z-20 border-b border-line/70 bg-canvas/95 backdrop-blur-sm lg:hidden">
        <div className="flex h-16 items-center gap-1.5 px-4 min-[385px]:gap-2">
          {/* Wrapper spans own the breakpoint display so component classes can't override it. */}
          <span className="hidden shrink-0 min-[385px]:inline-flex">
            <VleedsLogo compact />
          </span>
          <span className="inline-flex shrink-0 min-[385px]:hidden">
            <VleedsMark className="h-[22px] w-7" />
            <span className="sr-only">Vleeds</span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            title={workspace.name}
            className="mx-auto flex h-11 min-w-0 max-w-[240px] flex-1 items-center gap-1.5 rounded-full border border-line bg-surface px-3 shadow-card"
          >
            <Briefcase aria-hidden className="hidden size-[18px] shrink-0 stroke-[1.75] text-ink-muted min-[400px]:block" />
            <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-ink">{workspace.name}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
            <span className="sr-only">: switch workspace</span>
          </button>
          <NotificationsButton compact />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label="Account and workspaces"
            className="shrink-0 rounded-full"
          >
            <Avatar email={userEmail} size="sm" />
          </button>
        </div>
      </header>

      <dialog
        ref={dialogRef}
        aria-label="Workspace and account"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false); // backdrop tap
        }}
        className="pb-safe fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-ink/25 lg:hidden"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <span aria-hidden className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong" />
          <h2 className="pt-1.5 text-[16px] font-semibold">Workspaces</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="grid size-10 place-items-center rounded-full text-ink-muted hover:bg-sunken"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="py-1">
          <WorkspaceList current={workspace} workspaces={workspaces} roleItem={undefined} onNavigate={() => setOpen(false)} />
        </div>
        <div className="border-t border-line px-4 py-3">
          <p className="text-[12px] text-ink-subtle">Signed in as</p>
          <p className="truncate text-[14.5px] font-medium">{userEmail ?? "Signed in"}</p>
          <form action={signOut} className="mt-3">
            <button
              type="submit"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-line-strong text-[14.5px] font-medium text-ink hover:bg-surface-muted"
            >
              <LogOut aria-hidden className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
