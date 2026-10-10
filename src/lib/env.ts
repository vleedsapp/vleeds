import { z } from "zod";

/**
 * Public (browser-safe) configuration.
 *
 * Only `NEXT_PUBLIC_*` values may appear here; Next.js inlines them into the
 * client bundle. The Supabase publishable/anon key is designed to be public —
 * all authorization is enforced by Row Level Security in Postgres.
 *
 * Secret values (service-role key, provider API keys) must NEVER be added to
 * this module. The only service-role code path is the trusted score writer
 * (src/lib/supabase/trusted-score-writer.ts, P1-E7), which reads its key itself.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20)
    .refine((v) => !looksLikeSecretKey(v), {
      message: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be the publishable/anon key, not a secret/service-role key",
    }),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** Detects Supabase secret keys (new `sb_secret_` format or legacy service_role JWTs). */
export function looksLikeSecretKey(value: string): boolean {
  if (value.startsWith("sb_secret_")) return true;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

let cached: PublicEnv | undefined;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid Vleeds configuration. Check .env.local (see .env.example):\n${issues}`);
  }
  return result.data;
}

export function publicEnv(): PublicEnv {
  // Each NEXT_PUBLIC_ variable must be referenced literally so Next.js can inline it.
  cached ??= parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return cached;
}
