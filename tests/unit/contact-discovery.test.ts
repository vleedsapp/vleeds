import { describe, expect, it } from "vitest";
import type { DecisionMaker } from "@/lib/config/icp";
import {
  buildTargetTitles,
  classifyCandidate,
  CONTACT_MESSAGES,
  decisionFor,
  defaultRoleIds,
  matchRole,
  orderCandidates,
  planContactCommit,
  relevanceLabels,
  startContactSearchSchema,
  titleContains,
  toNormalizedContact,
  vleedsSeniority,
  type StoredCandidate,
  type TargetTitle,
} from "@/lib/contact-discovery/model";
import type { GetFetchLike } from "@/lib/providers/company-enrichment/hunter/client";
import { createHunterContactProvider, domainSearchParams } from "@/lib/providers/contact-discovery/hunter/adapter";
import { mapDomainSearchResponse, mapPerson } from "@/lib/providers/contact-discovery/hunter/mapper";
import { estimateDomainSearchCredits } from "@/lib/providers/contact-discovery/hunter/usage";
import { createContactProviders, DEFAULT_CONTACT_PROVIDER } from "@/lib/providers/contact-discovery/registry";
import { SEARCH_EMPTY, SEARCH_OK } from "../fixtures/hunter-domain-search";

const KEY = "test-hunter-key-not-real";

function fakeFetch(responses: ({ status: number; body: unknown } | "network" | "hang")[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: GetFetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const next = responses.shift() ?? { status: 500, body: {} };
    if (next === "network") throw new TypeError("fetch failed");
    if (next === "hang") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    return { status: next.status, json: async () => next.body };
  };
  return { fetch, calls };
}
const hunter = (responses: Parameters<typeof fakeFetch>[0], extra: { timeoutMs?: number } = {}) => {
  const f = fakeFetch(responses);
  return { p: createHunterContactProvider({ apiKey: KEY, fetch: f.fetch, retries: 1, ...extra }), calls: f.calls };
};
const INPUT = { domain: "tidewell.example.test", titles: ["Head of Operations", "Operations Manager"], decisionMakerOnly: false, limit: 10 };

const roles: DecisionMaker[] = [
  { id: "00000000-0000-4000-8000-000000000001", title: "Office Manager", priority: "fallback", seniority: null },
  { id: "00000000-0000-4000-8000-000000000002", title: "Head of Operations", priority: "primary", seniority: "executive" },
  { id: "00000000-0000-4000-8000-000000000003", title: "Operations Manager", priority: "secondary", seniority: "manager" },
  { id: "00000000-0000-4000-8000-000000000004", title: "  head of   OPERATIONS ", priority: "secondary", seniority: null },
];

// =============================================================================
describe("contact-discovery provider registry", () => {
  it("registers Hunter Domain Search as the default contact provider", () => {
    expect(DEFAULT_CONTACT_PROVIDER).toBe("hunter");
    expect([...createContactProviders({}).keys()]).toEqual(["hunter"]);
  });

  it("is unconfigured without HUNTER_API_KEY and then makes no request", async () => {
    const p = createContactProviders({}).get("hunter")!;
    expect(p.isConfigured()).toBe(false);
    expect(await p.searchContacts(INPUT)).toEqual({ ok: false, code: "not_configured", usage: null });
    expect(createContactProviders({ HUNTER_API_KEY: "k" }).get("hunter")!.isConfigured()).toBe(true);
    expect(createContactProviders({ NEXT_PUBLIC_HUNTER_API_KEY: "k" }).get("hunter")!.isConfigured()).toBe(false);
  });

  it("declares its capabilities and a 1-credit search estimate", () => {
    const p = createContactProviders({}).get("hunter")!;
    expect(p.getCapabilities()).toEqual({
      contactDiscovery: true, titleFiltering: true, seniorityFiltering: true, departmentFiltering: true, decisionMakerFiltering: true,
      returnsProfessionalEmail: true, returnsPhoneSometimes: true, returnsLinkedInSometimes: true, usageCredits: true, maxResults: 10, maxTitles: 10,
    });
    expect(p.searchCreditEstimate()?.millis).toBe(1000);
  });
});

