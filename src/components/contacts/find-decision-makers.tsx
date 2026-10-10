"use client";

import { UserSearch } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { ContactDiscoverySheet, type IcpRoles } from "./contact-discovery-sheet";

export type ContactDiscoveryInfo = {
  configured: boolean;
  label: string | null;
  estimateMillis: number | null;
  icps: IcpRoles[];
  settingsPath: string;
  lastRun: { resultCount: number; savedCount: number; icpName: string | null; status: string; createdAt: string } | null;
};

const STATUS_TEXT: Record<string, string> = {
  searching: "Searching",
  review: "In review",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
  draft: "Draft",
};

/**
 * "Find decision makers" in the company drawer's Contacts section. Explains
 * calmly why it isn't available (not configured, no domain, do not contact)
 * and shows the company's last contact search.
 */
export function FindDecisionMakers({
  workspaceId,
  company,
  info,
}: {
  workspaceId: string;
  company: { id: string; name: string; domain: string | null; restricted: boolean };
  info: ContactDiscoveryInfo;
}) {
  const [open, setOpen] = useState(false);
  const reason = !info.configured
    ? "Contact discovery is not configured yet."
    : !company.domain
      ? "Add or enrich this company with a domain before finding contacts."
      : company.restricted
        ? "This company is marked do not contact."
        : null;

  return (
    <div className="flex flex-col gap-1.5" data-contact-discovery>
      {reason ? (
        <p className="text-[13px] text-ink-subtle">{reason}</p>
      ) : (
        <Button type="button" variant="soft" className="h-11 self-start sm:h-9" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <UserSearch aria-hidden className="size-4" />
          Find decision makers
        </Button>
      )}
      {info.lastRun ? (
        <p className="text-[12.5px] text-ink-subtle">
          Last search: {info.lastRun.resultCount} contact{info.lastRun.resultCount === 1 ? "" : "s"} found
          {info.lastRun.savedCount ? ` · ${info.lastRun.savedCount} saved` : ""}
          {info.lastRun.icpName ? ` · ICP: ${info.lastRun.icpName}` : ""} · {STATUS_TEXT[info.lastRun.status] ?? info.lastRun.status} ·{" "}
          {new Date(info.lastRun.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
        </p>
      ) : null}
      {open && company.domain && info.label ? (
        <ContactDiscoverySheet
          workspaceId={workspaceId}
          company={{ id: company.id, name: company.name, domain: company.domain }}
          providerLabel={info.label}
          estimateMillis={info.estimateMillis}
          icps={info.icps}
          settingsPath={info.settingsPath}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
