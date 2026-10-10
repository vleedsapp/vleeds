import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ShellSkeleton } from "@/components/shell/skeletons";
import { getWorkspace, listWorkspaces, requireUser } from "@/lib/dal";

/**
 * Workspace-scoped shell. The workspace id in the URL is only a lookup key:
 * getWorkspace() resolves it through RLS and 404s if the user is not a member
 * of its organization (identical response for "missing" and "forbidden").
 */
export default function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspaceId]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <WorkspaceFrame params={params}>{children}</WorkspaceFrame>
    </Suspense>
  );
}

async function WorkspaceFrame({
  params,
  children,
}: {
  params: LayoutProps<"/w/[workspaceId]">["params"];
  children: React.ReactNode;
}) {
  const { workspaceId } = await params;
  const [user, workspace, workspaces] = await Promise.all([
    requireUser(),
    getWorkspace(workspaceId),
    listWorkspaces(),
  ]);

  return (
    <AppShell
      workspace={{ id: workspace.id, name: workspace.name, slug: workspace.slug, organization: workspace.organization }}
      workspaces={workspaces}
      userEmail={user.email}
    >
      {children}
    </AppShell>
  );
}
