import { Building, LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/auth/actions";
import { VleedsLogo } from "@/components/ui/brand";
import { PanelHeader } from "@/components/ui/primitives";
import { listAdminOrganizations, listWorkspaces, requireUser } from "@/lib/dal";
import { workspacePath } from "@/lib/navigation";
import { NewWorkspaceForm } from "./new-workspace-form";

export const metadata: Metadata = { title: "New workspace" };

export default function NewWorkspacePage() {
  return (
    <main className="min-h-dvh px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-[600px]">
        <VleedsLogo />
        <Suspense
          fallback={
            <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
              <div className="skeleton h-14 w-72 max-w-full" />
              <div className="mt-6 grid gap-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="skeleton h-11 w-full" />
                ))}
              </div>
            </div>
          }
        >
          <NewWorkspaceContent />
        </Suspense>
      </div>
    </main>
  );
}

async function NewWorkspaceContent() {
  const user = await requireUser();
  const [organizations, workspaces] = await Promise.all([listAdminOrganizations(), listWorkspaces()]);
  const firstTime = workspaces.length === 0;

  return (
    <>
      <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <PanelHeader
          icon={<Building className="stroke-[1.75]" />}
          title={firstTime ? "Set up your first workspace" : "New workspace"}
          description="A workspace holds the business profile, target customers and leads for one business."
        />
        <div className="mt-6 border-t border-line pt-6">
          <NewWorkspaceForm organizations={organizations} />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 px-1 text-[13.5px] text-ink-muted">
        <span className="min-w-0 truncate">Signed in as {user.email}</span>
        <div className="flex items-center gap-5">
          {workspaces[0] ? (
            <Link href={workspacePath(workspaces[0].id)} className="font-medium text-brand hover:underline">
              Back to workspaces
            </Link>
          ) : null}
          <form action={signOut}>
            <button type="submit" className="inline-flex items-center gap-1.5 hover:text-ink">
              <LogOut aria-hidden className="size-3.5" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