// =============================================================================
describe("Hunter Domain Search request", () => {
  it("sends domain, type=personal, job_titles, limit ≤ 10 and offset 0 with the X-API-KEY header", async () => {
    const { p, calls } = hunter([{ status: 200, body: SEARCH_OK }]);
    await p.searchContacts({ ...INPUT, limit: 50 });
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://api.hunter.io/v2/domain-search");
    expect(Object.fromEntries(u.searchParams)).toEqual({ domain: "tidewell.example.test", type: "personal", limit: "10", offset: "0", job_titles: "Head of Operations,Operations Manager" });
    expect(calls[0].url).not.toContain(KEY);
    expect(calls[0].headers["X-API-KEY"]).toBe(KEY);
  });

  it("decision_maker only when asked; titles capped at 10, commas stripped; filters only from the provider's lists", () => {
    expect(domainSearchParams(INPUT)).not.toHaveProperty("decision_maker");
    expect(domainSearchParams({ ...INPUT, decisionMakerOnly: true }).decision_maker).toBe("true");
    const many = Array.from({ length: 14 }, (_, i) => `Title ${i}`);
    expect(domainSearchParams({ ...INPUT, titles: ["Owner, Founder", ...many] }).job_titles!.split(",")).toHaveLength(10);
    expect(domainSearchParams({ ...INPUT, titles: ["Owner, Founder"] }).job_titles).toBe("Owner Founder");
    expect(domainSearchParams({ ...INPUT, seniority: ["executive", "boss"], department: ["operations", "x"] })).toMatchObject({ seniority: "executive", department: "operations" });
    expect(domainSearchParams({ ...INPUT, titles: [], decisionMakerOnly: true })).not.toHaveProperty("job_titles");
  });

  it("refuses a search with no titles and no decision-maker filter (no request)", async () => {
    const { p, calls } = hunter([]);
    expect(await p.searchContacts({ ...INPUT, titles: [] })).toEqual({ ok: false, code: "invalid_request", usage: null });
    expect(calls).toHaveLength(0);
  });

  it("makes exactly one request per search: no pagination, no automatic fallback search", async () => {
    const { p, calls } = hunter([{ status: 200, body: SEARCH_EMPTY }, { status: 200, body: SEARCH_OK }]);
    const r = await p.searchContacts(INPUT);
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ ok: true, candidates: [], usage: { status: "empty", estimatedCreditMillis: 0 } });
  });
});

