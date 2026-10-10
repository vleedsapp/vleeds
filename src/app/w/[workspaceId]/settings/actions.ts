"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { businessProfileSchema } from "@/lib/config/business-profile";
import { icpSectionInputSchema, issuesToFieldErrors, type FieldErrors } from "@/lib/config/icp";
import {
  canConfigureWorkspace,
  findWorkspace,
  getCurrentUser,
  saveIcpSection as saveIcpSectionInDb,
  updateWorkspaceProfile,
  type MutationFailure,
  type WorkspaceDetail,
} from "@/lib/dal";
import { isUuid } from "@/lib/navigation";

/**
 * Settings mutations. Server Actions are public endpoints, so every action:
 *   1. authenticates (getUser via the DAL),
 *   2. re-authorizes the workspace and the caller's role,
 *   3. validates the whole input with the shared Zod schema,
 *   4. writes through the DAL under the user's session (RLS decides),
 *   5. returns safe, structured errors (never database messages),
 *   6. refreshes the current route so the Settings cards update in place.
 * Nothing here accepts a redirect target from the client.
 */

export type SettingsActionResult = { ok: true } | { ok: false; error: string; fieldErrors?: FieldErrors };

const NOT_AVAILABLE = "This workspace is not available.";
const NOT_ALLOWED = "Only owners and admins can change this workspace's settings.";

const FAILURE_MESSAGES: Record<MutationFailure, string> = {
  forbidden: NOT_ALLOWED,
  conflict: "Another change was saved at the same time. Close the editor, reopen it and try again.",
  stale: "Someone else changed this configuration after you opened it. Close the editor to load the latest version, then make your change again.",
  invalid: "Some values aren't allowed. Check them and try again.",
  failed: "Your changes couldn't be saved. Try again.",
};

async function authorizeConfiguration(
  workspaceId: unknown,
): Promise<{ ok: true; workspace: WorkspaceDetail } | { ok: false; error: string }> {
  if (typeof workspaceId !== "string" || !isUuid(workspaceId)) return { ok: false, error: NOT_AVAILABLE };
  if (!(await getCurrentUser())) redirect("/login");
  const workspace = await findWorkspace(workspaceId);
  if (!workspace) return { ok: false, error: NOT_AVAILABLE };
  if (!canConfigureWorkspace(workspace.role)) return { ok: false, error: NOT_ALLOWED };
  return { ok: true, workspace };
}

export async function updateBusinessProfile(workspaceId: string, input: unknown): Promise<SettingsActionResult> {
  const auth = await authorizeConfiguration(workspaceId);
  if (!auth.ok) return auth;

  const parsed = businessProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  }

  const result = await updateWorkspaceProfile(auth.workspace.id, parsed.data);
  if (!result.ok) return { ok: false, error: FAILURE_MESSAGES[result.reason] };

  refresh();
  return { ok: true };
}

export async function saveIcpSection(workspaceId: string, input: unknown): Promise<SettingsActionResult> {
  const auth = await authorizeConfiguration(workspaceId);
  if (!auth.ok) return auth;

  const parsed = icpSectionInputSchema.safeParse(input);
  if (!parsed.success) {
    // Editors key their fields by the path inside `value`.
    const fieldErrors = issuesToFieldErrors(
      parsed.error.issues.map((i) => ({ ...i, path: i.path[0] === "value" ? i.path.slice(1) : i.path })),
    );
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }

  const result = await saveIcpSectionInDb(auth.workspace.id, parsed.data);
  if (!result.ok) return { ok: false, error: FAILURE_MESSAGES[result.reason] };

  refresh();
  return { ok: true };
}
