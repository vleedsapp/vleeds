import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/primitives";
import { getWorkspace, type WorkspaceDetail } from "@/lib/dal";

/**
 * Wrapper for every workspace section page. Pages re-authorize the workspace
 * themselves (deduplicated with the layout's lookup) rather than trusting
 * that the layout ran — layouts are not re-rendered on every navigation.
 */
export async function SectionPage({
  params,
  title,
  description,
  actions,
  children,
}: {
  params: Promise<{ workspaceId: string }>;
  title: string;
  description?: (workspace: WorkspaceDetail) => ReactNode;
  actions?: ReactNode;
  children: (workspace: WorkspaceDetail) => ReactNode;
}) {
  const { workspaceId } = await params;
  const workspace = await getWorkspace(workspaceId);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <PageHeader title={title} description={description?.(workspace)} actions={actions} />
      {children(workspace)}
    </div>
  );
}
