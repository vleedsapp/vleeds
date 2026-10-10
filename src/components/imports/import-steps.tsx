import { Check } from "lucide-react";
import { cx, type Tone } from "@/components/ui/primitives";
import type { ImportStatus } from "@/lib/dal";

export const IMPORT_STEPS = ["Upload", "Map", "Review", "Import"] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

export const STATUS_LABEL: Record<ImportStatus, { label: string; tone: Tone }> = {
  mapping: { label: "Mapping", tone: "warning" },
  review: { label: "In review", tone: "warning" },
  processing: { label: "Importing", tone: "info" },
  completed: { label: "Completed", tone: "brand" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Step indicator. The current step has aria-current="step"; state is also stated in text. */
export function ImportSteps({ current, complete = false }: { current: ImportStep; complete?: boolean }) {
  const index = IMPORT_STEPS.indexOf(current);
  return (
    <nav aria-label="Import steps">
      <ol className="flex items-center gap-2 overflow-x-auto sm:gap-3">
        {IMPORT_STEPS.map((step, i) => {
          const done = i < index || (complete && i === index);
          const active = i === index && !complete;
          return (
            <li key={step} aria-current={active ? "step" : undefined} className="flex shrink-0 items-center gap-2 sm:gap-3">
              <span
                className={cx(
                  "grid size-7 place-items-center rounded-full text-[13px] font-semibold",
                  done ? "bg-brand text-white" : active ? "bg-brand-tint text-brand-strong ring-2 ring-brand" : "bg-sunken text-ink-subtle",
                )}
                aria-hidden
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              {/* Phones show only the current step's name; the others stay available to screen readers. */}
              <span className={cx("text-[14px]", active ? "font-semibold text-ink" : done ? "sr-only text-ink sm:not-sr-only" : "sr-only text-ink-subtle sm:not-sr-only")}>
                {step}
                <span className="sr-only">{done ? " (completed)" : active ? " (current step)" : " (not started)"}</span>
              </span>
              {i < IMPORT_STEPS.length - 1 ? <span aria-hidden className="h-px w-4 bg-line-strong sm:w-8" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