// =============================================================================
describe("Domain Search mapping", () => {
  it("maps professional people only; skips nameless, duplicate and generic results", () => {
    const m = mapDomainSearchResponse(SEARCH_OK, 10);
    expect(m.ok && m.returned).toBe(7);
    expect(m.ok && m.skipped).toBe(3);
    expect(m.ok && m.candidates.map((c) => c.normalizedEmail)).toEqual([
      "ada.quill@tidewell.example.test", "ben.ross@tidewell.example.test", "cy.dale@tidewell.example.test", "dee.ash@tidewell.example.test",
    ]);
  });

  it("maps name, title, email, phone, profile, seniority, department, decision maker, verification, confidence, sources", () => {
    expect(mapPerson(SEARCH_OK.data.emails[0])).toEqual({
      providerKey: "hunter",
      externalId: null,
      fullName: "Ada Quill",
      firstName: "Ada",
      lastName: "Quill",
      jobTitle: "Head of Operations",
      email: "Ada.Quill@Tidewell.example.test",
      normalizedEmail: "ada.quill@tidewell.example.test",
      phone: "+44 20 7946 0111",
      linkedinUrl: "https://profiles.example.test/ada-quill",
      providerSeniority: "executive",
      providerDepartment: "operations",
      providerDecisionMaker: true,
      verificationStatus: "valid",
      confidence: 94,
      sourceCount: 2,
      lastSeenOn: "2026-09-20",
    });
  });

  it("never invents: out-of-range confidence, unknown statuses and non-URL profiles become empty", () => {
    const m = mapDomainSearchResponse(SEARCH_OK, 10);
    if (!m.ok) throw new Error("expected ok");
    const cy = m.candidates.find((c) => c.fullName === "Cy Dale")!;
    const dee = m.candidates.find((c) => c.fullName === "Dee Ash")!;
    expect([cy.confidence, cy.verificationStatus]).toEqual([null, "unknown"]);
    expect([dee.linkedinUrl, dee.verificationStatus, dee.providerSeniority]).toEqual([null, null, "junior"]);
    expect(m.candidates.find((c) => c.fullName === "Ben Ross")!.verificationStatus).toBe("accept_all");
  });

  it("keeps no raw payload: no twitter, source URLs, organization or pattern", () => {
    const json = JSON.stringify(mapDomainSearchResponse(SEARCH_OK, 10));
    for (const banned of ["fictional_handle", "pages.example.test", "Tidewell Fictional", "{first}", "info@"]) expect(json, banned).not.toContain(banned);
  });

  it("an unreadable body is malformed with an unknown credit charge", async () => {
    const { p } = hunter([{ status: 200, body: { nope: 1 } }]);
    expect(await p.searchContacts(INPUT)).toMatchObject({ ok: false, code: "malformed", usage: { estimatedCreditMillis: null } });
  });
});

// =============================================================================
describe("credits, usage and provider errors", () => {
  it("1–10 returned emails → 1 credit; none → 0; unreadable → unknown", async () => {
    expect(estimateDomainSearchCredits("ok", 1)).toBe(1000);
    expect(estimateDomainSearchCredits("ok", 10)).toBe(1000);
    expect(estimateDomainSearchCredits("empty", 0)).toBe(0);
    expect(estimateDomainSearchCredits("quota_exhausted", 0)).toBe(0);
    expect(estimateDomainSearchCredits("malformed", 0)).toBeNull();
    const { p } = hunter([{ status: 200, body: SEARCH_OK }]);
    expect(await p.searchContacts(INPUT)).toMatchObject({ ok: true, skipped: 3, usage: { operation: "domain_search", requestCount: 1, resultCount: 4, status: "ok", estimatedCreditMillis: 1000 } });
  });

  it("maps errors to calm categories and never retries quota/rate/invalid/setup/451", async () => {
    for (const [status, code] of [[429, "quota_exhausted"], [403, "rate_limited"], [400, "invalid_request"], [401, "setup"], [451, "restricted"]] as const) {
      const { p, calls } = hunter([{ status, body: { errors: [{ details: "echo" }] } }, { status: 200, body: SEARCH_OK }]);
      const r = await p.searchContacts(INPUT);
      expect(calls, String(status)).toHaveLength(1);
      expect(r).toMatchObject({ ok: false, code, usage: { estimatedCreditMillis: 0 } });
      expect(JSON.stringify(r)).not.toContain("echo");
    }
  });

  it("bounded transport retry for transient failures (counted), timeout via AbortController", async () => {
    const { p, calls } = hunter([{ status: 503, body: {} }, { status: 200, body: SEARCH_OK }]);
    expect(await p.searchContacts(INPUT)).toMatchObject({ ok: true, usage: { requestCount: 2 } });
    expect(calls).toHaveLength(2);
    const { p: p2, calls: c2 } = hunter(["network", "network", { status: 200, body: SEARCH_OK }]);
    expect(await p2.searchContacts(INPUT)).toMatchObject({ ok: false, code: "unavailable", usage: { requestCount: 2 } });
    expect(c2).toHaveLength(2);
    const { p: p3 } = hunter(["hang", "hang"], { timeoutMs: 20 });
    expect(await p3.searchContacts(INPUT)).toMatchObject({ ok: false, code: "timeout" });
  });

  it("the API key never appears in results or usage", async () => {
    const { p } = hunter([{ status: 200, body: SEARCH_OK }, { status: 429, body: {} }]);
    expect(JSON.stringify([await p.searchContacts(INPUT), await p.searchContacts(INPUT)])).not.toContain(KEY);
  });

  it("has a fixed message for every user-facing case", () => {
    for (const code of ["not_configured", "no_domain", "restricted_company", "no_titles", "quota_exhausted", "rate_limited", "timeout", "unavailable", "malformed", "invalid_request", "restricted"]) {
      expect(CONTACT_MESSAGES[code], code).toBeTruthy();
    }
    expect(CONTACT_MESSAGES.no_domain).toBe("Add or enrich this company with a domain before finding contacts.");
    expect(CONTACT_MESSAGES.restricted_company).toBe("This company is marked do not contact.");
  });
});

