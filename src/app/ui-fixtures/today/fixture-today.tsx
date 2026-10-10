"use client";

/**
 * DEVELOPMENT-ONLY. Renders the canonical populated Today design from
 * invented fixture data (src/dev-fixtures). Only reachable in builds made
 * with VLEEDS_UI_FIXTURES=1; it never touches the DAL or the database.
 */
import { useState } from "react";
import { LeadDetailDrawer } from "@/components/leads/lead-detail-drawer";
import { LeadTable } from "@/components/leads/lead-table";
import { AppShell } from "@/components/shell/app-shell";
import { SummaryCards } from "@/components/today/summary-cards";
import { TodayQueue } from "@/components/today/today-queue";
import { PageHeader } from "@/components/ui/primitives";
import {
  UI_FIXTURE_MARKER,
  fixtureCounts,
  fixtureDetail,
  fixtureRows,
  fixtureSummary,
  fixtureUserEmail,
  fixtureWorkspace,
  fixtureWorkspaces,
} from "@/dev-fixtures/today-fixture";

export function FixtureToday() {
  const [selected, setSelected] = useState<string | null>(null);
  const detail = selected ? fixtureDetail(selected) : null;

  return (
    <div data-ui-fixture={UI_FIXTURE_MARKER}>
      <AppShell workspace={fixtureWorkspace} workspaces={fixtureWorkspaces} userEmail={fixtureUserEmail} bleed>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-col gap-5 px-4 pt-5 sm:gap-6 sm:px-6 lg:px-7 lg:pb-10 lg:pt-7">
            <p className="rounded-md border border-dashed border-warning/40 bg-warning-tint px-3 py-1.5 text-[12.5px] text-warning">
              UI fixture: invented example data for design review. Not real workspace data.
            </p>
            <PageHeader title="Today" description={<>Follow-ups and calls due for {fixtureWorkspace.name}.</>} />
            <SummaryCards summary={fixtureSummary} />
            <TodayQueue
              counts={fixtureCounts}
              showToolbar
              showTabsOnMobile
              content={{
                queue: <LeadTable rows={fixtureRows} total={fixtureCounts.queue} selectedId={selected} onSelect={setSelected} />,
              }}
            />
          </div>

          {detail ? (
            <>
              {/* lg+: inline right column under the top bar */}
              <div className="sticky top-[72px] hidden h-[calc(100dvh-72px)] w-[360px] 2xl:w-[400px] border-l border-line shadow-drawer lg:block">
                <LeadDetailDrawer lead={detail} onClose={() => setSelected(null)} />
              </div>
              {/* < lg: overlay sheet */}
              <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
                <div className="absolute inset-0 bg-ink/25" onClick={() => setSelected(null)} />
                <div className="absolute inset-y-0 right-0 w-full max-w-[420px] shadow-drawer">
                  <LeadDetailDrawer lead={detail} onClose={() => setSelected(null)} />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </AppShell>
    </div>
  );
}
