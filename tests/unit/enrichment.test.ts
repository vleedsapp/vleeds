import { describe, expect, it } from "vitest";
import {
  allowedEnrichmentDecisions,
  domainInputSchema,
  enrichmentMessage,
  ENRICHMENT_MESSAGES,
  formatCredits,
  inputKindFor,
  startEnrichmentSchema,
  storableName,
  suggestedDecision,
} from "@/lib/enrichment/model";
import { classifyEnrichment, planEnrichmentCommit, reviewFields, toNormalizedCompany } from "@/lib/enrichment/plan";
import { evidenceFor } from "@/lib/imports/ingest";
import type { ExistingCompany } from "@/lib/imports/merge";
import type { KnownCompany } from "@/lib/lead-core/dedupe";
import { createHunterProvider } from "@/lib/providers/company-enrichment/hunter/adapter";
import { buildHunterRequest, statusFromHttp, type GetFetchLike } from "@/lib/providers/company-enrichment/hunter/client";
import { mapCompany, mapDomainFinderResponse, mapLocation, parseEmployees } from "@/lib/providers/company-enrichment/hunter/mapper";
import { estimateCreditMillis, HUNTER_API_BASE } from "@/lib/providers/company-enrichment/hunter/usage";
import { createEnrichmentProviders, DEFAULT_ENRICHMENT_PROVIDER } from "@/lib/providers/company-enrichment/registry";
import { COMPANY_MINIMAL, COMPANY_OK, DOMAIN_FINDER_EMPTY, DOMAIN_FINDER_OK } from "../fixtures/hunter";

const KEY = "test-hunter-key-not-real";

/** Scripted fake GET fetch: each call returns the next response; records requests. */
function fakeFetch(responses: ({ status: number; body: unknown } | "network" | "hang" | "badjson")[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: GetFetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const next = responses.shift() ?? { status: 500, body: {} };
    if (next === "network") throw new TypeError("fetch failed");
    if (next === "hang") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    if (next === "badjson") return { status: 200, json: async () => { throw new SyntaxError("bad"); } };
    return { status: next.status, json: async () => next.body };
  };
  return { fetch, calls };
}
const hunter = (responses: Parameters<typeof fakeFetch>[0], extra: { timeoutMs?: number; retries?: number } = {}) => {
  const f = fakeFetch(responses);
  return { p: createHunterProvider({ apiKey: KEY, fetch: f.fetch, retries: 1, ...extra }), calls: f.calls };
};

// =============================================================================
describe("enrichment provider registry", () => {
  it("registers Hunter as the default enrichment provider", () => {
    const providers = createEnrichmentProviders({});
    expect(DEFAULT_ENRICHMENT_PROVIDER).toBe("hunter");
    expect([...providers.keys()]).toEqual(["hunter"]);
    expect(providers.get("unknown")).toBeUndefined();
  });

  it("is unconfigured without HUNTER_API_KEY and then makes no request", async () => {
    const p = createEnrichmentProviders({}).get("hunter")!;
    expect(p.isConfigured()).toBe(false);
    expect(await p.resolveDomain({ companyName: "Quillstone" })).toEqual({ ok: false, code: "not_configured", usage: null });
    expect(await p.enrichCompany({ domain: "quillstone.example.test" })).toEqual({ ok: false, code: "not_configured", usage: null });
    expect(createEnrichmentProviders({ HUNTER_API_KEY: "   " }).get("hunter")!.isConfigured()).toBe(false);
    expect(createEnrichmentProviders({ HUNTER_API_KEY: "k" }).get("hunter")!.isConfigured()).toBe(true);
    expect(createEnrichmentProviders({ NEXT_PUBLIC_HUNTER_API_KEY: "k" }).get("hunter")!.isConfigured()).toBe(false);
  });

  it("declares durable company fields, durable ids, domain resolution and credits", () => {
    const p = createEnrichmentProviders({}).get("hunter")!;
    expect(p.getCapabilities()).toEqual({ companyEnrichment: true, domainResolution: true, durableCompanyFields: true, durableExternalId: true, usageCredits: true });
    expect(p.enrichmentCreditEstimate()?.millis).toBe(200);
  });

  it("only accepts a loopback endpoint override, never in production", async () => {
    const seen: string[] = [];
    const fetch: GetFetchLike = async (url) => {
      seen.push(url);
      return { status: 200, json: async () => DOMAIN_FINDER_EMPTY };
    };
    const { createHunterProvider: make } = await import("@/lib/providers/company-enrichment/hunter/adapter");
    const { loopbackEndpointOverride } = await import("@/lib/providers/endpoint-override");
    expect(loopbackEndpointOverride("http://127.0.0.1:54321/hunter/v2", {})).toBe("http://127.0.0.1:54321/hunter/v2");
    expect(loopbackEndpointOverride("https://collector.example.test/v2", {})).toBeUndefined();
    expect(loopbackEndpointOverride("http://127.0.0.1:54321/hunter/v2", { VERCEL_ENV: "production" })).toBeUndefined();
    expect(loopbackEndpointOverride("garbage", {})).toBeUndefined();
    await make({ apiKey: KEY, fetch, baseUrl: loopbackEndpointOverride("http://127.0.0.1:54321/hunter/v2", {}) }).resolveDomain({ companyName: "Quillstone" });
    expect(seen[0].startsWith("http://127.0.0.1:54321/hunter/v2/domain-finder?")).toBe(true);
  });
});

