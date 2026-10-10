/**
 * DEVELOPMENT / UI-REVIEW ONLY endpoint overrides for provider adapters.
 *
 * Returns `raw` only if it is a loopback http(s) URL and the app is not a
 * Vercel production deployment; anything else (remote hosts, garbage, any
 * production deployment) is ignored. This is deliberately not a general
 * "outbound URL" setting.
 */
export function loopbackEndpointOverride(raw: string | undefined, env: Record<string, string | undefined>): string | undefined {
  if (!raw || env.VERCEL_ENV === "production") return undefined;
  try {
    const u = new URL(raw);
    const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
    return loopback && (u.protocol === "http:" || u.protocol === "https:") ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
