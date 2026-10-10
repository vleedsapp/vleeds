import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { workspacePath } from "@/lib/navigation";

/**
 * Where a signed-in user lands: their last-used workspace if they can still
 * access it, otherwise their first workspace, otherwise onboarding.
 * `hintedWorkspaceId` comes from a cookie and is only trusted if RLS returns it.
 */
export async function resolveHomePath(
  client: SupabaseClient<Database>,
  hintedWorkspaceId: string | undefined,
): Promise<string> {
  const { data, error } = await client.from("workspaces").select("id").is("archived_at", null).order("name");
  if (error) throw new Error("resolveHomePath: could not load workspaces", { cause: error });

  const target = data.find((w) => w.id === hintedWorkspaceId) ?? data[0];
  return target ? workspacePath(target.id) : "/workspaces/new";
}
