import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";
import type { BusinessProfile } from "@/lib/config/business-profile";
import { isUuid } from "@/lib/navigation";
import type { MembershipRole } from "@/lib/supabase/app-types";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  organization: { id: string; name: string };
};

export type WorkspaceDetail = WorkspaceSummary & {
  description: string | null;
  websiteUrl: string | null;
  primaryDomain: string | null;
  logoUrl: string | null;
  /** IANA zone defining the workspace-local day (P1-E7). */
  timezone: string;
  createdAt: string;
  role: MembershipRole;
};

export type AdminOrganization = { id: string; name: string; role: MembershipRole };

/** Roles that may change a workspace's business profile and prospecting configuration. */
export function canConfigureWorkspace(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

type OrgEmbed = { id: string; name: string } | null;

/** All workspaces the user can access across all of their organizations (switcher source). */
export const listWorkspaces = cache(async (): Promise<WorkspaceSummary[]> => {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("workspaces")
    .select("id, name, slug, organization:organizations!inner(id, name)")
    .is("archived_at", null)
    .order("name");

  if (error) throw new DataAccessError("listWorkspaces", error);

  return (data ?? [])
    .filter((w) => w.organization)
    .map((w) => {
      const org = w.organization as unknown as NonNullable<OrgEmbed>;
      return { id: w.id, name: w.name, slug: w.slug, organization: { id: org.id, name: org.name } };
    });
});

/**
 * One workspace the user can access, with their role in it, or null.
 * Not cached: server actions use it to re-authorize on every mutation.
 */
export async function findWorkspace(workspaceId: string): Promise<WorkspaceDetail | null> {
  if (!isUuid(workspaceId)) return null;
  const user = await requireUser();
  const client = await supabase();

  const { data, error } = await client
    .from("workspaces")
    .select(
      "id, name, slug, description, website_url, primary_domain, logo_url, timezone, created_at, organization_id, organization:organizations!inner(id, name)",
    )
    .eq("id", workspaceId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw new DataAccessError("findWorkspace", error);
  if (!data) return null;

  const { data: membership, error: membershipError } = await client
    .from("memberships")
    .select("role")
    .eq("organization_id", data.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) throw new DataAccessError("findWorkspace.membership", membershipError);
  if (!membership) return null;

  const org = data.organization as unknown as NonNullable<OrgEmbed>;
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    organization: { id: org.id, name: org.name },
    description: data.description,
    websiteUrl: data.website_url,
    primaryDomain: data.primary_domain,
    logoUrl: data.logo_url,
    timezone: data.timezone ?? "UTC",
    createdAt: data.created_at,
    role: membership.role,
  };
}

/**
 * Loads one workspace the user can access, or renders 404.
 * Nonexistent and not-authorized workspaces are indistinguishable by design.
 */
export const getWorkspace = cache(async (workspaceId: string): Promise<WorkspaceDetail> => {
  return (await findWorkspace(workspaceId)) ?? notFound();
});

/** Organizations in which the user may create workspaces (owner/admin). */
export const listAdminOrganizations = cache(async (): Promise<AdminOrganization[]> => {
  const user = await requireUser();
  const { data, error } = await (await supabase())
    .from("memberships")
    .select("role, organization:organizations!inner(id, name)")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"]);

  if (error) throw new DataAccessError("listAdminOrganizations", error);

  return (data ?? [])
    .map((m) => {
      const org = m.organization as unknown as NonNullable<OrgEmbed>;
      return { id: org.id, name: org.name, role: m.role };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});

/**
 * Updates the editable business-profile fields. Only these five columns are
 * written (no spreading of caller input). RLS limits updates to owners/admins;
 * a refused update affects zero rows, which is reported as "forbidden".
 */
export async function updateWorkspaceProfile(
  workspaceId: string,
  profile: BusinessProfile,
): Promise<MutationResult<{ id: string }>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("workspaces")
    .update({
      name: profile.name,
      primary_domain: profile.primaryDomain,
      website_url: profile.websiteUrl,
      description: profile.description,
      timezone: profile.timezone,
    })
    .eq("id", workspaceId)
    .is("archived_at", null)
    .select("id");

  if (error) return { ok: false, reason: failureFromDbError("updateWorkspaceProfile", error) };
  if (!data?.length) return { ok: false, reason: "forbidden" };
  return { ok: true, data: { id: data[0].id } };
}
