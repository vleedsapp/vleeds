import type { EnrichmentStatus } from "../types";

/**
 * Minimal HTTP client for Hunter API v2 (GET only). Server-only by
 * construction: only the adapter imports it, and the adapter is reached only
 * through the server-only registry. The API key travels in the X-API-KEY
 * header, never in the URL, and is never logged, returned or stored.
 */

export type GetFetchLike = (url: string, init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export type HunterClientOptions = {
  apiKey: string;
  /** Base URL including /v2 (Hunter's, or a loopback mock in review). */
  baseUrl: string;
  fetch: GetFetchLike;
  timeoutMs: number;
  /** Extra attempts for transient failures only (network error, timeout, 5xx). Small and bounded. */
  retries: number;
};

/** A failure category; "not_found" is a normal outcome (the provider has no data), not an error. */
export type HunterFailure = Exclude<EnrichmentStatus, "ok" | "empty"> | "not_found";

export type HunterResponse = { ok: true; body: unknown; requestCount: number } | { ok: false; status: HunterFailure; requestCount: number };

/** Exactly the request Vleeds sends (exported for tests). Parameters go in the query string; the key does not. */
export function buildHunterRequest(opts: Pick<HunterClientOptions, "apiKey" | "baseUrl">, path: string, params: Record<string, string>) {
  const url = new URL(opts.baseUrl.replace(/\/+$/, "") + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return {
    url: url.toString(),
    init: { method: "GET" as const, headers: { Accept: "application/json", "X-API-KEY": opts.apiKey } },
  };
}

/**
 * HTTP status → category (Hunter API v2 documentation):
 *   400/422 invalid request · 401 bad/missing key · 403 rate limit reached ·
 *   429 usage (plan quota) limit reached · 404 no data · 451 the data may not
 *   be processed (legal restriction) · 5xx provider error.
 */
export function statusFromHttp(httpStatus: number): HunterFailure {
  if (httpStatus === 404) return "not_found";
  if (httpStatus === 400 || httpStatus === 422) return "invalid_request";
  if (httpStatus === 401) return "setup";
  if (httpStatus === 403) return "rate_limited";
  if (httpStatus === 429) return "quota_exhausted";
  if (httpStatus === 451) return "restricted";
  if (httpStatus === 408 || httpStatus === 504) return "timeout";
  return "unavailable";
}

/** Only these are retried (once, by default). Quota, invalid input, setup, not-found and 451 never are. */
const transient = (s: HunterFailure) => s === "unavailable" || s === "timeout";

export async function hunterGet(opts: HunterClientOptions, path: string, params: Record<string, string>): Promise<HunterResponse> {
  const { url, init } = buildHunterRequest(opts, path, params);
  let requestCount = 0;
  let last: HunterFailure = "unavailable";

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    requestCount++;
    try {
      const res = await opts.fetch(url, { ...init, signal: controller.signal });
      if (res.status >= 200 && res.status < 300) {
        try {
          return { ok: true, body: await res.json(), requestCount };
        } catch {
          return { ok: false, status: "malformed", requestCount };
        }
      }
      // The error body is never read into Vleeds (it can echo inputs); the status code is enough.
      last = statusFromHttp(res.status);
    } catch (e) {
      last = (e as { name?: string })?.name === "AbortError" ? "timeout" : "unavailable";
    } finally {
      clearTimeout(timer);
    }
    if (!transient(last)) break;
  }
  return { ok: false, status: last, requestCount };
}
