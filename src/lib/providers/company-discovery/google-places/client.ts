import type { ProviderStatus } from "../types";
import { googlePlacesDiscoveryFieldMask } from "./fields";

/**
 * Minimal HTTP client for Places API (New) Text Search. Server-only by
 * construction (only the adapter imports it, and the adapter is reached only
 * through the server-only registry). The API key is sent in a header, never
 * in a URL, and is never logged or returned.
 */

export type TextSearchBody = {
  textQuery: string;
  pageSize: number;
  pageToken?: string;
  languageCode?: string;
  regionCode?: string;
};

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export type ClientOptions = {
  apiKey: string;
  endpoint: string;
  fetch: FetchLike;
  timeoutMs: number;
  /** Extra attempts for transient failures (network error, timeout, 5xx). Bounded and small. */
  retries: number;
};

export type ClientResult = { ok: true; body: unknown; requestCount: number } | { ok: false; status: Exclude<ProviderStatus, "ok" | "empty">; requestCount: number };

/** Exactly the request Vleeds sends (exported for tests). */
export function buildTextSearchRequest(apiKey: string, body: TextSearchBody) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": googlePlacesDiscoveryFieldMask,
    },
    body: JSON.stringify(body),
  };
}

/** HTTP status (+ Google error status when present) → generic category. */
export function statusFromHttp(httpStatus: number, googleStatus?: string): Exclude<ProviderStatus, "ok" | "empty"> {
  if (httpStatus === 429 || googleStatus === "RESOURCE_EXHAUSTED") return "rate_limited";
  if (httpStatus === 401 || httpStatus === 403 || googleStatus === "PERMISSION_DENIED" || googleStatus === "UNAUTHENTICATED") return "setup";
  if (httpStatus === 400 || googleStatus === "INVALID_ARGUMENT" || googleStatus === "FAILED_PRECONDITION") return "invalid_request";
  if (httpStatus === 504 || googleStatus === "DEADLINE_EXCEEDED") return "timeout";
  return "unavailable";
}

const transient = (s: string) => s === "unavailable" || s === "timeout";

export async function textSearch(opts: ClientOptions, body: TextSearchBody): Promise<ClientResult> {
  const request = buildTextSearchRequest(opts.apiKey, body);
  let requestCount = 0;
  let last: Exclude<ProviderStatus, "ok" | "empty"> = "unavailable";

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    requestCount++;
    try {
      const res = await opts.fetch(opts.endpoint, { ...request, signal: controller.signal });
      if (res.status >= 200 && res.status < 300) {
        try {
          return { ok: true, body: await res.json(), requestCount };
        } catch {
          return { ok: false, status: "malformed", requestCount };
        }
      }
      let googleStatus: string | undefined;
      try {
        const err = (await res.json()) as { error?: { status?: unknown } };
        googleStatus = typeof err?.error?.status === "string" ? err.error.status : undefined;
      } catch {
        /* error body is optional and never shown */
      }
      last = statusFromHttp(res.status, googleStatus);
    } catch (e) {
      last = (e as { name?: string })?.name === "AbortError" ? "timeout" : "unavailable";
    } finally {
      clearTimeout(timer);
    }
    if (!transient(last)) break;
  }
  return { ok: false, status: last, requestCount };
}
