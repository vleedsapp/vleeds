"use client";

import type { ReactNode } from "react";
import { saveIcpSection } from "@/app/w/[workspaceId]/settings/actions";
import { DEFAULT_PROFILE_NAME, type IcpProfileConfig, type IcpSection, type IcpSectionValue } from "@/lib/config/icp";

export type EditorProps = {
  workspaceId: string;
  /** The workspace's default profile, or null before anything was saved. */
  profile: IcpProfileConfig | null;
  readOnly: boolean;
  onClose: () => void;
};

/** Sends one section of the default profile. The server re-validates everything. */
export function sendSection<S extends IcpSection>(
  workspaceId: string,
  profile: IcpProfileConfig | null,
  section: S,
  value: IcpSectionValue<S>,
) {
  return saveIcpSection(workspaceId, {
    section,
    profileId: profile?.id ?? null,
    revision: profile?.revision ?? null,
    value,
  });
}

/** Sheet subtitle: which profile is being edited, or that saving creates it. */
export function profileNote(profile: IcpProfileConfig | null, base: string): string {
  return profile
    ? `${base} Profile: ${profile.name}.`
    : `${base} Saving creates this workspace's ${DEFAULT_PROFILE_NAME.toLowerCase()}.`;
}

export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Read-only label/value row used by member views. */
export function ReadRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 last:border-b-0 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[13.5px] text-ink-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-[14.5px] text-ink">{children}</dd>
    </div>
  );
}

export function NotSet({ children = "Not set" }: { children?: ReactNode }) {
  return <span className="text-ink-subtle">{children}</span>;
}

export function ChipList({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return <NotSet />;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((v) => (
        <li key={v} className="inline-flex h-7 items-center rounded-full bg-sunken px-3 text-[13px] text-ink">
          {v}
        </li>
      ))}
    </ul>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-center text-[14px] text-ink-muted">{children}</p>
  );
}
