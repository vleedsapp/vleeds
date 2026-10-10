"use client";

import {
  Ban,
  Briefcase,
  ChartNoAxesColumnIncreasing,
  ChevronRight,
  Database,
  MapPin,
  Phone,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { StatusPill, type Tone } from "@/components/ui/primitives";
import type { IcpProfileConfig, IcpSection } from "@/lib/config/icp";
import type { ConfigState, SectionStatus } from "@/lib/config/icp-status";
import type { EditorProps } from "./editor-shared";
import { GeographiesEditor } from "./geographies-editor";
import { IdealCustomerEditor } from "./ideal-customer-editor";
import { BuyingSignalsEditor, DecisionMakersEditor, ExclusionSignalsEditor } from "./roles-signals-editors";
import { ScoringEditor } from "./scoring-editor";

type Area = { icon: LucideIcon; label: string; detail: string };

/** The canonical configuration rows. ICP rows open an editor; provider rows belong to later stories. */
const ICP_AREAS: (Area & { section: IcpSection; editor: ComponentType<EditorProps> })[] = [
  { section: "ideal_customer", editor: IdealCustomerEditor, icon: Users, label: "Ideal customer profile", detail: "Define your target companies, industries, size, and describe your ideal customer." },
  { section: "geographies", editor: GeographiesEditor, icon: MapPin, label: "Target geographies", detail: "Set the countries, regions, and cities you want to target." },
  { section: "decision_makers", editor: DecisionMakersEditor, icon: Briefcase, label: "Decision-maker titles", detail: "Specify the job titles and roles to target." },
  { section: "buying_signals", editor: BuyingSignalsEditor, icon: ChartNoAxesColumnIncreasing, label: "Buying signals", detail: "Choose the intent signals and triggers that indicate buying interest." },
  { section: "exclusion_signals", editor: ExclusionSignalsEditor, icon: Ban, label: "Exclusion signals", detail: "Define companies, industries, or keywords to exclude." },
  { section: "scoring", editor: ScoringEditor, icon: Star, label: "Scoring rules", detail: "Set up how leads are scored based on fit and intent." },
];

const LATER_AREAS: Area[] = [
  { icon: Database, label: "Enrichment providers", detail: "Configure data enrichment providers and field mappings." },
  { icon: Phone, label: "Calling provider", detail: "Connect your calling provider for outbound campaigns." },
];

const STATE_TONE: Record<ConfigState, Tone> = { not_configured: "attention", partial: "warning", configured: "brand" };

function Pill({ status }: { status: SectionStatus }) {
  return (
    <StatusPill tone={STATE_TONE[status.state]} dot>
      {status.label}
    </StatusPill>
  );
}

export function ProspectingConfiguration({
  workspaceId,
  profile,
  statuses,
  canEdit,
}: {
  workspaceId: string;
  profile: IcpProfileConfig | null;
  statuses: Record<IcpSection, SectionStatus>;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState<IcpSection | null>(null);
  const active = ICP_AREAS.find((a) => a.section === open);
  const Editor = active?.editor;

  return (
    <>
      <ul className="mt-5 border-t border-line">
        {ICP_AREAS.map(({ section, icon: Icon, label, detail }) => (
          <li key={section} className="border-b border-line">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setOpen(section)}
              data-section={section}
              className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-4 rounded-lg px-2 py-3.5 text-left transition-colors hover:bg-surface-muted"
            >
              <Icon aria-hidden className="size-[22px] shrink-0 self-start stroke-[1.6] text-ink sm:mt-0.5 sm:self-center" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-ink">{label}</span>
                <span className="block text-[13.5px] leading-5 text-ink-muted">{detail}</span>
                <span className="mt-2 block sm:hidden">
                  <Pill status={statuses[section]} />
                </span>
              </span>
              <span className="hidden sm:inline-flex">
                <Pill status={statuses[section]} />
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-subtle" />
              <span className="sr-only">{canEdit ? "(edit)" : "(view)"}</span>
            </button>
          </li>
        ))}
        {LATER_AREAS.map(({ icon: Icon, label, detail }) => (
          <li key={label} className="flex items-center gap-4 border-b border-line py-3.5 last:border-b-0" data-later-step>
            <Icon aria-hidden className="size-[22px] shrink-0 self-start stroke-[1.6] text-ink sm:mt-0.5 sm:self-center" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-ink">{label}</p>
              <p className="text-[13.5px] leading-5 text-ink-muted">{detail}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-subtle">Available in a later setup step.</p>
              <span className="mt-2 block sm:hidden">
                <Pill status={{ state: "not_configured", label: "Not configured" }} />
              </span>
            </div>
            <span className="hidden sm:inline-flex">
              <Pill status={{ state: "not_configured", label: "Not configured" }} />
            </span>
            <span aria-hidden className="size-5 shrink-0" />
          </li>
        ))}
      </ul>
      {Editor ? <Editor workspaceId={workspaceId} profile={profile} readOnly={!canEdit} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
