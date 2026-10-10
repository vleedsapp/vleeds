import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cx } from "@/components/ui/primitives";

/**
 * Server-side pagination footer in the canonical table style: a range label,
 * Previous / Next and the current page. Links keep every other URL parameter.
 */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  noun,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  noun: [string, string];
  hrefFor: (page: number) => string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5 text-[13px] text-ink-subtle">
      <p aria-live="polite">
        {total === 0 ? `No ${noun[1]}` : `Showing ${from}–${to} of ${total.toLocaleString("en")} ${total === 1 ? noun[0] : noun[1]}`}
      </p>
      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center gap-1.5">
          <PageLink href={page > 1 ? hrefFor(page - 1) : null} label="Previous page">
            <ChevronLeft aria-hidden className="size-4" />
          </PageLink>
          <span aria-current="page" className="grid h-8 min-w-8 place-items-center rounded-md bg-brand px-2 text-[13px] font-medium text-white">
            {page}
          </span>
          <span className="px-1">of {pageCount}</span>
          <PageLink href={page < pageCount ? hrefFor(page + 1) : null} label="Next page">
            <ChevronRight aria-hidden className="size-4" />
          </PageLink>
        </nav>
      ) : null}
    </div>
  );
}

function PageLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = "grid size-11 place-items-center rounded-md border border-line bg-surface text-ink-muted sm:size-8";
  return href ? (
    <Link href={href} scroll={false} aria-label={label} className={cx(cls, "hover:bg-surface-muted")}>
      {children}
    </Link>
  ) : (
    <span aria-disabled="true" aria-label={label} role="link" className={cx(cls, "opacity-40")}>
      {children}
    </span>
  );
}
