import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { businessProfileSchema } from "@/lib/config/business-profile";
import { countryName, isCountryCode } from "@/lib/config/countries";
import {
  buyingSignalsSchema,
  decisionMakersSchema,
  EMPTY_IDEAL_CUSTOMER,
  exclusionSignalsSchema,
  geographiesSchema,
  geographyLabel,
  gradeBands,
  icpSectionInputSchema,
  idealCustomerSectionSchema,
  issuesToFieldErrors,
  scoringModelSchema,
  SUGGESTED_SCORING_MODEL,
  type IcpProfileConfig,
} from "@/lib/config/icp";
import { allSectionStatuses, sectionStatus } from "@/lib/config/icp-status";

const id = () => randomUUID();
const errors = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  r.success ? {} : issuesToFieldErrors(r.error!.issues);

// -----------------------------------------------------------------------------
describe("ideal customer section", () => {
  const valid = {
    name: "  Mid-size   prospects ",
    description: "",
    idealCustomer: { ...EMPTY_IDEAL_CUSTOMER, industries: ["Category One"], companySize: { minEmployees: 10, maxEmployees: 200 } },
  };

  it("normalizes text and turns empty optional text into null", () => {
    const r = idealCustomerSectionSchema.parse(valid);
    expect(r.name).toBe("Mid-size prospects");
    expect(r.description).toBeNull();
    expect(r.idealCustomer.notes).toBeNull();
  });

  it("requires a profile name", () => {
    expect(errors(idealCustomerSectionSchema.safeParse({ ...valid, name: "   " }))).toHaveProperty("name");
  });

  it("allows an open-ended or empty company size", () => {
    for (const size of [
      { minEmployees: null, maxEmployees: null },
      { minEmployees: 50, maxEmployees: null },
      { minEmployees: null, maxEmployees: 50 },
      { minEmployees: 0, maxEmployees: 0 },
    ]) {
      expect(idealCustomerSectionSchema.safeParse({ ...valid, idealCustomer: { ...valid.idealCustomer, companySize: size } }).success).toBe(true);
    }
  });

  it("rejects min > max, negatives, fractions, NaN and absurd sizes", () => {
    const bad = (minEmployees: number | null, maxEmployees: number | null) =>
      errors(idealCustomerSectionSchema.safeParse({ ...valid, idealCustomer: { ...valid.idealCustomer, companySize: { minEmployees, maxEmployees } } }));
    expect(bad(500, 10)).toHaveProperty(["idealCustomer.companySize.maxEmployees"]);
    expect(bad(-1, null)).toHaveProperty(["idealCustomer.companySize.minEmployees"]);
    expect(bad(1.5, null)).toHaveProperty(["idealCustomer.companySize.minEmployees"]);
    expect(bad(Number.NaN, null)).toHaveProperty(["idealCustomer.companySize.minEmployees"]);
    expect(bad(null, 20_000_000)).toHaveProperty(["idealCustomer.companySize.maxEmployees"]);
  });

  it("rejects duplicate tags case-insensitively and over-long tags", () => {
    const dup = errors(idealCustomerSectionSchema.safeParse({ ...valid, idealCustomer: { ...valid.idealCustomer, keywords: ["Alpha", " alpha "] } }));
    expect(dup["idealCustomer.keywords.1"]).toMatch(/already listed/);
    const long = errors(idealCustomerSectionSchema.safeParse({ ...valid, idealCustomer: { ...valid.idealCustomer, industries: ["x".repeat(81)] } }));
    expect(long).toHaveProperty(["idealCustomer.industries.0"]);
  });

  it("rejects unknown keys (no mass assignment through jsonb)", () => {
    expect(idealCustomerSectionSchema.safeParse({ ...valid, workspace_id: id() }).success).toBe(false);
    expect(idealCustomerSectionSchema.safeParse({ ...valid, idealCustomer: { ...valid.idealCustomer, score: 100 } }).success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe("geographies", () => {
  it("accepts country-only, region and city targets for any country", () => {
    const r = geographiesSchema.parse([
      { id: id(), countryCode: "jp", region: null, city: null },
      { id: id(), countryCode: "BR", region: "Region Name", city: null },
      { id: id(), countryCode: "DE", region: null, city: "City Name" },
      { id: id(), countryCode: "KE", region: "Some Region", city: "Some City", label: "Custom area" },
    ]);
    expect(r[0]).toMatchObject({ countryCode: "JP", countryName: countryName("JP"), region: null, city: null, label: null });
    expect(geographyLabel(r[2])).toBe(`City Name, ${countryName("DE")}`);
    expect(geographyLabel(r[3])).toBe("Custom area");
  });

  it("requires a valid ISO country code", () => {
    expect(errors(geographiesSchema.safeParse([{ id: id(), countryCode: "", region: "Somewhere", city: null }]))).toHaveProperty(["0.countryCode"]);
    expect(geographiesSchema.safeParse([{ id: id(), countryCode: "ZZ", region: null, city: null }]).success).toBe(false);
    expect(isCountryCode("US") && isCountryCode("XK") && !isCountryCode("EU")).toBe(true);
  });

  it("rejects duplicate targets (normalized) and duplicate ids", () => {
    const dupPlace = geographiesSchema.safeParse([
      { id: id(), countryCode: "FR", region: "Region", city: null },
      { id: id(), countryCode: "fr", region: " region ", city: "" },
    ]);
    expect(dupPlace.success).toBe(false);
    const same = id();
    const dupId = geographiesSchema.safeParse([
      { id: same, countryCode: "FR", region: null, city: null },
      { id: same, countryCode: "IT", region: null, city: null },
    ]);
    expect(errors(dupId)).toHaveProperty(["1.id"]);
  });

  it("ignores client-supplied derived fields and recomputes them", () => {
    const [g] = geographiesSchema.parse([{ id: id(), countryCode: "CA", countryName: "Spoofed", region: null, city: null }]);
    expect(g.countryName).toBe(countryName("CA"));
  });

  it("rejects non-uuid ids and too many targets", () => {
    expect(geographiesSchema.safeParse([{ id: "1", countryCode: "CA", region: null, city: null }]).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => ({ id: id(), countryCode: "CA", region: `R${i}`, city: null }));
    expect(geographiesSchema.safeParse(many).success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe("decision-maker titles", () => {
  const role = (title: string, priority = "primary") => ({ id: id(), title, priority, seniority: null });

  it("accepts arbitrary titles with priorities and optional seniority", () => {
    const r = decisionMakersSchema.parse([role("Title One"), { ...role("Title Two", "fallback"), seniority: "manager" }]);
    expect(r.map((d) => d.priority)).toEqual(["primary", "fallback"]);
  });

  it("rejects duplicates after trimming, whitespace collapsing and case folding", () => {
    const r = decisionMakersSchema.safeParse([role("Head of Things"), role("  head   of THINGS ", "secondary")]);
    expect(errors(r)["1.title"]).toMatch(/already listed/);
  });

  it("rejects empty titles, unknown priorities and unknown seniority", () => {
    expect(errors(decisionMakersSchema.safeParse([role("  ")]))).toHaveProperty(["0.title"]);
    expect(decisionMakersSchema.safeParse([role("X", "urgent")]).success).toBe(false);
    expect(decisionMakersSchema.safeParse([{ ...role("X"), seniority: "boss" }]).success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe("buying signals", () => {
  const signal = (weight: number, name = "Signal") => ({ id: id(), name, description: "", weight, enabled: true });

  it("accepts weights 1 to 100", () => {
    expect(buyingSignalsSchema.safeParse([signal(1, "a"), signal(100, "b")]).success).toBe(true);
  });

  it.each([0, 101, 50.5, Number.NaN, -5])("rejects weight %s", (w) => {
    expect(errors(buyingSignalsSchema.safeParse([signal(w)]))).toHaveProperty(["0.weight"]);
  });

  it("rejects duplicate signal names", () => {
    expect(buyingSignalsSchema.safeParse([signal(10, "Same"), signal(20, "same")]).success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe("exclusion signals", () => {
  const ex = (behavior: string, penalty: number | null) => ({ id: id(), name: "Rule", description: null, behavior, penalty, enabled: true });

  it("accepts a hard exclusion without a penalty and a penalty with points", () => {
    expect(exclusionSignalsSchema.safeParse([ex("hard_exclude", null)]).success).toBe(true);
    expect(exclusionSignalsSchema.safeParse([ex("penalty", 25)]).success).toBe(true);
  });

  it("requires a valid penalty for penalty behavior", () => {
    expect(errors(exclusionSignalsSchema.safeParse([ex("penalty", null)]))).toHaveProperty(["0.penalty"]);
    expect(errors(exclusionSignalsSchema.safeParse([ex("penalty", 0)]))).toHaveProperty(["0.penalty"]);
    expect(errors(exclusionSignalsSchema.safeParse([ex("penalty", 101)]))).toHaveProperty(["0.penalty"]);
  });

  it("rejects a penalty on a hard exclusion and unknown behaviors", () => {
    expect(errors(exclusionSignalsSchema.safeParse([ex("hard_exclude", 10)]))).toHaveProperty(["0.penalty"]);
    expect(exclusionSignalsSchema.safeParse([ex("ignore", null)]).success).toBe(false);
  });

  it("an empty list is valid (explicitly no exclusions)", () => {
    expect(exclusionSignalsSchema.parse([])).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
describe("scoring model", () => {
  const model = (a: number, b: number, w = SUGGESTED_SCORING_MODEL.categoryWeights) => ({ thresholds: { a, b }, categoryWeights: w });

  it("accepts the suggested defaults and other coherent thresholds", () => {
    expect(scoringModelSchema.safeParse(SUGGESTED_SCORING_MODEL).success).toBe(true);
    expect(scoringModelSchema.safeParse(model(100, 99)).success).toBe(true);
    expect(scoringModelSchema.safeParse(model(2, 1)).success).toBe(true);
  });

  it("rejects A <= B, out-of-range values and non-integers", () => {
    expect(errors(scoringModelSchema.safeParse(model(50, 50)))).toHaveProperty(["thresholds.a"]);
    expect(errors(scoringModelSchema.safeParse(model(40, 60)))).toHaveProperty(["thresholds.a"]);
    expect(errors(scoringModelSchema.safeParse(model(101, 50)))).toHaveProperty(["thresholds.a"]);
    expect(errors(scoringModelSchema.safeParse(model(75, 0)))).toHaveProperty(["thresholds.b"]);
    expect(errors(scoringModelSchema.safeParse(model(75.5, 50)))).toHaveProperty(["thresholds.a"]);
  });

  it("requires category weights that sum to 100", () => {
    const w = { company_fit: 50, geography_fit: 20, decision_maker_fit: 20, buying_signal_fit: 20 };
    expect(errors(scoringModelSchema.safeParse(model(75, 50, w)))["categoryWeights"]).toMatch(/add up to 100 \(currently 110\)/);
    expect(scoringModelSchema.safeParse(model(75, 50, { ...w, company_fit: 40 })).success).toBe(true);
  });

  it("derives non-overlapping grade bands from the thresholds", () => {
    expect(gradeBands({ a: 75, b: 50 }).map((g) => [g.grade, g.min, g.max])).toEqual([
      ["A", 75, 100],
      ["B", 50, 74],
      ["C", 0, 49],
    ]);
  });
});

// -----------------------------------------------------------------------------
describe("section mutation envelope", () => {
  it("routes by section and rejects mismatched values or unknown sections", () => {
    expect(icpSectionInputSchema.safeParse({ section: "scoring", profileId: null, revision: null, value: SUGGESTED_SCORING_MODEL }).success).toBe(true);
    expect(icpSectionInputSchema.safeParse({ section: "scoring", profileId: null, revision: null, value: [] }).success).toBe(false);
    expect(icpSectionInputSchema.safeParse({ section: "workspace_id", profileId: null, revision: null, value: {} }).success).toBe(false);
    expect(icpSectionInputSchema.safeParse({ section: "geographies", profileId: "not-a-uuid", revision: 1, value: [] }).success).toBe(false);
    expect(icpSectionInputSchema.safeParse({ section: "geographies", profileId: id(), revision: 0, value: [] }).success).toBe(false);
    expect(icpSectionInputSchema.safeParse({ section: "geographies", profileId: null, revision: null, value: [], extra: 1 }).success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe("configuration completeness", () => {
  const base: IcpProfileConfig = {
    id: id(),
    name: "Default profile",
    description: null,
    revision: 1,
    idealCustomer: null,
    geographies: null,
    decisionMakers: null,
    buyingSignals: null,
    exclusionSignals: null,
    scoringModel: null,
  };

  it("everything is not configured without a profile, or with a freshly created one", () => {
    for (const p of [null, base]) {
      expect(Object.values(allSectionStatuses(p)).every((s) => s.state === "not_configured")).toBe(true);
    }
  });

  it("ideal customer: empty object is not configured; description or criteria alone is partial; both is configured", () => {
    expect(sectionStatus({ ...base, idealCustomer: EMPTY_IDEAL_CUSTOMER }, "ideal_customer").state).toBe("not_configured");
    expect(sectionStatus({ ...base, description: "Who we serve" }, "ideal_customer").state).toBe("partial");
    const sized = { ...EMPTY_IDEAL_CUSTOMER, companySize: { minEmployees: 5, maxEmployees: null } };
    expect(sectionStatus({ ...base, idealCustomer: sized }, "ideal_customer").state).toBe("partial");
    expect(sectionStatus({ ...base, description: "Who", idealCustomer: sized }, "ideal_customer").label).toBe("Configured");
  });

  it("lists: empty is not configured; one entry is configured", () => {
    expect(sectionStatus({ ...base, geographies: [] }, "geographies").state).toBe("not_configured");
    const geo = geographiesSchema.parse([{ id: id(), countryCode: "NZ", region: null, city: null }]);
    expect(sectionStatus({ ...base, geographies: geo }, "geographies").state).toBe("configured");
    expect(sectionStatus({ ...base, decisionMakers: [] }, "decision_makers").state).toBe("not_configured");
    expect(
      sectionStatus({ ...base, decisionMakers: [{ id: id(), title: "T", priority: "primary", seniority: null }] }, "decision_makers").state,
    ).toBe("configured");
  });

  it("buying signals: only enabled signals count; all-disabled is partial", () => {
    const s = (enabled: boolean) => ({ id: id(), name: `S${enabled}`, description: null, weight: 10, enabled });
    expect(sectionStatus({ ...base, buyingSignals: [s(false)] }, "buying_signals").state).toBe("partial");
    expect(sectionStatus({ ...base, buyingSignals: [s(false), s(true)] }, "buying_signals").state).toBe("configured");
  });

  it("exclusions: never saved is not configured; saved empty is an explicit 'No exclusions'", () => {
    expect(sectionStatus(base, "exclusion_signals").state).toBe("not_configured");
    expect(sectionStatus({ ...base, exclusionSignals: [] }, "exclusion_signals")).toEqual({ state: "configured", label: "No exclusions" });
    const rule = { id: id(), name: "R", description: null, behavior: "hard_exclude" as const, penalty: null, enabled: true };
    expect(sectionStatus({ ...base, exclusionSignals: [rule] }, "exclusion_signals").label).toBe("Configured");
  });

  it("scoring: configured only when a model is saved", () => {
    expect(sectionStatus({ ...base, scoringModel: SUGGESTED_SCORING_MODEL }, "scoring").state).toBe("configured");
  });
});

// -----------------------------------------------------------------------------
describe("business profile validation", () => {
  const valid = { name: "Example", primaryDomain: "", websiteUrl: "", description: "", timezone: "UTC" };

  it("normalizes optional fields and domains", () => {
    const r = businessProfileSchema.parse({ ...valid, primaryDomain: "HTTPS://Example.TEST/path", websiteUrl: "https://example.test" });
    expect(r).toEqual({ name: "Example", primaryDomain: "example.test", websiteUrl: "https://example.test", description: null, timezone: "UTC" });
  });

  it("rejects an empty name, bad domain, non-http website and long description", () => {
    expect(errors(businessProfileSchema.safeParse({ ...valid, name: " " }))).toHaveProperty("name");
    expect(errors(businessProfileSchema.safeParse({ ...valid, primaryDomain: "not a domain" }))).toHaveProperty("primaryDomain");
    expect(errors(businessProfileSchema.safeParse({ ...valid, websiteUrl: "javascript:alert(1)" }))).toHaveProperty("websiteUrl");
    expect(errors(businessProfileSchema.safeParse({ ...valid, description: "x".repeat(2001) }))).toHaveProperty("description");
    expect(errors(businessProfileSchema.safeParse({ ...valid, timezone: "Mars/Base" }))).toHaveProperty("timezone");
    expect(errors(businessProfileSchema.safeParse({ ...valid, timezone: "+05:00" }))).toHaveProperty("timezone");
  });

  it("rejects extra fields such as slug, organization_id or logo", () => {
    expect(businessProfileSchema.safeParse({ ...valid, organization_id: id() }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...valid, slug: "x" }).success).toBe(false);
  });
});

describe("business profile re-validation (P1-E7 fix)", () => {
  it("accepts its own parsed output (empty optional fields → null) on the server", () => {
    const parsed = businessProfileSchema.parse({ name: "Example", primaryDomain: "", websiteUrl: "", description: "", timezone: "Europe/London" });
    expect(businessProfileSchema.parse(parsed)).toEqual(parsed);
  });
});
