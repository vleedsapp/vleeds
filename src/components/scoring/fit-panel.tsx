"use client";

import { Gauge } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LeadGradeBadge } from "@/components/leads/lead-ui";
import { Button, StatusPill } from "@/components/ui/primitives";
import type { FitSummary, ScoreView } from "@/lib/lead-core/views";
import { FitSheet } from "./fit-sheet";

/**
 * The drawer's fit summary (default ICP) + "Evaluate fit" / "Recalculate fit"
 * and other stored results. States are text; colour is supplementary.
 */
export function FitPanel({
  workspaceId,
  company,
  fit,
  scores,
  settingsPath,
}: {
  workspaceId: string;
  company: { id: string; name: string };
  fit: FitSummary | null;
  scores: ScoreView[];
  settingsPath: string;
}) {
  const [open, setOpen] = useState(false);
  const others = scores.filter((s) => !fit || s.profileId !== fit.profileId || s.outdatedReason === "profile");
  const evaluated = !!fit && fit.state !== "none";

  return (
    <div className="flex flex-col gap-3" data-fit-panel>
      {fit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="-ml-8 flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:bg-surface-muted"
        >
          {fit.state === "current" && fit.grade ? <LeadGradeBadge grade={fit.grade} /> : null}
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium text-ink">
              {fit.state === "current" ? `Grade ${fit.grade} · ${fit.score} fit` : fit.state === "excluded" ? "Excluded" : fit.state === "outdated" ? "Outdated result" : "Not scored"}
            </span>
            <span className="block text-[12.5px] text-ink-subtle">
              {fit.profileName} · Revision {fit.revision}
              {fit.coveragePercent !== null ? ` · Coverage ${fit.coveragePercent}%` : ""}
              {fit.signals.confirmed + fit.signals.unknown ? ` · Signals ${fit.signals.confirmed} confirmed · ${fit.signals.unknown} unknown` : ""}
            </span>
            {fit.state === "outdated" ? (
              <span className="block text-[12.5px] text-ink-muted">{fit.outdatedReason === "profile" ? "The profile changed since the last evaluation." : "Company, contact or signal data changed since the last evaluation."}</span>
            ) : null}
          </span>
          {evaluated ? (
            <StatusPill tone={fit.state === "outdated" ? "warning" : fit.state === "excluded" ? "neutral" : "brand"} className="h-6 px-2.5 text-[12px]">
              {fit.state === "outdated" ? "Outdated" : fit.state === "excluded" ? "Excluded" : "Current"}
            </StatusPill>
          ) : null}
        </button>
      ) : (
        <p className="text-[14px] text-ink-subtle">
          No default ideal customer profile.{" "}
          <Link href={settingsPath} className="font-medium text-brand hover:underline">
            Settings
          </Link>
        </p>
      )}
      <Button type="button" variant="soft" className="h-11 self-start sm:h-9" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Gauge aria-hidden className="size-4" />
        {evaluated ? "Recalculate fit" : "Evaluate fit"}
      </Button>

      {others.length ? (
        <ul aria-label="Other score results" className="-ml-8 flex flex-col gap-2">
          {others.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
              {s.grade && !s.outdated && s.status === "scored" ? <LeadGradeBadge grade={s.grade} size="sm" /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ink">{s.profileName}</p>
                <p className="text-[12.5px] text-ink-subtle">Revision {s.revision}</p>
              </div>
              <span className="text-right text-[13px]">
                {s.status === "pending" ? (
                  <span className="text-ink-subtle">Pending</span>
                ) : (
                  <>
                    {s.excluded ? <span className="text-ink">Excluded</span> : s.score !== null ? <span className="font-semibold tabular-nums text-ink">{s.score}<span className="sr-only"> out of 100</span></span> : null}
                    {s.outdated ? <span className="block text-[12px] text-warning">{s.outdatedReason === "profile" ? "Outdated: profile changed" : "Outdated: data changed"}</span> : null}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {open ? <FitSheet workspaceId={workspaceId} companyId={company.id} companyName={company.name} settingsPath={settingsPath} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
