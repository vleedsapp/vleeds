import { Send } from "lucide-react";
import type { Metadata } from "next";
import { SectionPage } from "@/components/shell/section-page";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage({ params }: PageProps<"/w/[workspaceId]/campaigns">) {
  return (
    <SectionPage
      params={params}
      title="Campaigns"
      description={() => <>Group leads into focused prospecting efforts and track their outcomes.</>}
    >
      {() => (
        <EmptyState icon={<Send />} title="No campaigns yet">
          A campaign pairs a target profile with a set of leads so contact attempts and results stay together.
        </EmptyState>
      )}
    </SectionPage>
  );
}
