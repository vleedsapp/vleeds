import {
  AlignLeft,
  Building,
  Factory,
  ClipboardCheck,
  FileSearch,
  Globe,
  History,
  Link as LinkIcon,
  Mail,
  MapPin,
  Phone,
  Star,
  StickyNote,
  UserRound,
  Users,
} from "lucide-react";
import { StatusPill } from "@/components/ui/primitives";
import { CONTACT_STATUS_LABEL, fieldLabel, formatDate, SOURCE_KIND_LABEL } from "@/lib/lead-core/display";
import type { CompanyDetail } from "@/lib/lead-core/views";
import { FindDecisionMakers, type ContactDiscoveryInfo } from "@/components/contacts/find-decision-makers";
import { EnrichCompanyButton } from "@/components/enrichment/enrich-company-button";
import { FitPanel } from "@/components/scoring/fit-panel";
import { StartContactButton } from "@/components/workflow/contact-sheet";
import { WorkflowSheetHost } from "@/components/workflow/sheet-host";
import { ScheduleTaskButton, TaskActions } from "@/components/workflow/task-controls";
import type { CompanyWorkflow } from "@/lib/dal/contact-workflow";
import { AddContactButton } from "./add-contact-sheet";
import { QualificationPill, RestrictedPill } from "./company-table";
import { CompanyDrawerFrame } from "./company-drawer-frame";
import { DrawerDetail, DrawerSection } from "./drawer-parts";
import { LeadGradeBadge } from "./lead-ui";
import { QualificationControl } from "./qualification-control";
import { RestrictionControl } from "./restriction-control";

/**
 * Company detail drawer for the lead core. Shows recorded facts, the manual
 * contact workflow (P1-E7: Start contact, next actions, Activity) and stored
 * scores. There is no email or automation; calls are placed by the user on
 * their own phone. Restrictions are stated in text and remove contact actions.
 */
