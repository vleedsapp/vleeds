import { Building, ExternalLink, Target } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SectionPage } from "@/components/shell/section-page";
import { BusinessProfileEditButton } from "@/components/settings/business-profile-editor";
import { ProspectingConfiguration } from "@/components/settings/prospecting-configuration";
import { Panel, PanelHeader, StatusPill } from "@/components/ui/primitives";
import { allSectionStatuses } from "@/lib/config/icp-status";
import { canConfigureWorkspace, getDefaultIcpProfile } from "@/lib/dal";

export const metadata: Metadata = { title: "Settings" };

/**
 * Business profile + prospecting configuration. Every business-specific aspect
 * of prospecting is workspace data (icp_profiles); see
 * docs/product/vleeds-icp-configuration.md. Owners/admins edit; members get
 * the same sheets read-only. The server actions and RLS enforce this again.
 */
export default function SettingsPage({ params }: PageProps<"/w/[workspaceId]/settings">) {
  return (
    <SectionPage
      params={params}
      title="Settings"
      description={() => <>Business profile and prospecting configuration for this workspace.</>}
    >
      {(ws) => {
        const canEdit = canConfigureWorkspace(ws.role);
        return (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
            <Panel aria-labelledby="business-profile-title" className="p-5 sm:p-6">
              <PanelHeader
                id="business-profile-title"
                icon={<Building className="stroke-[1.75]" />}
                title="Business profile"
                description="General information about this workspace."
                action={
                  canEdit ? (
                    <BusinessProfileEditButton
                      workspaceId={ws.id}
                      profile={{ name: ws.name, primaryDomain: ws.primaryDomain, websiteUrl: ws.websiteUrl, description: ws.description, timezone: ws.timezone }}
                    />
                  ) : null
                }
              />
              <dl className="mt-5 border-t border-line">
                <Row label="Workspace">{ws.name}</Row>
                <Row label="Organization">{ws.organization.name}</Row>
                <Row label="Primary domain">{ws.primaryDomain ?? <Missing />}</Row>
                <Row label="Website">
                  {ws.websiteUrl ? (
                    <a
                      href={ws.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-2 text-brand underline underline-offset-[3px] hover:text-brand-hover"
                    >
                      <span className="truncate">{ws.websiteUrl}</span>
                      <ExternalLink aria-hidden className="size-4 shrink-0 text-ink-muted" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : (
                    <Missing />
                  )}
                </Row>
                <Row label="Description">{ws.description ?? <Missing />}</Row>
                <Row label="Time zone">{ws.timezone.replaceAll("_", " ")}</Row>
                <Row label="Your role">
                  <StatusPill tone="brand" className="capitalize">
                    {ws.role}
                  </StatusPill>
                </Row>
              </dl>
            </Panel>

            <Panel aria-labelledby="prospecting-title" className="p-5 sm:p-6">
              <PanelHeader
                id="prospecting-title"
                icon={<Target className="stroke-[1.75]" />}
                title="Prospecting configuration"
                description="Configure how Vleeds finds, qualifies, and scores prospects."
              />
              <Prospecting workspaceId={ws.id} canEdit={canEdit} />
            </Panel>
          </div>
        );
      }}
    </SectionPage>
  );
}

async function Prospecting({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const profile = await getDefaultIcpProfile(workspaceId);
  return (
    <ProspectingConfiguration
      workspaceId={workspaceId}
      profile={profile}
      statuses={allSectionStatuses(profile)}
      canEdit={canEdit}
    />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-4 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center sm:gap-4">
      <dt className="text-[14px] text-ink-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-[15px] text-ink">{children}</dd>
    </div>
  );
}

function Missing() {
  return <span className="text-ink-subtle">Not set</span>;
}
