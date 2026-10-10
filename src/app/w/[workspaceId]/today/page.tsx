import type { Metadata } from "next";
import { cache } from "react";
import { SectionPage } from "@/components/shell/section-page";
import { OperationalSummaryCards } from "@/components/today/summary-cards";
import { NeedsAttention, RefreshScoresButton, TodayBoard } from "@/components/today/today-board";
import { WorkflowSheetHost } from "@/components/workflow/sheet-host";
import { utcToLocalInput } from "@/lib/contact-workflow/time";
import { getTodayView, getWorkspace } from "@/lib/dal";
import { workspacePath } from "@/lib/navigation";

export const metadata: Metadata = { title: "Today" };

/** One Today view per request (shared by the header action and the page body). */
const loadToday = cache(async (workspaceId: string, timezone: string) => {
  const now = new Date();
  return { now, view: await getTodayView({ id: workspaceId, timezone }, now) };
});

/** Header action: the explicit, bounded "Refresh lead scores" batch (only with a default ICP). */
async function RefreshAction({ params }: { params: Promise<{ workspaceId: string }> }) {
  const ws = await getWorkspace((await params).workspaceId);
  const { view } = await loadToday(ws.id, ws.timezone);
  return view.state === "ok" ? <RefreshScoresButton workspaceId={ws.id} pendingCount={view.attention.unscored + view.attention.outdated} /> : null;
}

/**
 * Today (P1-E7): what to do now, from real data. "Today" is the calendar day
 * in the workspace's time zone. Callbacks and follow-ups due, prospects ready
 * to contact (current A/B grades for the default ICP with a callable contact)
 * and the attempts recorded today. Nothing here scores automatically or calls
 * a provider; "Refresh lead scores" is an explicit, bounded batch.
 */
export default function TodayPage({ params }: PageProps<"/w/[workspaceId]/today">) {
  return (
    <SectionPage
      params={params}
      title="Today"
      description={(ws) => (
        <>
          Follow-ups and calls due for {ws.name}.
          <span className="block text-[13px] text-ink-subtle">Times in {ws.timezone.replaceAll("_", " ")}</span>
        </>
      )}
      actions={<RefreshAction params={params} />}
    >
      {async (ws) => {
        const { now, view } = await loadToday(ws.id, ws.timezone);
        const leadsPath = workspacePath(ws.id, "leads");
        const time = { timezoneLabel: view.timezoneLabel, today: utcToLocalInput(now, ws.timezone).date };
        return (
          <WorkflowSheetHost>
            <OperationalSummaryCards summary={view.summary} />
            <NeedsAttention view={view} workspaceId={ws.id} leadsPath={leadsPath} time={time} />
            <TodayBoard view={view} workspaceId={ws.id} leadsPath={leadsPath} settingsPath={workspacePath(ws.id, "settings")} time={time} />
          </WorkflowSheetHost>
        );
      }}
    </SectionPage>
  );
}
