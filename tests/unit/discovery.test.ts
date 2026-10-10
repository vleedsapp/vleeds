import { describe, expect, it } from "vitest";
import {
  candidateMatchState,
  cursorSchema,
  decisionActionSchema,
  decisionFor,
  discoverySearchSchema,
  PROVIDER_ERROR_MESSAGES,
  runIsOpen,
} from "@/lib/discovery/model";
import { createGooglePlacesProvider, textSearchBody } from "@/lib/providers/company-discovery/google-places/adapter";
import { buildTextSearchRequest, statusFromHttp, type FetchLike } from "@/lib/providers/company-discovery/google-places/client";
import {
  GOOGLE_MAX_PAGE_SIZE,
  GOOGLE_PLACES_FIELD_RETENTION,
  GOOGLE_TEXT_SEARCH_URL,
  googlePlacesDiscoveryFieldMask,
  googlePlacesDiscoveryFields,
} from "@/lib/providers/company-discovery/google-places/fields";
import { categoryLabel, mapPlace, mapTextSearchResponse } from "@/lib/providers/company-discovery/google-places/mapper";
import { clampPageSize, composeTextQuery, geographyText } from "@/lib/providers/company-discovery/query";
import { createDiscoveryProviders, DEFAULT_DISCOVERY_PROVIDER, reviewEndpointOverride } from "@/lib/providers/company-discovery/registry";
import { PROVIDER_STATUSES, type DiscoveryGeography } from "@/lib/providers/company-discovery/types";
import { EMPTY, INVALID_ERROR, MALFORMED, MALFORMED_NO_IDS, PAGE_ONE, PAGE_TWO, PERMISSION_ERROR, QUOTA_ERROR } from "../fixtures/google-places";

/** A scripted fake fetch: each call returns the next response; records requests. */
function fakeFetch(responses: ({ status: number; body: unknown } | "network" | "hang")[]) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const next = responses.shift() ?? { status: 500, body: {} };
    if (next === "network") throw new TypeError("fetch failed");
    if (next === "hang") {
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    return { status: next.status, json: async () => next.body };
  };
  return { fetch, calls };
}

const GEO: DiscoveryGeography = { countryCode: "CA", countryName: "Canada", region: "Ontario", city: "Sample City", label: null };
const provider = (responses: Parameters<typeof fakeFetch>[0], extra: { timeoutMs?: number; retries?: number } = {}) => {
  const f = fakeFetch(responses);
  return { p: createGooglePlacesProvider({ apiKey: "test-key-not-real", fetch: f.fetch, retries: 1, ...extra }), calls: f.calls };
};

// =============================================================================
describe("provider registry and capabilities", () => {
  it("registers Google Places as the default discovery provider", () => {
    const providers = createDiscoveryProviders({});
    expect(DEFAULT_DISCOVERY_PROVIDER).toBe("google_places");
    expect([...providers.keys()]).toEqual(["google_places"]);
    expect(providers.get("unknown")).toBeUndefined();
  });

  it("is unconfigured without a server-side API key (and makes no request)", async () => {
    const p = createDiscoveryProviders({}).get("google_places")!;
    expect(p.isConfigured()).toBe(false);
    expect(await p.searchCompanies({ query: "x", geography: null, pageSize: 5 })).toEqual({ ok: false, code: "not_configured", usage: null });
    expect(createDiscoveryProviders({ GOOGLE_PLACES_API_KEY: "  " }).get("google_places")!.isConfigured()).toBe(false);
    expect(createDiscoveryProviders({ GOOGLE_PLACES_API_KEY: "k-123" }).get("google_places")!.isConfigured()).toBe(true);
  });

  it("only accepts a loopback endpoint override, never on a production deployment", () => {
    expect(reviewEndpointOverride({ GOOGLE_PLACES_ENDPOINT: "http://127.0.0.1:54321/v1/places:searchText" })).toBe("http://127.0.0.1:54321/v1/places:searchText");
    expect(reviewEndpointOverride({ GOOGLE_PLACES_ENDPOINT: "https://attacker.example.test/collect" })).toBeUndefined();
    expect(reviewEndpointOverride({ GOOGLE_PLACES_ENDPOINT: "http://127.0.0.1:1/x", VERCEL_ENV: "production" })).toBeUndefined();
    expect(reviewEndpointOverride({ GOOGLE_PLACES_ENDPOINT: "not a url" })).toBeUndefined();
  });

  it("declares durable ids but transient company fields", () => {
    const caps = createDiscoveryProviders({}).get("google_places")!.getCapabilities();
    expect(caps).toMatchObject({ companyDiscovery: true, durableExternalId: true, durableCompanyFields: false, supportsPagination: true, supportsTextQuery: true, supportsGeographyText: true, maxPageSize: 20 });
    expect(GOOGLE_PLACES_FIELD_RETENTION).toEqual({ externalId: "durable", name: "transient", address: "transient", category: "transient" });
    expect(Object.entries(caps.fieldRetention).filter(([, r]) => r === "durable").map(([f]) => f)).toEqual(["externalId"]);
  });
});

