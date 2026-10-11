/**
 * Vleeds-facing database types, derived from the generated schema.
 *
 * src/lib/supabase/database.types.ts is GENERATED (`npm run db:types`) and
 * must never be edited by hand. Application aliases and the few places where
 * PostgreSQL semantics are richer than what `supabase gen types` can express
 * live here instead, always derived from `Database` so a regeneration keeps
 * them in sync (a renamed or removed column/function fails typecheck here).
 *
 * Known typegen limitation: PostgreSQL has no way to declare the nullability
 * of a SQL function's arguments or of its RETURNS TABLE columns, so the
 * generator reports every argument and result column as non-null. Arguments
 * declared `DEFAULT NULL` come through as optional, and callers simply omit
 * them (PostgREST then applies the NULL default). Result columns that can be
 * NULL are widened back below; see `src/lib/supabase/trusted-score-writer.ts`
 * for the one RPC whose required arguments accept NULL.
 */
import type { Database } from "./database.types";

type PublicSchema = Database["public"];
type Functions = PublicSchema["Functions"];

/** Widens the listed keys of `T` to also accept `null` (other keys unchanged). */
export type WithNullable<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

/** One row of a set-returning SQL function, as generated. */
type RpcRow<F extends keyof Functions> = Functions[F]["Returns"] extends readonly (infer R)[] ? R : never;

export type MembershipRole = PublicSchema["Enums"]["membership_role"];

/** public.list_companies: company columns and the LEFT JOINed score may be NULL. */
export type ListCompaniesRow = WithNullable<RpcRow<"list_companies">, "primary_domain" | "location" | "grade" | "score" | "coverage_percent">;

/** public.today_ready_candidates: location/coverage are nullable columns; last_attempt is a scalar subquery. */
export type TodayReadyCandidateRow = WithNullable<RpcRow<"today_ready_candidates">, "location" | "coverage_percent" | "last_attempt">;

/** public.today_due_tasks: note, job title and phone are nullable columns. */
export type TodayDueTaskRow = WithNullable<RpcRow<"today_due_tasks">, "note" | "job_title" | "phone">;