// =============================================================================
describe("Hunter client", () => {
  it("authenticates with the X-API-KEY header, never in the query string", () => {
    const r = buildHunterRequest({ apiKey: KEY, baseUrl: HUNTER_API_BASE }, "/companies/find", { domain: "quillstone.example.test" });
    expect(r.url).toBe("https://api.hunter.io/v2/companies/find?domain=quillstone.example.test");
    expect(r.url).not.toContain(KEY);
    expect(r.url).not.toContain("api_key");
    expect(r.init).toEqual({ method: "GET", headers: { Accept: "application/json", "X-API-KEY": KEY } });
  });

  it("maps HTTP statuses to calm categories", () => {
    expect(statusFromHttp(400)).toBe("invalid_request");
    expect(statusFromHttp(422)).toBe("invalid_request");
    expect(statusFromHttp(401)).toBe("setup");
    expect(statusFromHttp(403)).toBe("rate_limited");
    expect(statusFromHttp(429)).toBe("quota_exhausted");
    expect(statusFromHttp(404)).toBe("not_found");
    expect(statusFromHttp(451)).toBe("restricted");
    expect(statusFromHttp(503)).toBe("unavailable");
    expect(statusFromHttp(504)).toBe("timeout");
  });

  it("never retries quota, rate limit, invalid, setup, not-found or 451 responses", async () => {
    for (const status of [429, 403, 400, 401, 404, 451]) {
      const { p, calls } = hunter([{ status, body: { errors: [{ details: "echo of input" }] } }, { status: 200, body: COMPANY_OK }]);
      const r = await p.enrichCompany({ domain: "quillstone.example.test" });
      expect(calls, String(status)).toHaveLength(1);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain("echo of input");
    }
  });

  it("retries a transient failure once (bounded) and counts both requests", async () => {
    const { p, calls } = hunter([{ status: 503, body: {} }, { status: 200, body: COMPANY_OK }]);
    const r = await p.enrichCompany({ domain: "quillstone.example.test" });
    expect(calls).toHaveLength(2);
    expect(r.ok && r.usage.requestCount).toBe(2);
    const { p: p2, calls: c2 } = hunter(["network", "network", { status: 200, body: COMPANY_OK }]);
    const r2 = await p2.enrichCompany({ domain: "quillstone.example.test" });
    expect(c2).toHaveLength(2);
    expect(r2).toMatchObject({ ok: false, code: "unavailable", usage: { requestCount: 2, estimatedCreditMillis: 0 } });
  });

  it("times out with AbortController", async () => {
    const { p } = hunter(["hang", "hang"], { timeoutMs: 20 });
    expect(await p.enrichCompany({ domain: "quillstone.example.test" })).toMatchObject({ ok: false, code: "timeout" });
  });

  it("an unreadable success body is malformed with an unknown credit charge", async () => {
    const { p } = hunter(["badjson"]);
    expect(await p.enrichCompany({ domain: "quillstone.example.test" })).toMatchObject({ ok: false, code: "malformed", usage: { estimatedCreditMillis: null } });
    const { p: p2 } = hunter([{ status: 200, body: { nope: true } }]);
    expect(await p2.enrichCompany({ domain: "quillstone.example.test" })).toMatchObject({ ok: false, code: "malformed" });
  });

  it("the API key never appears in results or usage objects", async () => {
    const { p } = hunter([{ status: 200, body: DOMAIN_FINDER_OK }, { status: 200, body: COMPANY_OK }, { status: 429, body: {} }]);
    const all = [await p.resolveDomain({ companyName: "Quillstone Ledger" }), await p.enrichCompany({ domain: "quillstone.example.test" }), await p.enrichCompany({ domain: "x.example.test" })];
    expect(JSON.stringify(all)).not.toContain(KEY);
  });
});