export function CompanyDrawer({
  company,
  workspaceId,
  closeHref,
  canLift,
  enrichment = null,
  leadsPath = "",
  contactDiscovery = null,
  settingsPath = "",
  workflow = null,
}: {
  company: CompanyDetail;
  workspaceId: string;
  closeHref: string;
  /** Owners/admins may lift restrictions. */
  canLift: boolean;
  /** Configured company-enrichment provider (P1-E4); null hides "Enrich company". */
  enrichment?: { label: string; estimateMillis: number | null } | null;
  leadsPath?: string;
  /** P1-E5: contact discovery state for this company (null hides it). */
  contactDiscovery?: ContactDiscoveryInfo | null;
  /** Settings path (ICP configuration pointer). */
  settingsPath?: string;
  /** P1-E7: next actions, last contact and activity (null hides the workflow controls). */
  workflow?: CompanyWorkflow | null;
}) {
  const titleId = `company-${company.id}-title`;
  const current = company.scores.find((s) => !s.outdated && s.status === "scored");
  const subtitle = [company.location, company.domain].filter(Boolean).join(" · ");
  const time = workflow ? { timezoneLabel: workflow.timezoneLabel, today: workflow.today } : null;
  // Contacts that can receive a new task: callable and without an open task.
  const schedulable = workflow
    ? company.contacts.filter((p) => !workflow.contacts[p.id]?.blocker && !workflow.contacts[p.id]?.openTask).map((p) => ({ id: p.id, name: p.fullName }))
    : [];

  return (
    <CompanyDrawerFrame companyId={company.id} titleId={titleId} closeHref={closeHref}>
      <WorkflowSheetHost>
      <div className="px-6 pb-5 pt-6">
        <div className="flex items-start gap-4 pr-10">
          <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-tint text-brand-strong">
            <Building className="size-7 stroke-[1.6]" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} tabIndex={-1} className="text-[21px] font-semibold leading-7 tracking-[-0.01em] text-ink outline-none">
              {company.name}
            </h2>
            {subtitle ? <p className="text-[14px] text-ink-muted">{subtitle}</p> : null}
            <div className="mt-2.5 flex flex-wrap gap-2">
              <QualificationPill state={company.qualification} />
              {current?.grade ? (
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-brand-tint pl-2.5 pr-0.5 text-[12px] font-medium text-brand-strong">
                  Grade <LeadGradeBadge grade={current.grade} size="sm" tone="brand" />
                </span>
              ) : null}
              {company.restriction ? <RestrictedPill label="Company restricted" /> : null}
            </div>
          </div>
        </div>
        {company.restriction ? (
          <p role="note" className="mt-4 rounded-md border border-line-strong bg-surface-muted px-3.5 py-2.5 text-[13.5px] leading-5 text-ink">
            <span className="font-medium">Do not contact this company.</span>
            {company.restriction.reason ? <span className="text-ink-muted"> Reason: {company.restriction.reason}</span> : null}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <RestrictionControl workspaceId={workspaceId} companyId={company.id} restriction={company.restriction} canLift={canLift} />
          {enrichment ? (
            <EnrichCompanyButton
              workspaceId={workspaceId}
              company={{ id: company.id, name: company.name, domain: company.domain }}
              provider={enrichment}
              leadsPath={leadsPath}
            />
          ) : null}
        </div>
      </div>

      <DrawerSection icon={Building} title="Company Details" id={`${titleId}-details`}>
        {company.address || company.location ? (
          <DrawerDetail icon={MapPin} label="Location">{company.address ?? company.location}</DrawerDetail>
        ) : null}
        {company.websiteUrl ? (
          <DrawerDetail icon={Globe} label="Website">
            <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
              {company.websiteUrl}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </DrawerDetail>
        ) : null}
        {company.phone ? <DrawerDetail icon={Phone} label="Phone">{company.phone}</DrawerDetail> : null}
        {company.employees ? <DrawerDetail icon={Users} label="Employees">{company.employees}</DrawerDetail> : null}
        {company.industry ? <DrawerDetail icon={Factory} label="Industry">{company.industry}</DrawerDetail> : null}
        {company.description ? <DrawerDetail icon={AlignLeft} label="Description">{company.description}</DrawerDetail> : null}
        {company.notes ? <DrawerDetail icon={StickyNote} label="Notes">{company.notes}</DrawerDetail> : null}
        {!company.address && !company.location && !company.websiteUrl && !company.phone && !company.employees && !company.industry && !company.description && !company.notes ? (
          <p className="text-[14px] text-ink-subtle">No company details recorded yet.</p>
        ) : null}
      </DrawerSection>

      <DrawerSection icon={ClipboardCheck} title="Qualification" id={`${titleId}-qualification`}>
        <QualificationControl
          workspaceId={workspaceId}
          companyId={company.id}
          state={company.qualification}
          reason={company.qualificationReason}
        />
      </DrawerSection>

      <DrawerSection icon={UserRound} title={`Contacts (${company.contacts.length})`} id={`${titleId}-contacts`}>
        {company.contacts.length === 0 ? (
          <p className="text-[14px] text-ink-subtle">No contacts recorded for this company.</p>
        ) : (
          <ul className="-ml-8 flex flex-col divide-y divide-line">
            {company.contacts.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[14.5px] font-medium text-ink">{p.fullName}</span>
                  {p.isPrimary ? <StatusPill tone="brand" className="h-6 px-2.5 text-[12px]">Primary</StatusPill> : null}
                  {p.status !== "active" ? <StatusPill tone="neutral" className="h-6 px-2.5 text-[12px]">{CONTACT_STATUS_LABEL[p.status]}</StatusPill> : null}
                  {p.restriction ? <RestrictedPill label="Contact restricted" /> : null}
                </div>
                {p.jobTitle ? <p className="text-[13px] text-ink-subtle">{p.jobTitle}</p> : null}
                <div className="flex flex-col gap-1 text-[13.5px] text-ink-muted">
                  {p.email ? (
                    <span className="flex items-center gap-2 break-all">
                      <Mail aria-hidden className="size-4 shrink-0 text-ink-subtle" />
                      <span className="sr-only">Email: </span>
                      {p.email}
                    </span>
                  ) : null}
                  {p.phone ? (
                    <span className="flex items-center gap-2">
                      <Phone aria-hidden className="size-4 shrink-0 text-ink-subtle" />
                      <span className="sr-only">Phone: </span>
                      {p.phone}
                    </span>
                  ) : null}
                  {p.linkedinUrl ? (
                    <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-brand hover:underline">
                      <LinkIcon aria-hidden className="size-4 shrink-0" />
                      Profile<span className="sr-only"> of {p.fullName} (opens in a new tab)</span>
                    </a>
                  ) : null}
                </div>
                {p.restriction?.reason ? <p className="text-[12.5px] text-ink-subtle">Restricted: {p.restriction.reason}</p> : null}
                {workflow && time && workflow.contacts[p.id] ? (
                  <ContactNextAction
                    workspaceId={workspaceId}
                    companyId={company.id}
                    contact={{ id: p.id, name: p.fullName }}
                    wf={workflow.contacts[p.id]}
                    schedulable={schedulable}
                    time={time}
                  />
                ) : null}
                <RestrictionControl workspaceId={workspaceId} companyId={company.id} contact={{ id: p.id, name: p.fullName }} restriction={p.restriction} canLift={canLift} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-3">
          <AddContactButton workspaceId={workspaceId} companyId={company.id} companyName={company.name} hasPrimary={company.contacts.some((p) => p.isPrimary)} />
          {contactDiscovery ? (
            <FindDecisionMakers
              workspaceId={workspaceId}
              company={{ id: company.id, name: company.name, domain: company.domain, restricted: !!company.restriction }}
              info={contactDiscovery}
            />
          ) : null}
        </div>
      </DrawerSection>

      {workflow ? (
        <DrawerSection icon={History} title="Activity" id={`${titleId}-activity`}>
          <p className="text-[13.5px] text-ink-muted">
            {workflow.lastContact} <span className="text-ink-subtle">· Times in {workflow.timezone.replaceAll("_", " ")}</span>
          </p>
          {workflow.activity.length === 0 ? (
            <p className="text-[14px] text-ink-subtle">No contact attempts or tasks yet.</p>
          ) : (
            <ul aria-label="Recent activity" className="-ml-8 flex flex-col divide-y divide-line">
              {workflow.activity.map((a) => (
                <li key={`${a.type}-${a.id}`} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] text-ink-subtle">{a.when}</span>
                    <span className="text-[14px] font-medium text-ink">{a.title}</span>
                    {a.type === "task" ? (
                      <StatusPill tone={a.status === "open" ? "brand" : "neutral"} className="h-6 px-2.5 text-[12px]">
                        {a.detail}
                      </StatusPill>
                    ) : null}
                  </div>
                  <p className="text-[13px] text-ink-muted">
                    {a.contactName}
                    {a.type === "attempt" ? <span className="text-ink-subtle"> · {a.detail}</span> : null}
                  </p>
                  {a.note ? <p className="break-words text-[13px] text-ink-subtle">{a.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
          {workflow.activityTruncated ? <p className="text-[12.5px] text-ink-subtle">Showing the most recent activity.</p> : null}
        </DrawerSection>
      ) : null}

      <DrawerSection icon={Star} title="ICP Scores" id={`${titleId}-scores`}>
        <FitPanel
          workspaceId={workspaceId}
          company={{ id: company.id, name: company.name }}
          fit={company.fit}
          scores={company.scores}
          settingsPath={settingsPath}
        />
      </DrawerSection>

      <DrawerSection icon={FileSearch} title="Sources" id={`${titleId}-sources`} last>
        {company.evidence.length === 0 ? (
          <p className="text-[14px] text-ink-subtle">No source evidence recorded.</p>
        ) : (
          <>
            <ul aria-label="Source evidence" className="-ml-8 flex flex-col divide-y divide-line">
              {company.evidence.map((e) => (
                <li key={e.id} className="py-2.5 first:pt-0">
                  <p className="text-[13px] font-medium text-ink">
                    {fieldLabel(e.fieldKey)}
                    {e.contactName ? <span className="font-normal text-ink-subtle"> · {e.contactName}</span> : null}
                  </p>
                  {e.value ? <p className="break-words text-[13.5px] text-ink-muted">{e.value}</p> : null}
                  <p className="text-[12.5px] text-ink-subtle">
                    Source: {SOURCE_KIND_LABEL[e.sourceKind]}
                    {e.providerKey ? ` (${e.providerKey})` : ""}
                    {e.confidence !== null ? ` · Confidence ${e.confidence}%` : ""}
                    {e.observedAt ? ` · ${formatDate(e.observedAt)}` : ""}
                  </p>
                  {e.sourceUrl ? (
                    <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-brand hover:underline">
                      View source<span className="sr-only"> for {fieldLabel(e.fieldKey)} (opens in a new tab)</span>
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
            {company.evidenceTotal > company.evidence.length ? (
              <p className="text-[12.5px] text-ink-subtle">
                Showing the {company.evidence.length} most recent of {company.evidenceTotal} records.
              </p>
            ) : null}
          </>
        )}
      </DrawerSection>
      </WorkflowSheetHost>
    </CompanyDrawerFrame>
  );
}

/** A contact's workflow line in the drawer: last contact, open task (with actions), Start contact / Schedule follow-up. */
function ContactNextAction({
  workspaceId,
  companyId,
  contact,
  wf,
  schedulable,
  time,
}: {
  workspaceId: string;
  companyId: string;
  contact: { id: string; name: string };
  wf: CompanyWorkflow["contacts"][string];
  schedulable: { id: string; name: string }[];
  time: { timezoneLabel: string; today: string };
}) {
  return (
    <div className="mt-1 flex flex-col gap-2">
      <p className="text-[12.5px] text-ink-subtle">{wf.lastContact}</p>
      {wf.openTask ? (
        <p className="text-[13px] text-ink">
          <span className="font-medium">Next: {wf.openTask.kindLabel}</span> · {wf.openTask.dueLabel}
          {wf.openTask.stateLabel ? <span className="text-ink-subtle"> · {wf.openTask.stateLabel}</span> : null}
          {wf.openTask.note ? <span className="block text-[12.5px] text-ink-subtle">{wf.openTask.note}</span> : null}
        </p>
      ) : null}
      {wf.blocker && !wf.blocker.includes("restricted") ? <p className="text-[12.5px] text-ink-subtle">{wf.blocker}: can&apos;t be called.</p> : null}
      <div className="flex flex-wrap gap-2">
        {!wf.blocker ? (
          <StartContactButton
            workspaceId={workspaceId}
            companyId={companyId}
            contactId={contact.id}
            taskId={wf.openTask?.id ?? null}
            label="Start contact"
            variant="secondary"
            accessibleLabel={`Start contact with ${contact.name}`}
          />
        ) : null}
        {wf.openTask ? (
          <TaskActions
            workspaceId={workspaceId}
            time={time}
            canReschedule={!wf.blocker}
            canComplete={!wf.blocker}
            task={{ id: wf.openTask.id, kindLabel: wf.openTask.kindLabel, contactName: contact.name, dueLabel: wf.openTask.dueLabel, date: wf.openTask.date, time: wf.openTask.time }}
          />
        ) : !wf.blocker ? (
          <ScheduleTaskButton workspaceId={workspaceId} companyId={companyId} contacts={schedulable} contactId={contact.id} time={time} />
        ) : null}
      </div>
    </div>
  );
}
