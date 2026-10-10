"use client";

import {
  Building,
  ChartNoAxesColumnIncreasing,
  ClipboardList,
  ExternalLink,
  Link as LinkIcon,
  Mail,
  MapPin,
  Phone,
  Send,
  Tag,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { DrawerDetail, DrawerSection } from "./drawer-parts";
import { DISPOSITIONS, DispositionPill, LeadGradeBadge, SignalChip, type Disposition, type LeadGrade, type SignalTone } from "./lead-ui";

/** View model for the drawer. Presentational only. */
export type LeadDetailView = {
  id: string;
  company: string;
  subtitle: string;
  grade: LeadGrade;
  fit: number;
  contact: { name: string; role: string; phone?: string; email?: string; website?: string };
  details: { location: string; category: string; size: string; tags: string[] };
  signals: { label: string; tone: SignalTone }[];
  notes?: string;
};

/**
 * Canonical right-side lead detail drawer. Inline column on large screens,
 * overlay sheet below lg. Actions are presentational until calling/email
 * providers are configured in a later story.
 */
export function LeadDetailDrawer({ lead, onClose }: { lead: LeadDetailView; onClose: () => void }) {
  const [disposition, setDisposition] = useState<Disposition | null>(null);
  const first = lead.contact.name.split(" ")[0];

  return (
    <aside
      aria-label={`${lead.company} details`}
      className="flex h-full flex-col overflow-y-auto bg-surface"
    >
      <div className="relative px-6 pb-5 pt-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-ink-muted hover:bg-sunken"
        >
          <X aria-hidden className="size-5" />
        </button>
        <div className="flex items-start gap-4 pr-8">
          <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-2xl bg-brand-tint text-brand-strong">
            <Building className="size-7 stroke-[1.6]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[21px] font-semibold leading-7 tracking-[-0.01em] text-ink">{lead.company}</h2>
            <p className="text-[14px] text-ink-muted">{lead.subtitle}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <span className="inline-flex h-8 items-center gap-2 rounded-full bg-brand-tint pl-3 pr-1 text-[13px] font-medium text-brand-strong">
                Grade <LeadGradeBadge grade={lead.grade} size="sm" tone="brand" />
              </span>
              <span className="inline-flex h-8 items-center gap-2 rounded-full bg-brand-tint pl-3 pr-1.5 text-[13px] font-medium text-brand-strong">
                Fit score
                <span className="grid h-6 min-w-6 place-items-center rounded-full bg-brand-tint-strong px-1 text-[12px] font-semibold">
                  {lead.fit}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <Section icon={UserRound} title="Contact Information">
        <Detail icon={UserRound}>
          <div className="text-ink">{lead.contact.name}</div>
          <div className="text-[13px] text-ink-subtle">{lead.contact.role}</div>
        </Detail>
        {lead.contact.phone ? <Detail icon={Phone}>{lead.contact.phone}</Detail> : null}
        {lead.contact.email ? <Detail icon={Mail}>{lead.contact.email}</Detail> : null}
        {lead.contact.website ? (
          <Detail icon={LinkIcon}>
            <a href={lead.contact.website} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
              {lead.contact.website}
            </a>
          </Detail>
        ) : null}
      </Section>

      <Section icon={Building} title="Company Details">
        <Detail icon={MapPin}>{lead.details.location}</Detail>
        <Detail icon={Tag}>{lead.details.category}</Detail>
        <Detail icon={Users}>{lead.details.size}</Detail>
        <div className="flex flex-wrap gap-1.5">
          {lead.details.tags.map((t) => (
            <span key={t} className="inline-flex h-7 items-center rounded-full bg-sunken px-3 text-[12.5px] text-ink-muted">
              {t}
            </span>
          ))}
        </div>
      </Section>

      <Section icon={ChartNoAxesColumnIncreasing} title="Signals & Notes">
        <div className="flex flex-wrap gap-1.5">
          {lead.signals.map((s) => (
            <SignalChip key={s.label} tone={s.tone}>
              {s.label}
            </SignalChip>
          ))}
        </div>
        {lead.notes ? <p className="text-[14px] leading-6 text-ink-muted">{lead.notes}</p> : null}
      </Section>

      <Section icon={Send} title="Actions">
        <div className="grid grid-cols-2 gap-2.5 [&_button]:whitespace-nowrap [&_button]:px-2 [&_button]:text-[13.5px]">
          <Button variant="primary" className="h-10">
            <Phone aria-hidden className="size-4" />
            Call {first}
          </Button>
          <Button className="h-10">
            <Phone aria-hidden className="size-4" />
            Call Company
          </Button>
          <Button className="h-10">
            <Mail aria-hidden className="size-4" />
            Email
          </Button>
          <Button className="h-10">
            <ExternalLink aria-hidden className="size-4" />
            Open Website
          </Button>
        </div>
      </Section>

      <Section icon={ClipboardList} title="Disposition" last>
        <div role="group" aria-label="Disposition" className="flex flex-wrap gap-2">
          {DISPOSITIONS.map((d) => (
            <DispositionPill key={d.value} value={d.value} selected={disposition === d.value} onSelect={setDisposition} />
          ))}
        </div>
      </Section>
    </aside>
  );
}

const Section = DrawerSection;
const Detail = DrawerDetail;
