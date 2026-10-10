import "server-only";

import type { SuppressionInput } from "@/lib/lead-core/schemas";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";

export type ActiveSuppression = {
  id: string;
  companyId: string;
  contactId: string | null;
  scope: "company" | "contact";
  reason: string | null;
};

/**
 * Active do-not-contact records for the given companies. Every future contact
 * action (call, email, campaign) must consult this before acting.
 */
export async function activeSuppressions(workspaceId: string, companyIds: string[]): Promise<ActiveSuppression[]> {
  if (companyIds.length === 0) return [];
  const { data, error } = await (await supabase())
    .from("suppression_records")
    .select("id, company_id, contact_id, scope, reason")
    .eq("workspace_id", workspaceId)
    .in("company_id", companyIds)
    .eq("active", true);
  if (error) throw new DataAccessError("activeSuppressions", error);
  return (data ?? []).map((r) => ({
    id: r.id,
    companyId: r.company_id,
    contactId: r.contact_id,
    scope: r.scope === "contact" ? "contact" : "company",
    reason: r.reason,
  }));
}

/**
 * Adds a restriction (any workspace member). Restricting something that is
 * already restricted is not an error: the existing record stands.
 */
export async function addSuppression(workspaceId: string, input: SuppressionInput): Promise<MutationResult<null>> {
  await requireUser();
  const { error } = await (await supabase()).from("suppression_records").insert({
    workspace_id: workspaceId,
    company_id: input.companyId,
    contact_id: input.contactId,
    scope: input.scope,
    reason: input.reason,
  });
  if (error?.code === "23505") return { ok: true, data: null };
  if (error) return { ok: false, reason: failureFromDbError("addSuppression", error) };
  return { ok: true, data: null };
}

/** Lifts a restriction. RLS allows owners/admins only; for others zero rows change ("forbidden"). */
export async function liftSuppression(workspaceId: string, suppressionId: string): Promise<MutationResult<null>> {
  await requireUser();
  const { data, error } = await (await supabase())
    .from("suppression_records")
    .update({ active: false })
    .eq("workspace_id", workspaceId)
    .eq("id", suppressionId)
    .eq("active", true)
    .select("id");
  if (error) return { ok: false, reason: failureFromDbError("liftSuppression", error) };
  return data?.length ? { ok: true, data: null } : { ok: false, reason: "forbidden" };
}