// =============================================================================
describe("Domain Finder (Beta)", () => {
  it("sends company + limit (≤5) to /domain-finder", async () => {
    const { p, calls } = hunter([{ status: 200, body: DOMAIN_FINDER_OK }]);
    await p.resolveDomain({ companyName: "  Quillstone   Ledger ", limit: 50 });
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://api.hunter.io/v2/domain-finder");
    expect(Object.fromEntries(u.searchParams)).toEqual({ company: "Quillstone Ledger", limit: "5" });
    expect(calls[0].headers["X-API-KEY"]).toBe(KEY);
  });

  it("maps the Beta response to generic, normalized, de-duplicated suggestions", async () => {
    const { p } = hunter([{ status: 200, body: DOMAIN_FINDER_OK }]);
    const r = await p.resolveDomain({ companyName: "Quillstone Ledger" });
    expect(r.ok && r.suggestions).toEqual([
      { domain: "quillstone.example.test", companyName: "Quillstone Ledger", confidenceLabel: "Exact name match", emailCount: 12 },
      { domain: "quillstone-group.example.test", companyName: "Quillstone Group", confidenceLabel: null, emailCount: 3 },
    ]);
    expect(JSON.stringify(r)).not.toContain("logo");
    expect(r.ok && r.usage).toMatchObject({ operation: "domain_finder", requestCount: 1, resultCount: 2, status: "ok", estimatedCreditMillis: 0 });
  });

  it("respects the limit and handles an empty or 404 answer as 'no suggestions'", async () => {
    expect(mapDomainFinderResponse(DOMAIN_FINDER_OK, "x", 1)).toMatchObject({ ok: true, suggestions: [{ domain: "quillstone.example.test" }] });
    const { p } = hunter([{ status: 200, body: DOMAIN_FINDER_EMPTY }, { status: 404, body: {} }]);
    expect(await p.resolveDomain({ companyName: "Nobody Here" })).toMatchObject({ ok: false, code: "no_suggestions", usage: { status: "empty" } });
    expect(await p.resolveDomain({ companyName: "Nobody Here" })).toMatchObject({ ok: false, code: "no_suggestions" });
  });

  it("refuses names shorter than 3 characters without a request", async () => {
    const { p, calls } = hunter([]);
    expect(await p.resolveDomain({ companyName: " ab " })).toEqual({ ok: false, code: "invalid_request", usage: null });
    expect(calls).toHaveLength(0);
  });
});

