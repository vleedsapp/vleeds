"use client";

import { DatabaseZap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { EnrichmentSheet } from "./enrichment-sheet";

/** "Enrich company" in the company drawer (shown only when an enrichment provider is configured). */
export function EnrichCompanyButton({
  workspaceId,
  company,
  provider,
  leadsPath,
}: {
  workspaceId: string;
  company: { id: string; name: string; domain: string | null };
  provider: { label: string; estimateMillis: number | null };
  leadsPath: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="soft" className="h-11 sm:h-9" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <DatabaseZap aria-hidden className="size-4" />
        Enrich company
      </Button>
      {open ? (
        <EnrichmentSheet
          workspaceId={workspaceId}
          start={{ source: "existing", companyId: company.id, companyName: company.name, domain: company.domain }}
          providerLabel={provider.label}
          estimateMillis={provider.estimateMillis}
          leadsPath={leadsPath}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
