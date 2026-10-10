import type { ReactNode } from "react";
import { cx, toneClass, type Tone } from "@/components/ui/primitives";

/**
 * PRESENTATIONAL lead components (canonical lead-table language).
 * They render view props only; they have no data access, persistence or
 * provider logic. The lead domain model arrives in a later story.
 */

export type LeadGrade = "A" | "B" | "C" | "D";

const GRADE_TONE: Record<LeadGrade, Tone> = { A: "brand", B: "brand", C: "warning", D: "neutral" };

/** Letter grade in a tinted circle. The letter itself carries meaning (not color alone). */
export function LeadGradeBadge({ grade, tone, size = "md" }: { grade: LeadGrade; tone?: Tone; size?: "sm" | "md" }) {
  return (
    <span
      role="img"
      aria-label={`Grade ${grade}`}
      className={cx(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold",
        toneClass(tone ?? GRADE_TONE[grade]),
        size === "sm" ? "size-6 text-[12px]" : "size-8 text-[14px]",
      )}
    >
      {grade}
    </span>
  );
}

/** Fit score ring (0-100). Number is always shown; ring color is supplementary. */
export function FitScore({ score, size = 38 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = clamped >= 72 ? "var(--color-brand)" : "var(--color-warning)";
  return (
    <span
      role="img"
      aria-label={`Fit score ${clamped} out of 100`}
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
        />
      </svg>
      <span aria-hidden className="absolute text-[13px] font-semibold text-ink">
        {clamped}
      </span>
    </span>
  );
}

export type SignalTone = "brand" | "info" | "violet";

export function SignalChip({ tone = "brand", children }: { tone?: SignalTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium",
        toneClass(tone),
      )}
    >
      {children}
    </span>
  );
}

export type Disposition = "no_answer" | "callback" | "interested" | "not_interested";

export const DISPOSITIONS: { value: Disposition; label: string; tone: Tone }[] = [
  { value: "no_answer", label: "No answer", tone: "neutral" },
  { value: "callback", label: "Callback", tone: "warning" },
  { value: "interested", label: "Interested", tone: "brand" },
  { value: "not_interested", label: "Not interested", tone: "danger" },
];

/** Disposition choice pill. Selected state shown with a ring and aria-pressed, not color alone. */
export function DispositionPill({
  value,
  selected,
  onSelect,
}: {
  value: Disposition;
  selected?: boolean;
  onSelect?: (value: Disposition) => void;
}) {
  const d = DISPOSITIONS.find((x) => x.value === value)!;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect?.(value)}
      className={cx(
        "inline-flex h-8 items-center rounded-full px-4 text-[13px] font-medium transition-shadow",
        toneClass(d.tone),
        selected ? "ring-2 ring-current ring-offset-1" : "hover:ring-1 hover:ring-current/30",
      )}
    >
      {d.label}
    </button>
  );
}