// =============================================================================
describe("ICP role targeting", () => {
  it("orders primary → secondary → fallback, de-duplicates and caps at 10", () => {
    const { titles, ids } = buildTargetTitles(roles, null, []);
    expect(titles).toEqual([
      { title: "Head of Operations", priority: "primary" },
      { title: "Operations Manager", priority: "secondary" },
      { title: "Office Manager", priority: "fallback" },
    ]);
    expect(ids).toEqual([roles[1].id, roles[2].id, roles[0].id]);
    const many = Array.from({ length: 13 }, (_, i): DecisionMaker => ({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, title: `Role ${i}`, priority: i % 2 ? "secondary" : "primary", seniority: null }));
    expect(buildTargetTitles(many, null, []).titles).toHaveLength(10);
    expect(defaultRoleIds(many)).toHaveLength(10);
    expect(buildTargetTitles(many, null, []).titles.slice(0, 7).every((t) => t.priority === "primary")).toBe(true);
  });

  it("uses only the roles chosen for this search, plus typed titles (search only; never the ICP)", () => {
    expect(buildTargetTitles(roles, [roles[0].id], ["Workshop Lead", "office manager"]).titles).toEqual([
      { title: "Office Manager", priority: "fallback" },
      { title: "Workshop Lead", priority: "search" },
    ]);
    expect(startContactSearchSchema.safeParse({ companyId: roles[0].id, icpProfileId: null, roleIds: [], manualTitles: Array(11).fill("x"), decisionMakerOnly: false }).success).toBe(false);
    expect(startContactSearchSchema.safeParse({ companyId: "nope", icpProfileId: null, roleIds: [], manualTitles: [], decisionMakerOnly: true }).success).toBe(false);
  });

  const targets: TargetTitle[] = [
    { title: "Head of Operations", priority: "primary" },
    { title: "Operations Manager", priority: "secondary" },
    { title: "Manager", priority: "fallback" },
  ];

  it("matches whole words, case-insensitively, at the highest priority", () => {
    expect(titleContains("Senior Operations Manager", "operations manager")).toBe(true);
    expect(titleContains("Operations Managerial Lead", "operations manager")).toBe(false);
    expect(matchRole("HEAD  of operations", targets, false)).toBe("primary");
    expect(matchRole("Senior Operations Manager", targets, false)).toBe("secondary"); // also contains "Manager" (fallback): highest wins
    expect(matchRole("Store Manager", targets, false)).toBe("fallback");
    expect(matchRole("Chief Executive Officer", targets, true)).toBe("decision_maker");
    expect(matchRole("Analyst", targets, false)).toBe("other");
    expect(matchRole(null, targets, null)).toBe("other");
    expect(matchRole("Workshop Lead", [{ title: "Workshop Lead", priority: "search" }], false)).toBe("search_title");
  });

  it("labels relevance transparently (no combined score)", () => {
    expect(relevanceLabels({ roleMatch: "primary", providerDecisionMaker: true, providerSeniority: "executive" }, "Hunter")).toEqual(["Primary title match", "Hunter decision maker", "Executive seniority"]);
    expect(relevanceLabels({ roleMatch: "decision_maker", providerDecisionMaker: true, providerSeniority: "senior" }, "Hunter")).toEqual(["No configured-title match", "Hunter decision maker"]);
  });

  it("orders primary, secondary, fallback, decision makers, others; provider order within a group", () => {
    const list = [
      { id: "a", roleMatch: "other" as const, position: 0 },
      { id: "b", roleMatch: "decision_maker" as const, position: 1 },
      { id: "c", roleMatch: "secondary" as const, position: 2 },
      { id: "d", roleMatch: "primary" as const, position: 3 },
      { id: "e", roleMatch: "secondary" as const, position: 4 },
      { id: "f", roleMatch: "fallback" as const, position: 5 },
    ];
    expect(orderCandidates(list).map((x) => x.id)).toEqual(["d", "c", "e", "f", "b", "a"]);
  });
});

