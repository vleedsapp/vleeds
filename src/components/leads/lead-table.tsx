"use client";

import { ChevronLeft, ChevronRight, EllipsisVertical, Phone } from "lucide-react";
import { useState } from "react";
import { Button, cx } from "@/components/ui/primitives";
import { FitScore, LeadGradeBadge, SignalChip, type LeadGrade, type SignalTone } from "./lead-ui";

/** View model for one table row. Presentational only; not a persistence model. */
export type LeadRowView = {
  id: string;
  grade: LeadGrade;
  company: string;
  location: string;
  contactName: string;
  contactTitle: string;
  fit: number;
  signals: { label: string; tone: SignalTone }[];
};

/**
 * Canonical lead table. Desktop (md+) renders a semantic table; small screens
 * transform each row into a stacked card instead of shrinking columns.
 */
export function LeadTable({
  rows,
  total,
  selectedId,
  onSelect,
}: {
  rows: LeadRowView[];
  total: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selectedId ? [selectedId] : []));
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));

  return (
    <div>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[13px] font-medium text-ink-subtle">
              <th scope="col" className="w-12 py-3 pl-5 pr-2">
                <input
                  type="checkbox"
                  aria-label="Select all leads on this page"
                  checked={allChecked}
                  onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                  className="size-[18px] rounded accent-[var(--color-brand)]"
                />
              </th>
              <th scope="col" className="w-16 px-2 py-3 font-medium">Grade</th>
              <th scope="col" className="px-2 py-3 font-medium">Company</th>
              <th scope="col" className="px-2 py-3 font-medium">Contact</th>
              <th scope="col" className="w-16 px-2 py-3 font-medium">Fit</th>
              <th scope="col" className="px-2 py-3 font-medium">Signal</th>
              <th scope="col" className="w-36 px-2 py-3 font-medium">Next Action</th>
              <th scope="col" className="w-10 py-3 pr-4">
                <span className="sr-only">More</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const active = row.id === selectedId;
              return (
                <tr
                  key={row.id}
                  aria-selected={active}
                  onClick={() => onSelect?.(row.id)}
                  className={cx(
                    "cursor-pointer border-b border-line last:border-b-0 transition-colors",
                    active ? "bg-brand-tint/60" : "hover:bg-surface-muted",
                  )}
                >
                  <td className="py-3 pl-5 pr-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.company}`}
                      checked={checked.has(row.id)}
                      onChange={() => toggle(row.id)}
                      className="size-[18px] rounded accent-[var(--color-brand)]"
                    />
                  </td>
                  <td className="px-2 py-3">
                    <LeadGradeBadge grade={row.grade} />
                  </td>
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect?.(row.id);
                      }}
                      className="text-left text-[14.5px] font-semibold text-ink hover:underline"
                    >
                      {row.company}
                    </button>
                    <div className="text-[13px] text-ink-subtle">{row.location}</div>
                  </td>
                  <td className="px-2 py-3">
                    <div className="text-[14.5px] text-ink">{row.contactName}</div>
                    <div className="text-[13px] text-ink-subtle">{row.contactTitle}</div>
                  </td>
                  <td className="px-2 py-3">
                    <FitScore score={row.fit} />
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {row.signals.map((s) => (
                        <SignalChip key={s.label} tone={s.tone}>
                          {s.label}
                        </SignalChip>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                    <Button variant="soft" className="w-[88px]">
                      <Phone aria-hidden className="size-4" />
                      Call
                    </Button>
                  </td>
                  <td className="py-3 pr-4" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      aria-label={`More actions for ${row.company}`}
                      className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-sunken"
                    >
                      <EllipsisVertical aria-hidden className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Small screens: stacked cards */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <div className={cx("flex gap-3 px-4 py-3.5", row.id === selectedId && "bg-brand-tint/60")}>
              <LeadGradeBadge grade={row.grade} />
              <button type="button" onClick={() => onSelect?.(row.id)} className="min-w-0 flex-1 text-left">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-ink">{row.company}</div>
                    <div className="truncate text-[13px] text-ink-subtle">
                      {row.contactName} · {row.contactTitle}
                    </div>
                  </div>
                  <FitScore score={row.fit} size={34} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {row.signals.map((s) => (
                    <SignalChip key={s.label} tone={s.tone}>
                      {s.label}
                    </SignalChip>
                  ))}
                </div>
              </button>
              <Button variant="soft" size="md" className="size-11 self-center px-0" aria-label={`Call ${row.contactName}`}>
                <Phone aria-hidden className="size-[18px]" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5 text-[13px] text-ink-subtle">
        <span>
          Showing {rows.length} of {total} leads
        </span>
        <nav aria-label="Pagination" className="flex items-center gap-1.5">
          <PageButton label="Previous page">
            <ChevronLeft aria-hidden className="size-4" />
          </PageButton>
          {Array.from({ length: Math.min(5, Math.max(1, Math.ceil(total / Math.max(rows.length, 1)))) }, (_, i) => i + 1).map((p) => (
            <PageButton key={p} label={`Page ${p}`} current={p === 1}>
              {p}
            </PageButton>
          ))}
          <PageButton label="Next page">
            <ChevronRight aria-hidden className="size-4" />
          </PageButton>
        </nav>
      </div>
    </div>
  );
}

function PageButton({ label, current, children }: { label: string; current?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={cx(
        "grid size-8 place-items-center rounded-md text-[13px] font-medium",
        current ? "bg-brand text-white" : "border border-line bg-surface text-ink-muted hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}