// =============================================================================
describe("Company Enrichment mapping", () => {
  it("calls /companies/find?domain= and maps only durable company fields", async () => {
    const { p, calls } = hunter([{ status: 200, body: COMPANY_OK }]);
    const r = await p.enrichCompany({ domain: "quillstone.example.test" });
    expect(new URL(calls[0].url).pathname).toBe("/v2/companies/find");
    expect(new URL(calls[0].url).searchParams.get("domain")).toBe("quillstone.example.test");
    expect(r.ok && r.company).toEqual({
      providerKey: "hunter",
      externalId: "hc-000123",
      name: "Quillstone Ledger",
      domain: "quillstone.example.test",
      websiteUrl: "https://quillstone.example.test",
      phone: "+44 20 7946 0999",
      location: { countryCode: "GB", region: "Sample County", city: "Sample Town", postalCode: "ZZ1 1ZZ", addressLine1: "1 Fictional Way" },
      employeeCountMin: 11,
      employeeCountMax: 50,
      industry: "Bookkeeping Services",
      description: "Quillstone Ledger provides bookkeeping and payroll services for small firms.",
      tags: ["Bookkeeping", "Payroll", "Small business"],
    });
    expect(r.ok && r.usage).toMatchObject({ operation: "company_enrichment", resultCount: 1, status: "ok", estimatedCreditMillis: 200 });
  });

  it("ignores emails, social handles, funding, traffic, technology, logos and coordinates", () => {
    const json = JSON.stringify(mapCompany(COMPANY_OK.data));
    for (const banned of ["owner@", "jo.private", "quillstone-fb", "followers", "250000", "trafficRank", "example-cms", "logos.example.test", "51", "Payroll Services", "Industrials", "8721", "foundedYear", "estimatedAnnualRevenue"]) {
      expect(json, banned).not.toContain(banned);
    }
  });

  it("a 404 means 'not found': not an application failure and not charged", async () => {
    const { p } = hunter([{ status: 404, body: {} }]);
    expect(await p.enrichCompany({ domain: "unknown.example.test" })).toMatchObject({ ok: false, code: "not_found", usage: { status: "empty", estimatedCreditMillis: 0 } });
  });

  it("falls back to the requested domain and leaves missing values empty", () => {
    expect(mapCompany(COMPANY_MINIMAL.data)).toMatchObject({ name: null, domain: "bare.example.test", phone: null, location: null, employeeCountMin: null, industry: null, description: null, tags: [] });
    expect(mapCompany({ name: "No Domain" }, "fallback.example.test")?.domain).toBe("fallback.example.test");
    expect(mapCompany({ name: "No Domain" })).toBeNull();
  });

  it("parses employee counts conservatively", () => {
    expect(parseEmployees("11-50")).toEqual({ min: 11, max: 50 });
    expect(parseEmployees("1,001–5,000")).toEqual({ min: 1001, max: 5000 });
    expect(parseEmployees("10001+")).toEqual({ min: 10001, max: null });
    expect(parseEmployees(42)).toEqual({ min: 42, max: 42 });
    expect(parseEmployees("11-50", 37)).toEqual({ min: 37, max: 37 });
    expect(parseEmployees("10K+")).toEqual({ min: null, max: null });
    expect(parseEmployees("50-11")).toEqual({ min: null, max: null });
    expect(parseEmployees("about 20")).toEqual({ min: null, max: null });
    expect(parseEmployees(null)).toEqual({ min: null, max: null });
  });

  it("maps location without assuming a country", () => {
    expect(mapLocation({ city: "Puerto Montt", state: "Los Lagos", countryCode: "cl" })).toEqual({ countryCode: "CL", region: "Los Lagos", city: "Puerto Montt", postalCode: null, addressLine1: null });
    expect(mapLocation({ countryCode: "XX", city: "Nowhere" })).toMatchObject({ countryCode: null, city: "Nowhere" });
    expect(mapLocation({ streetNumber: "5", streetName: "Sample Road" })).toMatchObject({ addressLine1: "5 Sample Road" });
    expect(mapLocation({})).toBeNull();
  });

  it("uses category.industry only (no taxonomy concatenation)", () => {
    expect(mapCompany({ domain: "a.example.test", category: { industry: "Printing", sector: "Industrials" } })?.industry).toBe("Printing");
    expect(mapCompany({ domain: "a.example.test", category: { sector: "Industrials" } })?.industry).toBeNull();
  });

  it("clips long descriptions to the column limit", () => {
    const d = mapCompany({ domain: "a.example.test", description: "word ".repeat(1000) })!.description!;
    expect(d.length).toBeLessThanOrEqual(2000);
  });
});

