import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Data Access Layer — shared core.
 *
 * Every read and write of tenant data goes through src/lib/dal/*. They:
 *   1. verify the session with Supabase Auth (getUser, not getSession),
 *   2. query with the user-scoped client so RLS is the final authority,
 *   3. return narrow DTOs (no raw rows/sessions reach Client Components),
 *   4. deduplicate reads per request with React `cache`,
 *   5. return typed failure reasons from mutations (never raw DB messages).
 *
 * Authorization is never inferred from the URL or from client state: a
 * workspace id in the URL is only a lookup key that RLS must approve.
 */

export type CurrentUser = { id: string; email: string | null };

/** Thrown for unexpected database failures. Message is safe to log; never shown verbatim to users. */
export class DataAccessError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Data access failed: ${operation}`, { cause });
    this.name = "DataAccessError";
  }
}

/**
 * Why a mutation did not happen. Callers turn these into user-facing copy.
 *  - forbidden: RLS/privileges refused, or the row is not visible to the caller
 *  - conflict:  a uniqueness rule was hit (e.g. a second default profile)
 *  - stale:     the row changed since the caller read it (revision mismatch)
 *  - invalid:   a database constraint rejected the values
 *  - failed:    anything else (logged server-side)
 */
export type MutationFailure = "forbidden" | "conflict" | "stale" | "invalid" | "failed";

export type MutationResult<T> = { ok: true; data: T } | { ok: false; reason: MutationFailure };

export function failureFromDbError(operation: string, error: { code?: string } | null): MutationFailure {
  switch (error?.code) {
    case "42501":
      return "forbidden";
    case "23505":
      return "conflict";
    case "23514":
    case "23502":
    case "22P02":
      return "invalid";
    default:
      console.error(`${operation} failed`, error);
      return "failed";
  }
}

export const supabase = cache(createSupabaseServerClient);

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const { data, error } = await (await supabase()).auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
