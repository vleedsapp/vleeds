"use client";

import { Funnel, Search } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button, cx } from "@/components/ui/primitives";

export type QueueTab = "queue" | "callbacks" | "followUps" | "discoveries";

export type QueueTabSpec<K extends string = string> = { key: K; label: string; emptyTitle: string; emptyBody: ReactNode; emptyAction?: ReactNode };

const DEFAULT_TABS: QueueTabSpec<QueueTab>[] = [
  {
    key: "queue",
    label: "Lead Queue",
    emptyTitle: "Nothing due today",
    emptyBody: "Follow-ups you schedule on leads will collect here, ordered by when they are due.",
  },
  {
    key: "callbacks",
    label: "Callbacks",
    emptyTitle: "No callbacks due",
    emptyBody: "Callbacks requested by contacts will appear here on the day they are due.",
  },
  {
    key: "followUps",
    label: "Follow-ups",
    emptyTitle: "No follow-ups due",
    emptyBody: "Follow-ups you schedule after a call or email will be listed here.",
  },
  {
    key: "discoveries",
    label: "New Discoveries",
    emptyTitle: "No new discoveries",
    emptyBody: "Companies found through Discover will appear here for review.",
  },
];

/**
 * Today's work panel: tabs + content. Each tab renders `content[tab]` when
 * provided, otherwise a truthful empty state. Toolbar (search/filter) is only
 * shown when there are rows to act on.
 */
export function TodayQueue<K extends string = QueueTab>({
  counts,
  content = {},
  showToolbar,
  showTabsOnMobile,
  tabs = DEFAULT_TABS as unknown as QueueTabSpec<K>[],
  initialTab,
}: {
  counts: Record<K, number>;
  content?: Partial<Record<K, ReactNode>>;
  showToolbar?: boolean;
  showTabsOnMobile?: boolean;
  /** Tab definitions (P1-E7 Today passes its operational queues); defaults to the canonical fixture tabs. */
  tabs?: QueueTabSpec<K>[];
  initialTab?: K;
}) {
  const TABS = tabs;
  const [active, setActive] = useState<K>(initialTab ?? TABS[0].key);
  const baseId = useId();
  const tab = TABS.find((t) => t.key === active) ?? TABS[0];

  return (
    <section aria-label="Today's work" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div
        className={cx(
          "items-center justify-between gap-3 border-b border-line px-3 sm:px-5",
          showTabsOnMobile ? "flex" : "hidden sm:flex",
        )}
      >
        <div role="tablist" aria-label="Work queues" className="-mb-px flex min-w-0 gap-1 overflow-x-auto sm:gap-4">
          {TABS.map((t) => {
            const selected = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`${baseId}-${t.key}-tab`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(t.key)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  const i = TABS.findIndex((x) => x.key === active);
                  const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
                  setActive(next.key);
                  document.getElementById(`${baseId}-${next.key}-tab`)?.focus();
                }}
                className={cx(
                  "whitespace-nowrap border-b-2 px-2 py-4 text-[14px] transition-colors sm:text-[15px]",
                  selected
                    ? "border-brand font-semibold text-ink"
                    : "border-transparent text-ink-muted hover:text-ink",
                )}
              >
                {t.label} ({counts[t.key]})
              </button>
            );
          })}
        </div>
        {showToolbar ? (
          <div className="hidden shrink-0 items-center gap-2 lg:flex">
            <Button aria-label="Search this queue" className="w-10 px-0">
              <Search aria-hidden className="size-[18px]" />
            </Button>
            <Button>
              <Funnel aria-hidden className="size-4" />
              Filter
            </Button>
          </div>
        ) : null}
      </div>

      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-${active}-tab`}>
        {content[active] ?? (
          <EmptyState bare title={tab.emptyTitle} action={tab.emptyAction}>
            {tab.emptyBody}
          </EmptyState>
        )}
      </div>
    </section>
  );
}