// =============================================================================
describe("credit estimates", () => {
  it("domain finder free, enrichment 200 millis only when data came back, unknown when unreadable", () => {
    expect(estimateCreditMillis("domain_finder", "ok")).toBe(0);
    expect(estimateCreditMillis("company_enrichment", "ok")).toBe(200);
    expect(estimateCreditMillis("company_enrichment", "empty")).toBe(0);
    expect(estimateCreditMillis("company_enrichment", "quota_exhausted")).toBe(0);
    expect(estimateCreditMillis("company_enrichment", "malformed")).toBeNull();
    expect(formatCredits(200)).toBe("0.2");
    expect(formatCredits(1400)).toBe("1.4");
    expect(formatCredits(0)).toBe("0");
  });
});

// =============================================================================
describe("enrichment input and the discovery handoff", () => {
  const RUN = "11111111-1111-4111-8111-111111111111";
  const CAND = "22222222-2222-4222-8222-222222222222";

  it("a discovery reference may carry a transient name for the lookup, which is never storable", () => {
    const input = startEnrichmentSchema.parse({ source: "discovery", discoveryRunId: RUN, candidateId: CAND, lookup: { by: "name", companyName: " Transient  Place Name " } });
    expect(input.lookup).toEqual({ by: "name", companyName: "Transient Place Name" });
    expect(inputKindFor(input)).toBe("discovery_reference");
    expect(storableName(input)).toBeNull();
  });

  it("manual names are Vleeds data and may be stored; domains go straight to enrichment", () => {
    const named = startEnrichmentSchema.parse({ source: "manual", lookup: { by: "name", companyName: "Quillstone Ledger" } });
    expect([inputKindFor(named), storableName(named)]).toEqual(["manual_name", "Quillstone Ledger"]);
    const domain = startEnrichmentSchema.parse({ source: "manual", lookup: { by: "domain", domain: "https://www.Quillstone.example.test/about" } });
    expect([inputKindFor(domain), domain.lookup]).toEqual(["domain", { by: "domain", domain: "quillstone.example.test" }]);
    const existing = startEnrichmentSchema.parse({ source: "existing", companyId: CAND, lookup: { by: "domain", domain: "quillstone.example.test" } });
    expect(inputKindFor(existing)).toBe("existing_company");
  });

  it("validates names, domains and ids", () => {
    expect(startEnrichmentSchema.safeParse({ source: "manual", lookup: { by: "name", companyName: "ab" } }).success).toBe(false);
    expect(domainInputSchema.safeParse("not a domain").success).toBe(false);
    expect(domainInputSchema.safeParse("127.0.0.1").success).toBe(false);
    expect(startEnrichmentSchema.safeParse({ source: "discovery", discoveryRunId: "x", candidateId: CAND, lookup: { by: "domain", domain: "a.example.test" } }).success).toBe(false);
    expect(startEnrichmentSchema.safeParse({ source: "manual", lookup: { by: "domain", domain: "a.example.test" }, extra: 1 }).success).toBe(false);
  });

  it("every error code has a calm fixed message", () => {
    for (const code of ["not_configured", "no_suggestions", "not_found", "quota_exhausted", "rate_limited", "timeout", "unavailable", "malformed", "restricted", "setup", "invalid_request"]) {
      expect(ENRICHMENT_MESSAGES[code], code).toBeTruthy();
    }
    expect(enrichmentMessage("not_found", "Hunter")).toBe("Hunter couldn't find company data for this domain.");
    expect(enrichmentMessage("weird", "X")).toBe("Something went wrong. Try again.");
  });
});