// =============================================================================
describe("contact matching (P1-E1/P1-E2 rules) and decisions", () => {
  const CO = "co-1";
  const here = [
    { id: "k1", company_id: CO, full_name: "Ada Quill", normalized_email: "ada.quill@tidewell.example.test" },
    { id: "k2", company_id: CO, full_name: "Ben Ross", normalized_email: null },
  ];
  const elsewhere = [{ id: "k9", company_id: "co-2", full_name: "Cy Dale", normalized_email: "cy.dale@tidewell.example.test" }];
  const cand = (fullName: string, email: string) => ({ fullName, email, normalizedEmail: email.toLowerCase() });

  it("email at this company → existing; email at another company → conflict; same name → possible duplicate; else new", () => {
    expect(classifyCandidate(cand("Ada Q.", "Ada.Quill@tidewell.example.test"), CO, here, here)).toEqual({ matchState: "existing_contact", matchedContactId: "k1" });
    expect(classifyCandidate(cand("Cy Dale", "cy.dale@tidewell.example.test"), CO, here, elsewhere)).toEqual({ matchState: "conflict", matchedContactId: "k9" });
    expect(classifyCandidate(cand("ben ross", "b.ross@tidewell.example.test"), CO, here, [])).toEqual({ matchState: "possible_duplicate", matchedContactId: "k2" });
    expect(classifyCandidate(cand("Dee Ash", "dee.ash@tidewell.example.test"), CO, here, [])).toEqual({ matchState: "new", matchedContactId: null });
  });

  it("phone never identifies a contact", () => {
    expect(classifyCandidate({ ...cand("Eve North", "eve@tidewell.example.test") }, CO, [{ id: "k3", company_id: CO, full_name: "Someone Else", normalized_email: null }], [])).toMatchObject({ matchState: "new" });
  });

  it("decisions: conflicts can't be selected; possible duplicates need an explicit merge-or-new choice", () => {
    expect(decisionFor("new", "select")).toEqual({ decision: "selected", selectedAction: "create" });
    expect(decisionFor("existing_contact", "select")).toEqual({ decision: "selected", selectedAction: "merge" });
    expect(decisionFor("existing_contact", "select_new")).toBeNull();
    expect(decisionFor("possible_duplicate", "select")).toBeNull();
    expect(decisionFor("possible_duplicate", "select_merge")).toEqual({ decision: "selected", selectedAction: "merge" });
    expect(decisionFor("possible_duplicate", "select_new")).toEqual({ decision: "selected", selectedAction: "create" });
    expect(decisionFor("conflict", "select")).toBeNull();
    expect(decisionFor("conflict", "dismiss")).toEqual({ decision: "dismissed", selectedAction: null });
    expect(decisionFor("new", "reset")).toEqual({ decision: "unreviewed", selectedAction: null });
  });
});

