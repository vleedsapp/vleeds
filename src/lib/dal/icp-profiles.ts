import "server-only";

import { cache } from "react";
import type { z } from "zod";
import {
  buyingSignalsSchema,
  decisionMakersSchema,
  DEFAULT_PROFILE_NAME,
  exclusionSignalsSchema,
  geographiesSchema,
  ICP_SCHEMA_VERSION,
  idealCustomerSchema,
  scoringModelSchema,
  type IcpProfileConfig,
  type ParsedIcpSectionInput,
} from "@/lib/config/icp";
import { isUuid } from "@/lib/navigation";
import type { Database, Json } from "@/lib/supabase/database.types";
import { DataAccessError, failureFromDbError, requireUser, supabase, type MutationResult } from "./core";

type IcpRow = Database["public"]["Tables"]["icp_profiles"]["Row"];
/** Columns a section save may write. Never is_default, archived_at or tenant/audit keys. */
type IcpUpdate = Omit<Database["public"]["Tables"]["icp_profiles"]["Update"], "is_default" | "archived_at">;

const COLUMNS =
  "id, name, description, revision, schema_version, ideal_customer, target_geographies, decision_maker_titles, buying_signals, exclusion_signals, scoring_model";

/**
 * Parses one stored jsonb section. Unknown/invalid stored data is treated as
 * "not saved" (and logged) rather than trusted or shown half-parsed.
 */
function parseSection<S extends z.ZodType>(schema: S, value: Json | null, label: string, profileId: string): z.output<S> | null {
  if (value === null) return null;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.error(`icp_profiles ${profileId}: stored ${label} does not match schema v${ICP_SCHEMA_VERSION}`);
    return null;
  }
  return parsed.data;
}

function toConfig(row: Pick<IcpRow, "id" | "name" | "description" | "revision" | "schema_version" | "ideal_customer" | "target_geographies" | "decision_maker_titles" | "buying_signals" | "exclusion_signals" | "scoring_model">): IcpProfileConfig {
  if (row.schema_version !== ICP_SCHEMA_VERSION) {
    console.error(`icp_profiles ${row.id}: unsupported schema_version ${row.schema_version}`);
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    revision: row.revision,
    idealCustomer: parseSection(idealCustomerSchema, row.ideal_customer, "ideal_customer", row.id),
    geographies: parseSection(geographiesSchema, row.target_geographies, "target_geographies", row.id),
    decisionMakers: parseSection(decisionMakersSchema, row.decision_maker_titles, "decision_maker_titles", row.id),
    buyingSignals: parseSection(buyingSignalsSchema, row.buying_signals, "buying_signals", row.id),
    exclusionSignals: parseSection(exclusionSignalsSchema, row.exclusion_signals, "exclusion_signals", row.id),
    scoringModel: parseSection(scoringModelSchema, row.scoring_model, "scoring_model", row.id),
  };
}

/**
 * The workspace's active default ICP profile, or null if none exists yet.
 * Callers must have authorized the workspace (getWorkspace); RLS still
 * filters the query, so a foreign workspace id simply yields null.
 */
export const getDefaultIcpProfile = cache(async (workspaceId: string): Promise<IcpProfileConfig | null> => {
  if (!isUuid(workspaceId)) return null;
  await requireUser();
  const { data, error } = await (await supabase())
    .from("icp_profiles")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw new DataAccessError("getDefaultIcpProfile", error);
  return data ? toConfig(data) : null;
});

/** Maps one validated section to the only columns it may write (no mass assignment). */
function sectionColumns(input: ParsedIcpSectionInput): IcpUpdate {
  switch (input.section) {
    case "ideal_customer":
      return {
        name: input.value.name,
        description: input.value.description,
        ideal_customer: input.value.idealCustomer as Json,
      };
    case "geographies":
      return { target_geographies: input.value as Json };
    case "decision_makers":
      return { decision_maker_titles: input.value as Json };
    case "buying_signals":
      return { buying_signals: input.value as Json };
    case "exclusion_signals":
      return { exclusion_signals: input.value as Json };
    case "scoring":
      return { scoring_model: input.value as Json };
  }
}

/**
 * Saves one configuration section of a workspace's default profile.
 *
 * - No profile yet (profileId null): creates the workspace's default profile
 *   containing just this section. The partial unique index guarantees a
 *   concurrent second "first save" fails with a conflict instead of creating
 *   two defaults.
 * - Otherwise: updates only if the profile is still at `revision` (optimistic
 *   concurrency); the database then increments revision.
 */
export async function saveIcpSection(
  workspaceId: string,
  input: ParsedIcpSectionInput,
): Promise<MutationResult<{ id: string; revision: number }>> {
  await requireUser();
  const client = await supabase();
  const columns = sectionColumns(input);

  if (input.profileId === null) {
    const { data, error } = await client
      .from("icp_profiles")
      .insert({
        workspace_id: workspaceId,
        name: columns.name ?? DEFAULT_PROFILE_NAME,
        is_default: true,
        schema_version: ICP_SCHEMA_VERSION,
        ...columns,
      })
      .select("id, revision");
    if (error) return { ok: false, reason: failureFromDbError("createIcpProfile", error) };
    if (!data?.length) return { ok: false, reason: "forbidden" };
    return { ok: true, data: data[0] };
  }

  if (input.revision === null) return { ok: false, reason: "invalid" };

  const { data, error } = await client
    .from("icp_profiles")
    .update({ ...columns, schema_version: ICP_SCHEMA_VERSION })
    .eq("id", input.profileId)
    .eq("workspace_id", workspaceId)
    .eq("revision", input.revision)
    .is("archived_at", null)
    .select("id, revision");

  if (error) return { ok: false, reason: failureFromDbError("updateIcpProfile", error) };
  if (data?.length) return { ok: true, data: data[0] };

  // Nothing updated: either the profile moved on (stale) or it isn't writable/visible.
  const { data: current } = await client
    .from("icp_profiles")
    .select("revision")
    .eq("id", input.profileId)
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .maybeSingle();
  return { ok: false, reason: current && current.revision !== input.revision ? "stale" : "forbidden" };
}