// =============================================================================
describe("Google field mask and request", () => {
  it("requests a small, explicit field set (never a wildcard)", () => {
    expect(googlePlacesDiscoveryFieldMask).toBe("places.id,places.displayName,places.formattedAddress,places.primaryType,places.attributions,nextPageToken");
    expect(googlePlacesDiscoveryFieldMask).not.toContain("*");
    expect(googlePlacesDiscoveryFieldMask).not.toMatch(/\s/);
    for (const banned of ["rating", "review", "photo", "openingHours", "phone", "website", "price", "summary"]) {
      expect(googlePlacesDiscoveryFields.join(",").toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("builds a POST with JSON, the key header and the field mask header", () => {
    const r = buildTextSearchRequest("test-key-not-real", { textQuery: "q", pageSize: 5 });
    expect(r.method).toBe("POST");
    expect(r.headers).toEqual({ "Content-Type": "application/json", "X-Goog-Api-Key": "test-key-not-real", "X-Goog-FieldMask": googlePlacesDiscoveryFieldMask });
    expect(JSON.parse(r.body)).toEqual({ textQuery: "q", pageSize: 5 });
  });

  it("composes query + geography and maps cursor, page size and region", () => {
    expect(textSearchBody({ query: "  bookkeeping   services ", geography: GEO, pageSize: 50, cursor: "tok" })).toEqual({
      textQuery: "bookkeeping services in Sample City, Ontario, Canada",
      pageSize: GOOGLE_MAX_PAGE_SIZE,
      pageToken: "tok",
      regionCode: "CA",
    });
    expect(textSearchBody({ query: "bakeries", geography: null, pageSize: 0 })).toEqual({ textQuery: "bakeries", pageSize: 1 });
  });

  it("calls the documented endpoint with the key only in a header", async () => {
    const { p, calls } = provider([{ status: 200, body: PAGE_ONE }]);
    await p.searchCompanies({ query: "q", geography: null, pageSize: 5 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GOOGLE_TEXT_SEARCH_URL);
    expect(calls[0].url).not.toContain("test-key");
    expect(calls[0].headers["X-Goog-Api-Key"]).toBe("test-key-not-real");
  });
});

// =============================================================================
describe("query and geography composition", () => {
  it("uses only the parts that exist", () => {
    expect(composeTextQuery("printers", { ...GEO, city: null })).toBe("printers in Ontario, Canada");
    expect(composeTextQuery("printers", { ...GEO, city: null, region: null })).toBe("printers in Canada");
    expect(composeTextQuery("printers", null)).toBe("printers");
    expect(geographyText({ ...GEO, label: "Head office area" })).toBe("Head office area");
    expect(geographyText(GEO)).toBe("Sample City, Ontario, Canada");
  });

  it("clamps page size to the provider's limit", () => {
    expect(clampPageSize(10, 20)).toBe(10);
    expect(clampPageSize(99, 20)).toBe(20);
    expect(clampPageSize(-3, 20)).toBe(1);
    expect(clampPageSize(Number.NaN, 20)).toBe(10);
  });
});

// =============================================================================
describe("Google candidate mapping", () => {
  it("maps places to generic candidates with the Place ID as external id", () => {
    const page = mapTextSearchResponse(PAGE_ONE);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.nextCursor).toBe("fixture-next-page-token");
    expect(page.candidates.map((c) => c.externalId)).toEqual(["fixture-place-001", "fixture-place-002", "fixture-place-003"]);
    expect(page.candidates[0]).toMatchObject({
      providerKey: "google_places",
      display: { name: "Lakeside Bookkeeping", address: "1 Example Road, Sample City", category: "Accounting" },
      fieldRetention: GOOGLE_PLACES_FIELD_RETENTION,
    });
    expect(page.candidates[1].attributions).toEqual([{ provider: "Example Data Partner", uri: "https://partner.example.test" }]);
    expect(page.candidates[0].sourceUrl).toContain("query_place_id=fixture-place-001");
  });

  it("tolerates missing optional fields", () => {
    expect(mapPlace({ id: "only-id" })).toMatchObject({ externalId: "only-id", display: { name: null, address: null, category: null }, attributions: [] });
    expect(mapPlace({ displayName: { text: "no id" } })).toBeNull();
    expect(categoryLabel("tax_preparation_service")).toBe("Tax preparation service");
    expect(categoryLabel(undefined)).toBeNull();
  });

  it("handles empty, repeated, and malformed responses", () => {
    expect(mapTextSearchResponse(EMPTY)).toEqual({ ok: true, candidates: [], nextCursor: null });
    const two = mapTextSearchResponse(PAGE_TWO);
    expect(two.ok && two.candidates.map((c) => c.externalId)).toEqual(["fixture-place-004"]);
    expect(two.ok && two.nextCursor).toBeNull();
    expect(mapTextSearchResponse(MALFORMED)).toEqual({ ok: false });
    expect(mapTextSearchResponse(MALFORMED_NO_IDS)).toEqual({ ok: false });
    expect(mapTextSearchResponse("text")).toEqual({ ok: false });
  });
});

// =============================================================================
describe("search results, usage events and errors", () => {
  it("returns candidates, a cursor and a usage record (no key, no payload)", async () => {
    const { p } = provider([{ status: 200, body: PAGE_ONE }]);
    const r = await p.searchCompanies({ query: "q", geography: GEO, pageSize: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nextCursor).toBe("fixture-next-page-token");
    expect(r.usage).toEqual({
      operation: "text_search",
      requestedFields: [...googlePlacesDiscoveryFields],
      requestCount: 1,
      resultCount: 3,
      status: "ok",
      skuHint: "Text Search Pro",
      pricingReference: expect.stringMatching(/^https:\/\/developers\.google\.com\//),
    });
    expect(JSON.stringify(r.usage)).not.toContain("test-key");
    expect(JSON.stringify(r.usage)).not.toContain("Lakeside");
  });

  it("passes the cursor to the next page", async () => {
    const { p, calls } = provider([{ status: 200, body: PAGE_TWO }]);
    const r = await p.searchCompanies({ query: "q", geography: null, pageSize: 5, cursor: "fixture-next-page-token" });
    expect((calls[0].body as { pageToken: string }).pageToken).toBe("fixture-next-page-token");
    expect(r.ok && r.nextCursor).toBeNull();
  });

  it("reports no results as a successful, empty search", async () => {
    const { p } = provider([{ status: 200, body: EMPTY }]);
    const r = await p.searchCompanies({ query: "q", geography: null, pageSize: 5 });
    expect(r.ok && r.candidates).toEqual([]);
    expect(r.ok && r.usage.status).toBe("empty");
  });

  it("maps provider errors to generic categories without retrying non-transient ones", async () => {
    for (const [body, status, code] of [
      [QUOTA_ERROR, 429, "rate_limited"],
      [PERMISSION_ERROR, 403, "setup"],
      [INVALID_ERROR, 400, "invalid_request"],
    ] as const) {
      const { p, calls } = provider([{ status, body }]);
      const r = await p.searchCompanies({ query: "q", geography: null, pageSize: 5 });
      expect(r).toEqual({ ok: false, code, usage: expect.objectContaining({ status: code, requestCount: 1, resultCount: 0 }) });
      expect(calls).toHaveLength(1);
    }
    expect(statusFromHttp(200, "RESOURCE_EXHAUSTED")).toBe("rate_limited");
    expect(statusFromHttp(503)).toBe("unavailable");
    expect(statusFromHttp(504)).toBe("timeout");
  });

  it("retries a transient failure once (bounded) and counts both requests", async () => {
    const { p, calls } = provider([{ status: 503, body: {} }, { status: 200, body: PAGE_ONE }]);
    const r = await p.searchCompanies({ query: "q", geography: null, pageSize: 5 });
    expect(r.ok && r.usage.requestCount).toBe(2);
    expect(calls).toHaveLength(2);
    const down = provider(["network", "network", "network"]);
    const d = await down.p.searchCompanies({ query: "q", geography: null, pageSize: 5 });
    expect(d).toMatchObject({ ok: false, code: "unavailable", usage: { requestCount: 2 } });
    expect(down.calls).toHaveLength(2);
  });

  it("times out a hanging request", async () => {
    const { p } = provider(["hang"], { timeoutMs: 20, retries: 0 });
    expect(await p.searchCompanies({ query: "q", geography: null, pageSize: 5 })).toMatchObject({ ok: false, code: "timeout", usage: { status: "timeout" } });
  });

  it("treats an unreadable success body as malformed", async () => {
    const { p } = provider([{ status: 200, body: MALFORMED }]);
    expect(await p.searchCompanies({ query: "q", geography: null, pageSize: 5 })).toMatchObject({ ok: false, code: "malformed" });
  });

  it("has a calm message for every error category and no raw details", () => {
    for (const s of PROVIDER_STATUSES.filter((x) => x !== "ok" && x !== "empty")) expect(PROVIDER_ERROR_MESSAGES[s]).toBeTruthy();
    expect(PROVIDER_ERROR_MESSAGES.not_configured).toBe("Company discovery is not configured yet.");
  });
});

// =============================================================================
describe("discovery input, candidate status and decisions", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("validates the search request", () => {
    expect(discoverySearchSchema.safeParse({ icpProfileId: id, query: "  bike  repair ", geography: { kind: "icp", id }, pageSize: 10 }).data?.query).toBe("bike repair");
    expect(discoverySearchSchema.safeParse({ icpProfileId: null, query: "x", geography: { kind: "none" }, pageSize: 10 }).success).toBe(false);
    expect(discoverySearchSchema.safeParse({ icpProfileId: null, query: "xy", geography: { kind: "none" }, pageSize: 7 }).success).toBe(false);
    expect(discoverySearchSchema.safeParse({ icpProfileId: null, query: "xy", geography: { kind: "custom", countryCode: "zz", region: "", city: "" }, pageSize: 5 }).success).toBe(false);
    const custom = discoverySearchSchema.safeParse({ icpProfileId: null, query: "xy", geography: { kind: "custom", countryCode: "fr", region: " ", city: "Sample Town" }, pageSize: 20 });
    expect(custom.data?.geography).toEqual({ kind: "custom", countryCode: "FR", region: null, city: "Sample Town" });
    expect(discoverySearchSchema.safeParse({ icpProfileId: null, query: "xy", geography: { kind: "none" }, pageSize: 5, extra: 1 }).success).toBe(false);
  });

  it("accepts only bounded, printable cursors", () => {
    expect(cursorSchema.safeParse("fixture-next-page-token").success).toBe(true);
    expect(cursorSchema.safeParse("").success).toBe(false);
    expect(cursorSchema.safeParse("a b").success).toBe(false);
    expect(cursorSchema.safeParse("x".repeat(5000)).success).toBe(false);
  });

  it("derives Vleeds status from durable data only", () => {
    const linked = new Map([["p-1", "company-1"]]);
    const seen = new Set(["p-1", "p-2"]);
    expect(candidateMatchState("p-1", linked, seen)).toEqual({ matchState: "existing_company", matchCompanyId: "company-1" });
    expect(candidateMatchState("p-2", linked, seen)).toEqual({ matchState: "seen_before", matchCompanyId: null });
    expect(candidateMatchState("p-3", linked, seen)).toEqual({ matchState: "new", matchCompanyId: null });
  });

  it("selecting a new reference means it needs enrichment; an existing company is selected", () => {
    expect(decisionFor("select", null)).toBe("needs_enrichment");
    expect(decisionFor("select", "company-1")).toBe("selected");
    expect(decisionFor("dismiss", "company-1")).toBe("dismissed");
    expect(decisionFor("reset", null)).toBe("unreviewed");
    expect(decisionActionSchema.safeParse("create").success).toBe(false);
  });

  it("only open runs accept actions", () => {
    expect(["running", "review", "failed"].every((s) => runIsOpen(s as never))).toBe(true);
    expect(runIsOpen("completed")).toBe(false);
    expect(runIsOpen("cancelled")).toBe(false);
  });
});