// =============================================================================
describe("normalization, matching and merge planning (P1-E2 pipeline reuse)", () => {
  const enriched = mapCompany(COMPANY_OK.data)!;
  const company = toNormalizedCompany(enriched)!;

  it("normalizes through the lead-core schema", () => {
    expect(company).toMatchObject({
      canonicalName: "Quillstone Ledger",
      normalizedName: "quillstone ledger",
      primaryDomain: "quillstone.example.test",
      primaryPhoneNormalized: "+442079460999",
      industry: "Bookkeeping Services",
      qualificationState: null,
    });
    // unusable phone is dropped, not fatal; missing name falls back to the domain
    expect(toNormalizedCompany({ ...enriched, phone: "!!" })).toMatchObject({ primaryPhone: null });
    expect(toNormalizedCompany({ ...enriched, name: null })?.canonicalName).toBe("quillstone.example.test");
  });

  const known = (o: Partial<KnownCompany> & { id: string }): KnownCompany => ({ primaryDomain: null, primaryPhoneNormalized: null, normalizedName: "other", location: null, externalIds: [], ...o });
  const hunterId = { providerKey: "hunter", externalRecordId: "hc-000123" };
  const placeId = { providerKey: "google_places", externalRecordId: "place-1" };

  it("classifies with the lead-core hierarchy", () => {
    expect(classifyEnrichment(company, [hunterId], [known({ id: "a", externalIds: [hunterId] })], null)).toEqual({ matchState: "existing_company", matchReason: "external_id", matchedCompanyId: "a" });
    expect(classifyEnrichment(company, [hunterId, placeId], [known({ id: "b", externalIds: [placeId] })], null)).toMatchObject({ matchState: "existing_company", matchedCompanyId: "b" });
    expect(classifyEnrichment(company, [], [known({ id: "c", primaryDomain: "quillstone.example.test" })], null)).toEqual({ matchState: "existing_company", matchReason: "domain", matchedCompanyId: "c" });
    expect(classifyEnrichment(company, [], [known({ id: "d", primaryPhoneNormalized: "+442079460999" })], null)).toEqual({ matchState: "possible_duplicate", matchReason: "phone", matchedCompanyId: "d" });
    expect(classifyEnrichment(company, [], [known({ id: "e", normalizedName: "quillstone ledger", location: { countryCode: "GB", city: "Sample Town" } })], null)).toMatchObject({ matchState: "possible_duplicate", matchReason: "name_location" });
    expect(classifyEnrichment(company, [], [known({ id: "f", normalizedName: "quillstone ledger" })], null)).toEqual({ matchState: "new", matchReason: null, matchedCompanyId: null });
    expect(classifyEnrichment(company, [], [], "target-id")).toEqual({ matchState: "existing_company", matchReason: null, matchedCompanyId: "target-id" });
  });

  it("decisions: create is never offered for a strong identity", () => {
    expect(allowedEnrichmentDecisions("new")).toEqual(["create", "skip"]);
    expect(allowedEnrichmentDecisions("existing_company")).toEqual(["merge", "skip"]);
    expect(allowedEnrichmentDecisions("possible_duplicate")).toEqual(["merge", "skip", "create"]);
    expect([suggestedDecision("new"), suggestedDecision("existing_company"), suggestedDecision("possible_duplicate")]).toEqual(["create", "merge", null]);
  });

  const existing: ExistingCompany & { id: string } = {
    id: "co-1",
    canonical_name: "Quillstone",
    normalized_name: "quillstone",
    website_url: null,
    primary_domain: null,
    primary_phone: null,
    primary_phone_normalized: null,
    location: { countryCode: "GB", region: null, city: "Elsewhere", postalCode: null, addressLine1: null, addressLine2: null },
    employee_count_min: null,
    employee_count_max: null,
    qualification_state: "qualified",
    notes: "Keep me",
    industry: null,
    description: "Our own description.",
  };
  const provider = { providerKey: "hunter", label: "Hunter", externalRecordId: "hc-000123" };

  it("merge fills empty fields, keeps populated ones and reports conflicts (never renames)", () => {
    const plan = planEnrichmentCommit(company, "existing_company", "merge", provider, enriched.tags, { target: existing, domainOwnedElsewhere: null });
    expect(plan.kind).toBe("ingest");
    if (plan.kind !== "ingest") return;
    expect(plan.call.company.id).toBe("co-1");
    expect(plan.call.company.fields).toEqual({
      website_url: "https://quillstone.example.test",
      primary_domain: "quillstone.example.test",
      primary_phone: "+44 20 7946 0999",
      primary_phone_normalized: "+442079460999",
      employee_count_min: 11,
      employee_count_max: 50,
      industry: "Bookkeeping Services",
    });
    expect(plan.notes).toEqual([
      "Kept company name “Quillstone” (Hunter had “Quillstone Ledger”).",
      "Kept the existing location (Hunter had a different one).",
      "Kept existing description “Our own description.” (Hunter had “Quillstone Ledger provides bookkeeping and payroll services for small firms.”).",
    ]);
  });

  it("evidence: one row per non-empty field with provider key + record id; tags as evidence only", () => {
    const plan = planEnrichmentCommit(company, "new", "create", provider, enriched.tags, { target: null, domainOwnedElsewhere: null });
    if (plan.kind !== "ingest") throw new Error("expected ingest");
    expect(plan.call.company.id).toBeUndefined();
    expect(plan.call.company.fields).toMatchObject({ canonical_name: "Quillstone Ledger", industry: "Bookkeeping Services", qualification_state: "unreviewed" });
    expect(plan.call.company.fields).not.toHaveProperty("tags");
    expect(plan.call.evidence.map((e) => e.field_key)).toEqual([
      "company.name", "company.website", "company.domain", "company.phone", "company.location", "company.employee_range", "company.industry", "company.description", "company.tags",
    ]);
    expect(plan.call.evidence.every((e) => e.source_kind === "api" && e.provider_key === "hunter" && e.external_record_id === "hc-000123")).toBe(true);
    expect(plan.call.evidence.find((e) => e.field_key === "company.tags")?.observed_value).toBe("Bookkeeping, Payroll, Small business");
    // no empty-value evidence
    const bare = toNormalizedCompany(mapCompany(COMPANY_MINIMAL.data)!)!;
    expect(evidenceFor(bare, null, "api", { providerKey: "hunter", externalRecordId: null }).map((e) => e.field_key)).toEqual(["company.name", "company.website", "company.domain"]);
  });

  it("skip writes nothing; a domain used by another company is never moved onto a second one", () => {
    expect(planEnrichmentCommit(company, "new", "skip", provider, [], { target: null, domainOwnedElsewhere: null }).kind).toBe("skip");
    const plan = planEnrichmentCommit(company, "existing_company", "merge", provider, [], { target: existing, domainOwnedElsewhere: { id: "co-2", name: "Other Co" } });
    if (plan.kind !== "ingest") throw new Error("expected ingest");
    expect(plan.call.company.fields).not.toHaveProperty("primary_domain");
    expect(plan.call.company.fields).not.toHaveProperty("website_url");
    expect(plan.notes.at(-1)).toBe("Domain not added: Other Co already uses quillstone.example.test.");
    expect(planEnrichmentCommit(company, "existing_company", "merge", provider, [], { target: null, domainOwnedElsewhere: null }).kind).toBe("fail");
  });

  it("review preview agrees with the merge planner", () => {
    const fields = Object.fromEntries(reviewFields(company, existing).map((f) => [f.key, f.outcome]));
    expect(fields).toEqual({ name: "keep", domain: "fill", industry: "fill", location: "keep", phone: "fill", employees: "fill", description: "keep" });
    expect(reviewFields(company, null).every((f) => f.outcome === "new")).toBe(true);
    const same = reviewFields(company, { ...existing, canonical_name: "Quillstone Ledger", industry: "bookkeeping services" });
    expect(same.find((f) => f.key === "industry")?.outcome).toBe("same");
  });
});