// =============================================================================
describe("contact commit planning", () => {
  const stored: StoredCandidate = {
    fullName: "Ada Quill", firstName: "Ada", lastName: "Quill", jobTitle: "Head of Operations", email: "Ada.Quill@Tidewell.example.test",
    phone: "+44 20 7946 0111", linkedinUrl: "https://profiles.example.test/ada-quill", providerSeniority: "executive",
    providerDepartment: "operations", providerDecisionMaker: true, verificationStatus: "valid",
  };
  const provider = { providerKey: "hunter", label: "Hunter" };

  it("normalizes through the lead-core contact schema; only a safe seniority mapping", () => {
    expect(toNormalizedContact(stored)).toMatchObject({ fullName: "Ada Quill", normalizedEmail: "ada.quill@tidewell.example.test", phoneNormalized: "+442079460111", seniority: "executive" });
    expect(toNormalizedContact({ ...stored, providerSeniority: "senior" })?.seniority).toBeNull();
    expect(toNormalizedContact({ ...stored, phone: "!!" })?.phone).toBeNull();
    expect([vleedsSeniority("executive"), vleedsSeniority("senior"), vleedsSeniority("junior"), vleedsSeniority(null)]).toEqual(["executive", null, null, null]);
  });

  it("create: contact columns + evidence per non-empty field with the provider key and context fields", () => {
    const plan = planContactCommit(toNormalizedContact(stored)!, stored, "create", null, provider, true)!;
    expect(plan.contact).toMatchObject({ fields: { full_name: "Ada Quill", job_title: "Head of Operations", normalized_email: "ada.quill@tidewell.example.test", linkedin_url: "https://profiles.example.test/ada-quill" }, primary_if_none: true });
    expect(plan.contact.id).toBeUndefined();
    expect(plan.evidence.map((e) => e.field_key)).toEqual([
      "contact.name", "contact.title", "contact.seniority", "contact.email", "contact.phone", "contact.linkedin", "contact.department", "contact.verification_status", "contact.provider_decision_maker",
    ]);
    expect(plan.evidence.every((e) => e.subject === "contact" && e.source_kind === "api" && e.provider_key === "hunter" && !e.external_record_id)).toBe(true);
    // the provider's own seniority is evidence even when it has no safe Vleeds mapping
    const senior = { ...stored, providerSeniority: "senior", providerDepartment: null, providerDecisionMaker: null, verificationStatus: null, phone: null, linkedinUrl: null };
    expect(planContactCommit(toNormalizedContact(senior)!, senior, "create", null, provider, false)!.evidence.map((e) => [e.field_key, e.observed_value])).toEqual([
      ["contact.name", "Ada Quill"], ["contact.title", "Head of Operations"], ["contact.email", "Ada.Quill@Tidewell.example.test"], ["contact.seniority", "senior"],
    ]);
  });

  it("merge: fills empty fields, keeps populated ones and reports conflicts (never renames)", () => {
    const existing = {
      id: "k1", full_name: "Ada Q", first_name: null, last_name: null, job_title: "COO", seniority: null, email: "ada.quill@tidewell.example.test",
      normalized_email: "ada.quill@tidewell.example.test", phone: null, phone_normalized: null, linkedin_url: null, notes: null,
    };
    const plan = planContactMerge(existing);
    expect(plan.contact.id).toBe("k1");
    expect(plan.contact.fields).toEqual({ first_name: "Ada", last_name: "Quill", seniority: "executive", phone: "+44 20 7946 0111", phone_normalized: "+442079460111", linkedin_url: "https://profiles.example.test/ada-quill" });
    expect(plan.notes).toEqual(["Kept contact name “Ada Q” (Hunter had “Ada Quill”).", "Kept existing job title “COO” (Hunter had “Head of Operations”)."]);
    expect(planContactCommit(toNormalizedContact(stored)!, stored, "merge", null, provider, false)).toBeNull();

    function planContactMerge(e: typeof existing) {
      return planContactCommit(toNormalizedContact(stored)!, stored, "merge", e, provider, false)!;
    }
  });
});
