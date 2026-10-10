"use client";

import { Building, Check, ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { cx } from "@/components/ui/primitives";
import { useDismiss } from "@/components/ui/use-dismiss";
import type { WorkspaceSummary } from "@/lib/dal";
import { sectionFromPath, workspacePath } from "@/lib/navigation";

function groupByOrganization(workspaces: WorkspaceSummary[]) {
  const groups = new Map<string, { name: string; items: WorkspaceSummary[] }>();
  for (const ws of workspaces) {
    const group = groups.get(ws.organization.id) ?? { name: ws.organization.name, items: [] };
    group.items.push(ws);
    groups.set(ws.organization.id, group);
  }
  return [...groups.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));
}

/**
 * Workspaces grouped by organization. `workspaces` is the RLS-filtered list
 * from the server; links keep the current section (/w/A/leads → /w/B/leads).
 * Shared by the desktop dropdown and the mobile workspace sheet.
 */
export function WorkspaceList({
  current,
  workspaces,
  roleItem = "menuitem",
  onNavigate,
}: {
  current: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  roleItem?: "menuitem" | undefined;
  onNavigate?: () => void;
}) {
  const section = sectionFromPath(usePathname());
  return (
    <>
      {groupByOrganization(workspaces).map(([orgId, group]) => (
        <div key={orgId} role="group" aria-label={group.name} className="py-1">
          <div className="px-3 pb-1.5 pt-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-subtle">
            {group.name}
          </div>
          {group.items.map((ws) => {
            const active = ws.id === current.id;
            return (
              <Link
                key={ws.id}
                role={roleItem}
                href={workspacePath(ws.id, section)}
                aria-current={active ? "true" : undefined}
                onClick={onNavigate}
                className={cx(
                  "mx-1.5 flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 text-[14.5px]",
                  active ? "bg-brand-tint font-medium text-brand-strong" : "text-ink hover:bg-surface-muted",
                )}
              >
                <WorkspaceIcon small active={active} />
                <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                {active ? <Check aria-hidden className="size-4 text-brand" /> : null}
              </Link>
            );
          })}
        </div>
      ))}
      <div className="mt-1 border-t border-line pt-1.5">
        <Link
          role={roleItem}
          href="/workspaces/new"
          onClick={onNavigate}
          className="mx-1.5 mb-1 flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 text-[14.5px] text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          <span className="grid size-8 place-items-center rounded-lg border border-dashed border-line-strong">
            <Plus aria-hidden className="size-4" />
          </span>
          New workspace
        </Link>
      </div>
    </>
  );
}

/** Desktop sidebar workspace selector (canonical card + dropdown). */
export function WorkspaceSwitcher({ current, workspaces }: { current: WorkspaceSummary; workspaces: WorkspaceSummary[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef, triggerRef);

  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2.5 text-left shadow-card transition-colors hover:border-line-strong"
      >
        <WorkspaceIcon />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink underline decoration-ink/25 underline-offset-[3px]">
            {current.name}
          </span>
          <span className="block truncate text-[12.5px] text-ink-subtle">{current.organization.name}</span>
        </span>
        <ChevronDown aria-hidden className={cx("size-4 shrink-0 text-ink-muted transition-transform", open && "rotate-180")} />
        <span className="sr-only">Switch workspace</span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Workspaces"
          className="absolute left-0 top-full z-40 mt-1.5 max-h-[min(440px,70vh)] w-[288px] overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-pop"
        >
          <WorkspaceList current={current} workspaces={workspaces} />
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceIcon({ small, active }: { small?: boolean; active?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid shrink-0 place-items-center rounded-lg",
        active || !small ? "bg-brand-tint text-brand-strong" : "bg-sunken text-ink-muted",
        small ? "size-8 [&_svg]:size-4" : "size-8 [&_svg]:size-[17px]",
      )}
    >
      <Building className="stroke-[1.75]" />
    </span>
  );
}
