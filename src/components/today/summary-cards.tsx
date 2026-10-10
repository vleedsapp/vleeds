import { Calendar, Compass, Phone, PhoneOutgoing, Users, type LucideIcon } from "lucide-react";
import { IconCircle, type Tone } from "@/components/ui/primitives";

export type TodaySummary = {
  leadsReady: number;
  callbacksDue: number;
  followUps: number;
  newDiscoveries: number;
};

type Card = { key: string; icon: LucideIcon; tone: Tone; label: string; shortLabel: string; value: number };

const CARDS: Omit<Card, "value">[] = [
  { key: "leadsReady", icon: Phone, tone: "brand", label: "A leads ready", shortLabel: "Calls due" },
  // Canonical mobile labels slots 2-3 "Follow-ups"/"New leads"; desktop labels them
  // "callbacks due"/"follow-ups". One metric must keep one meaning, so mobile uses
  // short forms of the desktop metrics (documented mismatch).
  { key: "callbacksDue", icon: Calendar, tone: "warning", label: "callbacks due", shortLabel: "Callbacks" },
  { key: "followUps", icon: Users, tone: "info", label: "follow-ups", shortLabel: "Follow-ups" },
  { key: "newDiscoveries", icon: Compass, tone: "neutral", label: "new discoveries", shortLabel: "Discoveries" },
];

/** Canonical summary (UI fixture). */
export function SummaryCards({ summary }: { summary: TodaySummary }) {
  return <SummaryCardList cards={CARDS.map((c) => ({ ...c, value: summary[c.key as keyof TodaySummary] }))} />;
}

/**
 * Real operational summary (P1-E7): the same four canonical cards, mapped to
 * actionable counts. Ready = companies with a recommended contact; callbacks
 * and follow-ups = actionable tasks due by the end of the workspace-local day
 * (blocked ones are excluded); contacted today = attempts recorded today.
 */
export function OperationalSummaryCards({ summary }: { summary: { ready: number; callbacks: number; followUps: number; contactedToday: number } }) {
  return (
    <SummaryCardList
      cards={[
        { key: "ready", icon: Phone, tone: "brand", label: "ready to contact", shortLabel: "Ready", value: summary.ready },
        { key: "callbacks", icon: Calendar, tone: "warning", label: "callbacks due", shortLabel: "Callbacks", value: summary.callbacks },
        { key: "followUps", icon: Users, tone: "info", label: "follow-ups due", shortLabel: "Follow-ups", value: summary.followUps },
        { key: "contacted", icon: PhoneOutgoing, tone: "neutral", label: "contacted today", shortLabel: "Contacted", value: summary.contactedToday },
      ]}
    />
  );
}

/**
 * Desktop: large left-aligned cards. Mobile: compact centered cards
 * (canonical mobile layout). Each value is announced with its full label.
 */
function SummaryCardList({ cards }: { cards: Card[] }) {
  return (
    <ul aria-label="Today summary" className="grid grid-cols-4 gap-2.5 sm:gap-4">
      {cards.map(({ key, icon: Icon, tone, label, shortLabel, value }) => (
        <li
          key={key}
          className="flex min-w-0 flex-col items-center rounded-xl border border-line bg-surface px-1 py-3.5 text-center shadow-card sm:items-start sm:px-5 sm:py-5 sm:text-left"
        >
          <IconCircle tone={tone} size="md" className="sm:size-14 sm:[&_svg]:size-6">
            <Icon className="stroke-[1.75]" />
          </IconCircle>
          <div className="mt-2.5 text-[22px] font-bold leading-none tracking-[-0.02em] text-ink sm:mt-4 sm:text-[30px]">
            {value}
            <span className="sr-only"> {label}</span>
          </div>
          <div aria-hidden className="mt-1.5 w-full truncate text-[12px] tracking-[-0.01em] text-ink-muted sm:mt-2 sm:text-[15px] sm:tracking-normal">
            <span className="sm:hidden">{shortLabel}</span>
            <span className="hidden sm:inline">{label}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
