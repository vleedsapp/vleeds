"use client";

import { Check, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { Button, StatusPill, type Tone } from "@/components/ui/primitives";
import type { CandidateDecision, CandidateMatchState, DecisionAction, TransientCandidateView } from "@/lib/discovery/model";

/**
 * Candidates of the active search: a table on md+, cards on phones.
 * name/address/category are transient provider content held only in the
 * browser's state for this interaction.
 */

const MATCH: Record<CandidateMatchState, { label: string; tone: Tone }> = {
  new: { label: "New reference", tone: "neutral" },
  seen_before: { label: "Seen before", tone: "info" },
  existing_company: { label: "Existing company", tone: "brand" },
};

const DECISION: Record<CandidateDecision, string | null> = {
  unreviewed: null,
  selected: "Selected",
  needs_enrichment: "Saved for enrichment",
  dismissed: "Dismissed",
};

function Status({ c, leadsPath }: { c: TransientCandidateView; leadsPath: string }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusPill tone={MATCH[c.matchState].tone} className="h-6 px-2.5 text-[12px]">
        {MATCH[c.matchState].label}
      </StatusPill>
      {c.matchCompanyId ? (
        <Link href={`${leadsPath}?company=${c.matchCompanyId}`} className="text-[12.5px] font-medium text-brand hover:underline">
          Open company<span className="sr-only"> for {c.name ?? "this result"}</span>
        </Link>
      ) : null}
    </div>
  );
}

function Decision({
  c,
  busy,
  onDecide,
  open,
  onEnrich,
}: {
  c: TransientCandidateView;
  busy: boolean;
  open: boolean;
  onDecide: (a: DecisionAction) => void;
  onEnrich?: () => void;
}) {
  const label = c.name ?? "this result";
  const chosen = DECISION[c.decision];
  if (chosen) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={c.decision === "dismissed" ? "neutral" : "brand"} className="h-6 px-2.5 text-[12px]">
          {chosen}
        </StatusPill>
        {c.decision === "needs_enrichment" && onEnrich ? (
          <Button type="button" variant="soft" className="h-11 sm:h-8" disabled={busy} aria-haspopup="dialog" onClick={onEnrich}>
            Find company data<span className="sr-only"> for {label}</span>
          </Button>
        ) : null}
        {open ? (
          <Button type="button" variant="ghost" className="h-11 px-2 text-[13px] sm:h-8" disabled={busy} onClick={() => onDecide("reset")}>
            Undo<span className="sr-only"> for {label}</span>
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Decision for ${label}`}>
      <Button type="button" variant="soft" className="h-11 sm:h-8" disabled={busy || !open} onClick={() => onDecide("select")}>
        <Check aria-hidden className="size-4" />
        Select<span className="sr-only"> {label}</span>
      </Button>
      <Button type="button" className="h-11 sm:h-8" disabled={busy || !open} onClick={() => onDecide("dismiss")}>
        <X aria-hidden className="size-4" />
        Dismiss<span className="sr-only"> {label}</span>
      </Button>
    </div>
  );
}

function Name({ c }: { c: TransientCandidateView }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <span className="text-[14.5px] font-medium text-ink">{c.name ?? "Unnamed place"}</span>
      {c.sourceUrl ? (
        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-ink-subtle hover:text-brand" title="View at the source">
          <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only">View {c.name ?? "this place"} on the provider&apos;s site (opens in a new tab)</span>
        </a>
      ) : null}
    </span>
  );
}

export function DiscoverResults({
  candidates,
  leadsPath,
  busyId,
  open,
  onDecide,
  onEnrich,
}: {
  candidates: TransientCandidateView[];
  leadsPath: string;
  busyId: string | null;
  open: boolean;
  onDecide: (c: TransientCandidateView, a: DecisionAction) => void;
  /** Starts company enrichment for a reference saved for enrichment (only when a provider is configured). */
  onEnrich?: (c: TransientCandidateView) => void;
}) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">Companies found by this search</caption>
          <thead>
            <tr className="border-b border-line text-[13px] text-ink-subtle">
              <th scope="col" className="w-[28%] py-3 pl-5 pr-2 font-medium">Company</th>
              <th scope="col" className="w-[24%] px-2 py-3 font-medium">Location</th>
              <th scope="col" className="px-2 py-3 font-medium">Category</th>
              <th scope="col" className="w-[150px] px-2 py-3 font-medium">Vleeds status</th>
              <th scope="col" className="w-[280px] px-2 py-3 pr-5 font-medium">Decision</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.candidateId} data-candidate={c.externalId} className="border-b border-line align-top last:border-b-0">
                <td className="break-words py-3 pl-5 pr-2"><Name c={c} /></td>
                <td className="break-words px-2 py-3 text-[13.5px] text-ink-muted">{c.address ?? "—"}</td>
                <td className="break-words px-2 py-3 text-[13.5px] text-ink-muted">{c.category ?? "—"}</td>
                <td className="px-2 py-3"><Status c={c} leadsPath={leadsPath} /></td>
                <td className="px-2 py-3 pr-5">
                  <Decision c={c} open={open} busy={busyId === c.candidateId} onDecide={(a) => onDecide(c, a)} onEnrich={onEnrich ? () => onEnrich(c) : undefined} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label="Companies found by this search" className="divide-y divide-line md:hidden">
        {candidates.map((c) => (
          <li key={c.candidateId} data-candidate={c.externalId} className="flex flex-col gap-2 px-4 py-3.5">
            <Name c={c} />
            {c.address ? <p className="text-[13px] text-ink-muted">{c.address}</p> : null}
            {c.category ? <p className="text-[12.5px] text-ink-subtle">{c.category}</p> : null}
            <Status c={c} leadsPath={leadsPath} />
            <Decision c={c} open={open} busy={busyId === c.candidateId} onDecide={(a) => onDecide(c, a)} onEnrich={onEnrich ? () => onEnrich(c) : undefined} />
          </li>
        ))}
      </ul>
    </>
  );
}
