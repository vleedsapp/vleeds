"use client";

import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonClass, cx } from "@/components/ui/primitives";
import { QUALIFICATION_LABEL } from "@/lib/lead-core/display";
import { hasActiveFilters, leadQueryString, type LeadListQuery } from "@/lib/lead-core/list-query";
import { QUALIFICATION_STATES } from "@/lib/lead-core/schemas";

/**
 * Basic Leads filters and sort. A plain GET form (works without JavaScript);
 * with JavaScript it applies on change. The URL is the source of truth, so
 * filtered views are shareable and the company drawer keeps working.
 *
 * `countries` comes from the server: names are runtime ICU data, and browsers
 * name some regions differently from Node (e.g. HK, MO, PS, FK), which made
 * the server-rendered options fail hydration.
 */
export function LeadFilters({
  basePath,
  query,
  countries,
}: {
  basePath: string;
  query: LeadListQuery;
  countries: { code: string; name: string }[];
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(hasActiveFilters(query));
  const active = hasActiveFilters(query);

  const apply = () => {
    const data = new FormData(form.current!);
    const next: LeadListQuery = {
      page: 1,
      qualification: (data.get("qualification") || null) as LeadListQuery["qualification"],
      grade: (data.get("grade") || null) as LeadListQuery["grade"],
      restricted: data.get("restricted") === "yes" ? true : data.get("restricted") === "no" ? false : null,
      hasContact: data.get("contact") === "yes" ? true : data.get("contact") === "no" ? false : null,
      country: (data.get("country") || null) as string | null,
      sort: (data.get("sort") || "updated") as LeadListQuery["sort"],
    };
    router.push(`${basePath}${leadQueryString(next)}`, { scroll: false });
  };

  const select = (name: string, label: string, value: string, options: [string, string][]) => (
    <label className="flex min-w-0 flex-col gap-1 text-[12.5px] font-medium text-ink-subtle">
      {label}
      <select
        name={name}
        defaultValue={value}
        onChange={apply}
        className="h-11 min-w-0 rounded-md md:h-10 border border-line-strong bg-surface px-2.5 text-[14px] font-normal text-ink focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="border-b border-line px-5 py-3">
      <div className="flex items-center justify-between gap-3 md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="lead-filters"
          onClick={() => setOpen((v) => !v)}
          className={buttonClass("secondary", "h-11")}
        >
          <SlidersHorizontal aria-hidden className="size-4" />
          Filters{active ? " (on)" : ""}
        </button>
        {active ? (
          <Link href={basePath} scroll={false} className="text-[13.5px] font-medium text-brand hover:underline">
            Clear filters
          </Link>
        ) : null}
      </div>
      <form
        id="lead-filters"
        ref={form}
        method="get"
        action={basePath}
        aria-label="Filter and sort companies"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        className={cx("grid-cols-2 gap-3 pt-3 md:grid md:grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.1fr)] md:pt-0 xl:grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.1fr)_auto]", open ? "grid" : "hidden")}
      >
        {select("qualification", "Qualification", query.qualification ?? "", [["", "Any"], ...QUALIFICATION_STATES.map((s) => [s, QUALIFICATION_LABEL[s].label] as [string, string])])}
        {select("grade", "Grade", query.grade ?? "", [["", "Any"], ["A", "A"], ["B", "B"], ["C", "C"], ["excluded", "Excluded"], ["outdated", "Outdated"], ["none", "Not scored"]])}
        {select("restricted", "Restriction", query.restricted === null ? "" : query.restricted ? "yes" : "no", [["", "Any"], ["no", "Not restricted"], ["yes", "Restricted"]])}
        {select("contact", "Contacts", query.hasContact === null ? "" : query.hasContact ? "yes" : "no", [["", "Any"], ["yes", "Has contacts"], ["no", "No contacts"]])}
        {select("country", "Country", query.country ?? "", [["", "Any"], ...countries.map((c) => [c.code, c.name] as [string, string])])}
        {select("sort", "Sort by", query.sort, [["updated", "Recently updated"], ["name", "Company name"], ["qualification", "Qualification"], ["grade", "Grade"]])}
        <noscript>
          <button type="submit" className={buttonClass("secondary", "h-10 self-end")}>
            Apply
          </button>
        </noscript>
        {active ? (
          <Link href={basePath} scroll={false} className="hidden self-end pb-2.5 text-[13.5px] font-medium text-brand hover:underline xl:block">
            Clear
          </Link>
        ) : null}
      </form>
    </div>
  );
}
