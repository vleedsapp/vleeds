"use client";

import type { ReactNode } from "react";
import { VleedsLogo } from "@/components/ui/brand";
import { cx } from "@/components/ui/primitives";
import type { WorkspaceSummary } from "@/lib/dal";
import { MobileHeader } from "./mobile-shell";
import { MobileBottomNav, PrimaryNav } from "./primary-nav";
import { AccountMenu, NotificationsButton, SearchField } from "./top-bar";
import { WorkspaceSwitcher } from "./workspace-switcher";

type Props = {
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  userEmail: string | null;
  children: ReactNode;
  /** Let the page control its own padding (e.g. a full-height side drawer). */
  bleed?: boolean;
};

/**
 * Canonical authenticated frame.
 *  - lg+:  sidebar (logo, workspace selector, primary nav) + top utility bar
 *  - < lg: compact header + persistent bottom navigation
 * Receives only server-authorized, narrow data.
 */
export function AppShell({ workspace, workspaces, userEmail, children, bleed }: Props) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-canvas px-4 pb-5 pt-6 lg:flex">
        <div className="px-2.5">
          <VleedsLogo />
        </div>
        <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
        <PrimaryNav workspaceId={workspace.id} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-20 hidden h-[72px] items-center gap-6 border-b border-line/60 bg-surface px-7 shadow-bar lg:flex">
          <SearchField />
          <div className="ml-auto flex items-center gap-3">
            <NotificationsButton />
            <AccountMenu email={userEmail} />
          </div>
        </div>

        <MobileHeader workspace={workspace} workspaces={workspaces} userEmail={userEmail} />

        <main
          className={cx(
            "min-w-0 flex-1 pb-[calc(84px+env(safe-area-inset-bottom))]",
            bleed ? "lg:pb-0" : "mx-auto w-full max-w-[1440px] px-4 pt-5 sm:px-6 lg:px-7 lg:pb-10 lg:pt-7",
          )}
        >
          {children}
        </main>
      </div>

      <MobileBottomNav workspaceId={workspace.id} />
    </div>
  );
}
