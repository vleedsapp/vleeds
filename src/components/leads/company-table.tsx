import { Ban, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cx, StatusPill } from "@/components/ui/primitives";
import { formatDate, QUALIFICATION_LABEL } from "@/lib/lead-core/display";
import type { CompanyListItem } from "@/lib/lead-core/views";
import { LeadGradeBadge } from "./lead-ui";

/**
 * Lead-core company list in the canonical lead-table language. Only real data
 * is shown: the Grade column appears once a company has been evaluated
 * against the default ICP (P1-E6: current grade + fit, Excluded, Outdated or
 * Not scored); there is no signal or call column until those exist. Rows link to `?company=<id>`, which opens the drawer server-side.
 * md+: semantic table. Below md: stacked cards.
 */
export function CompanyTable({
  items,
  hrefFor,
  selectedId,
}: {
  items: CompanyListItem[];
  hrefFor: (id: string) => string;
  selectedId: string | null;
}) {
  const showGrade = items.some((i) => i.scoreState !== "none");
  // With the drawer open the table shares the row with it: keep the core columns readable.
  const secondary = selectedId ? "hidden 2xl:table-cell" : "";

  return (
    <div>
      <div className="hidden overflow-x-auto md:block">
        <table className={cx("w-full border-collapse text-left", selectedId ? "min-w-[560px]" : "min-w-[720px]")}>
          <caption className="sr-only">Companies in this workspace</caption>
          <thead>
            <tr className="border-b border-line text-[13px] text-ink-subtle">
              {showGrade ? <th scope="col" className="w-24 py-3 pl-5 pr-2 font-medium">Grade</th> : null}
              <th scope="col" className={cx("px-2 py-3 font-medium", !showGrade && "pl-5")}>Company</th>
              <th scope="col" className="px-2 py-3 font-medium">Primary contact</th>
              <th scope="col" className="w-40 px-2 py-3 font-medium">Qualification</th>
              <th scope="col" className={cx("w-28 px-2 py-3 font-medium", secondary)}>Sources</th>
              <th scope="col" className={cx("w-32 px-2 py-3 pr-5 font-medium", secondary)}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const active = c.id === selectedId;
              return (
                <tr
                  key={c.id}
                  className={cx("border-b border-line transition-colors last:border-b-0", active ? "bg-brand-tint/60" : "hover:bg-surface-muted")}
                >
                  {showGrade ? (
                    <td className="py-3 pl-5 pr-2">
                      <GradeCell c={c} />
                    </td>
                  ) : null}
                  <td className={cx("px-2 py-3", !showGrade && "pl-5")}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={hrefFor(c.id)}
                        scroll={false}
                        aria-current={active ? "true" : undefined}
                        data-company-link={c.id}
                        className="text-[14.5px] font-semibold text-ink hover:underline"
                      >
                        {c.name}
                      </Link>
                      {c.restricted ? <RestrictedPill /> : null}
                    </div>
                    <div className="text-[13px] text-ink-subtle">{[c.location, c.domain].filter(Boolean).join(" · ") || "No location recorded"}</div>
                  </td>
                  <td className="px-2 py-3">
                    {c.primaryContact ? (
                      <>
                        <div className="text-[14.5px] text-ink">{c.primaryContact.name}</div>
                        <div className="text-[13px] text-ink-subtle">{c.primaryContact.title ?? `${c.contactCount} contact${c.contactCount === 1 ? "" : "s"}`}</div>
                      </>
                    ) : (
                      <span className="text-[13.5px] text-ink-subtle">
                        {c.contactCount ? `${c.contactCount} contact${c.contactCount === 1 ? "" : "s"}, none primary` : "No contacts"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <QualificationPill state={c.qualification} />
                  </td>
                  <td className={cx("px-2 py-3 text-[13.5px] text-ink-muted", secondary)}>{c.evidenceCount ? `${c.evidenceCount} source${c.evidenceCount === 1 ? "" : "s"}` : <span className="text-ink-subtle">None</span>}</td>
                  <td className={cx("px-2 py-3 pr-5 text-[13.5px] text-ink-muted", secondary)}>{formatDate(c.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul aria-label="Companies" className="divide-y divide-line md:hidden">
        {items.map((c) => (
          <li key={c.id}>
            <Link
              href={hrefFor(c.id)}
              scroll={false}
              aria-current={c.id === selectedId ? "true" : undefined}
              data-company-link={c.id}
              className={cx("flex min-h-11 items-start gap-3 px-4 py-3.5", c.id === selectedId && "bg-brand-tint/60")}
            >
              {c.scoreState === "current" && c.grade ? <LeadGradeBadge grade={c.grade} /> : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-ink">{c.name}</span>
                <span className="block truncate text-[13px] text-ink-subtle">
                  {c.primaryContact ? [c.primaryContact.name, c.primaryContact.title].filter(Boolean).join(" · ") : "No primary contact"}
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  {c.scoreState === "current" && c.score !== null ? <span className="text-[12.5px] font-medium text-ink">{c.score} fit</span> : null}
                  {c.scoreState === "excluded" ? <StatusPill tone="neutral" className="h-6 px-2.5 text-[12px]">Excluded</StatusPill> : null}
                  {c.scoreState === "outdated" ? <StatusPill tone="warning" className="h-6 px-2.5 text-[12px]">Outdated score</StatusPill> : null}
                  <QualificationPill state={c.qualification} />
                  {c.restricted ? <RestrictedPill /> : null}
                </span>
                <span className="mt-1.5 block truncate text-[12.5px] text-ink-subtle">
                  {[c.location, c.evidenceCount ? `${c.evidenceCount} source${c.evidenceCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "No location recorded"}
                </span>
              </span>
              <ChevronRight aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-subtle" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Grade column: current grade + fit, Excluded, Outdated or Not scored (text, never colour alone). */
function GradeCell({ c }: { c: CompanyListItem }) {
  if (c.scoreState === "current" && c.grade) {
    return (
      <span className="flex items-center gap-2">
        <LeadGradeBadge grade={c.grade} />
        {c.score !== null ? <span className="whitespace-nowrap text-[12.5px] tabular-nums text-ink-muted">{c.score} fit</span> : null}
      </span>
    );
  }
  if (c.scoreState === "excluded") return <span className="text-[12.5px] font-medium text-ink-muted">Excluded</span>;
  if (c.scoreState === "outdated") return <span className="text-[12.5px] text-warning">Outdated</span>;
  return (
    <span className="text-[13px] text-ink-subtle">
      —<span className="sr-only">Not scored</span>
    </span>
  );
}

export function QualificationPill({ state }: { state: CompanyListItem["qualification"] }) {
  const q = QUALIFICATION_LABEL[state];
  return (
    <StatusPill tone={q.tone} dot className="h-6 px-2.5 text-[12px]">
      {q.label}
    </StatusPill>
  );
}

export function RestrictedPill({ label = "Restricted" }: { label?: string }) {
  return (
    <StatusPill tone="neutral" className="h-6 gap-1 px-2.5 text-[12px]">
      <Ban aria-hidden className="size-3.5" />
      {label}
    </StatusPill>
  );
}
