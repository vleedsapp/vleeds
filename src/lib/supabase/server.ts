import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Per-request Supabase client acting AS THE SIGNED-IN USER.
 *
 * Uses the publishable key + the user's session cookie, so every query is
 * subject to Row Level Security. This is the database client for everything
 * the application does, with ONE exception: score persistence goes through the
 * narrow server-only trusted writer (trusted-score-writer.ts, P1-E7).
 */
export async function createSupabaseServerClient() {
  // Session data is per-request: never let it run inside a (partial) prerender.
  // Without this, supabase-js's session bootstrap reads the clock during
  // Cache Components' App Shell prerender, which Next.js rejects.
  await connection();

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = publicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session on every request, so this is safe.
        }
      },
    },
  });
}
