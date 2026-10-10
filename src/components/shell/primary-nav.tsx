"use client";

import { Calendar, Compass, House, Send, Settings, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/primitives";
import { SECTIONS, sectionFromPath, workspacePath, type SectionSlug } from "@/lib/navigation";

// Canonical references: desktop "Today" uses a calendar, mobile uses a house.
const DESKTOP_ICONS: Record<SectionSlug, LucideIcon> = {
  today: Calendar,
  discover: Compass,
  leads: Users,
  campaigns: Send,
  settings: Settings,
};
const MOBILE_ICONS: Record<SectionSlug, LucideIcon> = { ...DESKTOP_ICONS, today: House };

/** Desktop sidebar navigation. Active: green tint fill + green icon/label. */
export function PrimaryNav({ workspaceId }: { workspaceId: string }) {
  const active = sectionFromPath(usePathname());
  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-1">
        {SECTIONS.map(({ slug, label }) => {
          const Icon = DESKTOP_ICONS[slug];
          const isActive = slug === active;
          return (
            <li key={slug}>
              <Link
                href={workspacePath(workspaceId, slug)}
                aria-current={isActive ? "page" : undefined}
                className={cx(
                  "flex h-12 items-center gap-3.5 rounded-lg px-3.5 text-[15.5px] transition-colors",
                  isActive
                    ? "bg-brand-tint font-medium text-brand-strong"
                    : "text-ink-muted hover:bg-sunken hover:text-ink",
                )}
              >
                <Icon aria-hidden className={cx("size-[22px] stroke-[1.75]", isActive ? "text-brand" : "text-ink-muted")} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Filled house for the active mobile "Today" item (canonical mobile reference). */
function HouseFilled() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-6">
      <path
        d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        fill="var(--color-brand)"
        stroke="var(--color-brand)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9.5 21v-6.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V21z" fill="var(--color-brand-tint)" />
    </svg>
  );
}

/**
 * Persistent mobile bottom navigation (< lg). Primary sections are always one
 * tap away; no drawer is needed to move between them. Honors safe areas.
 */
export function MobileBottomNav({ workspaceId }: { workspaceId: string }) {
  const active = sectionFromPath(usePathname());
  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border-t border-line bg-surface shadow-[0_-6px_20px_-12px_rgb(22_25_28/0.18)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-between gap-1 px-2 pt-2 pb-1.5">
        {SECTIONS.map(({ slug, label }) => {
          const Icon = MOBILE_ICONS[slug];
          const isActive = slug === active;
          return (
            <li key={slug} className="min-w-0 flex-1">
              <Link
                href={workspacePath(workspaceId, slug)}
                aria-current={isActive ? "page" : undefined}
                className={cx(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[11.5px] min-[380px]:text-[12.5px]",
                  isActive ? "bg-brand-tint font-medium text-brand-strong" : "text-ink-muted active:bg-sunken",
                )}
              >
                {isActive && slug === "today" ? (
                  <HouseFilled />
                ) : (
                  <Icon aria-hidden className={cx("size-6", isActive ? "stroke-[2] text-brand" : "stroke-[1.6]")} />
                )}
                <span className="max-w-full truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
