import { describe, expect, it } from "vitest";
import type { BuyingSignal, DecisionMaker, ExclusionSignal, Geography, IdealCustomer, ScoringModel } from "@/lib/config/icp";
import { companyCorpus, industryGroup, phraseGroup, sizeGroup } from "@/lib/scoring/company-fit";
import { evaluateCompanyAgainstIcp, gradeFor } from "@/lib/scoring/evaluate";
import { toScoreRecord } from "@/lib/scoring/explain";
import { matchGeography } from "@/lib/scoring/geography-fit";
import { parseScoringInput } from "@/lib/scoring/input";
import { containsPhrase, textKey } from "@/lib/scoring/text";
import type { ScoringInput } from "@/lib/scoring/types";
import { evaluateFitSchema, saveSignalsSchema, toFitResultView } from "@/lib/scoring/view";

/** Generic fictional fixtures; every value is invented. */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FP = "f".repeat(64);

const model: ScoringModel = { thresholds: { a: 75, b: 50 }, categoryWeights: { company_fit: 40, geography_fit: 20, decision_maker_fit: 20, buying_signal_fit: 20 } };
const ideal: IdealCustomer = {
  industries: ["Marine robotics"],
  companySize: { minEmployees: 20, maxEmployees: 100 },
  characteristics: ["owns vessels", "operates a workshop"],
  keywords: ["subsea", "ROV"],
  notes: "Notes are never scored.",
};
const geo = (n: number, countryCode: string, region: string | null, city: string | null): Geography => ({ id: uuid(100 + n), countryCode, countryName: countryCode, region, city, label: null });
const roles: DecisionMaker[] = [
  { id: uuid(201), title: "Fleet Director", priority: "primary", seniority: "director" },
  { id: uuid(202), title: "Operations Manager", priority: "secondary", seniority: "manager" },
  { id: uuid(203), title: "Office Lead", priority: "fallback", seniority: null },
];
const buying: BuyingSignal[] = [
  { id: uuid(301), name: "Expanding operations", description: null, weight: 60, enabled: true },
  { id: uuid(302), name: "New vessel order", description: null, weight: 40, enabled: true },
  { id: uuid(303), name: "Disabled signal", description: null, weight: 50, enabled: false },
];
const exclusionList: ExclusionSignal[] = [
  { id: uuid(401), name: "Consumer-only business", description: null, behavior: "hard_exclude", penalty: null, enabled: true },
  { id: uuid(402), name: "Uses a competitor", description: null, behavior: "penalty", penalty: 10, enabled: true },
  { id: uuid(403), name: "Long sales cycle", description: null, behavior: "penalty", penalty: 15, enabled: true },
  { id: uuid(404), name: "Disabled exclusion", description: null, behavior: "hard_exclude", penalty: null, enabled: false },
];

function input(o: { company?: Partial<ScoringInput["company"]>; tags?: string[]; contacts?: ScoringInput["contacts"]; signals?: ScoringInput["signals"]; icp?: Partial<ScoringInput["icp"]> } = {}): ScoringInput {
  return {
    fingerprint: FP,
    company: {
      id: uuid(1), name: "Tidecraft Fictional", industry: "Marine robotics and ROV services", description: "Owns vessels and operates a workshop for subsea and ROV work.",
      employeeMin: 30, employeeMax: 60, country: "NO", region: "Vestland", city: "Bergen", ...o.company,
    },
    tags: o.tags ?? [],
    contacts: o.contacts ?? [{ title: "Fleet Director" }],
    signals: o.signals ?? [],
    icp: {
      id: uuid(900), revision: 3, idealCustomer: ideal, geographies: [geo(1, "NO", null, null)], decisionMakers: roles,
      buyingSignals: buying, exclusionSignals: exclusionList, scoringModel: model, ...o.icp,
    },
  };
}
const scored = (i: ScoringInput) => {
  const e = evaluateCompanyAgainstIcp(i);
  if (e.outcome === "not_evaluable") throw new Error("expected an evaluation");
  return e;
};

// =============================================================================
describe("text matching", () => {
  it("normalizes NFKC/case/punctuation and matches whole phrases only", () => {
    expect(textKey("  Marine-Robotics, LTD. ")).toBe("marine robotics ltd");
    expect(containsPhrase("Marine robotics and ROV services", "marine robotics")).toBe(true);
    expect(containsPhrase("Submarine robotics", "marine robotics")).toBe(false);
    expect(containsPhrase(null, "x")).toBe(false);
  });

  it("builds the company corpus from approved durable text; the name alone isn't evaluable", () => {
    expect(companyCorpus({ company: input().company, tags: ["Survey"] })).toMatchObject({ evaluable: true });
    expect(companyCorpus({ company: { ...input().company, industry: null, description: null }, tags: [] })).toMatchObject({ evaluable: false });
  });
});

// =============================================================================
describe("company fit", () => {
  const c = (o: Partial<ScoringInput["company"]>, tags: string[] = []) => ({ company: { ...input().company, ...o }, tags });

  it("industry: exact, phrase containment, tag evidence, no match, unavailable", () => {
    expect(industryGroup(["Marine robotics"], c({ industry: "Marine robotics" })).raw).toBe(100);
    expect(industryGroup(["marine robotics"], c({ industry: "Marine robotics and ROV services" })).raw).toBe(100);
    expect(industryGroup(["Survey"], c({ industry: "Other" }, ["Survey, Mapping"])).raw).toBe(100);
    const no = industryGroup(["Bakeries"], c({ industry: "Marine robotics" }));
    expect([no.raw, no.known, no.items[0].result]).toEqual([0, 1, "not_matched"]);
    const un = industryGroup(["Bakeries"], c({ industry: null }));
    expect([un.raw, un.known, un.items[0].detail]).toEqual([0, 0, "Industry data unavailable"]);
  });

  it("size: full fit, partial overlap, outside, open-ended, unknown", () => {
    const t = { minEmployees: 20, maxEmployees: 100 };
    expect(sizeGroup(t, c({ employeeMin: 25, employeeMax: 50 })).raw).toBe(100);
    expect(sizeGroup(t, c({ employeeMin: 25, employeeMax: 50 })).items[0].detail).toBe("Employee range 25–50 fits target 20–100");
    expect(sizeGroup(t, c({ employeeMin: 80, employeeMax: 200 })).raw).toBe(50);
    expect(sizeGroup(t, c({ employeeMin: 200, employeeMax: 500 })).raw).toBe(0);
    expect(sizeGroup({ minEmployees: 50, maxEmployees: null }, c({ employeeMin: 60, employeeMax: null })).raw).toBe(100);
    expect(sizeGroup({ minEmployees: null, maxEmployees: 10 }, c({ employeeMin: null, employeeMax: 50 })).raw).toBe(50);
    expect(sizeGroup(t, c({ employeeMin: 1000, employeeMax: null })).raw).toBe(0);
    const un = sizeGroup(t, c({ employeeMin: null, employeeMax: null }));
    expect([un.raw, un.known, un.items[0].result]).toEqual([0, 0, "unknown"]);
  });

  it("characteristics and keywords: literal phrases only (no synonyms), unknown without text", () => {
    const g = phraseGroup("Characteristic", ["owns vessels", "multi-location"], c({ description: "We own vessels and have several branches." }));
    expect(g.raw).toBe(0); // "own vessels" ≠ "owns vessels"; "several branches" ≠ "multi-location"
    const h = phraseGroup("Keyword", ["subsea", "ROV"], c({}));
    expect([h.raw, h.known, h.total]).toEqual([100, 2, 2]);
    const u = phraseGroup("Keyword", ["subsea"], c({ industry: null, description: null }));
    expect([u.raw, u.known, u.total, u.items[0].result]).toEqual([0, 0, 1, "unknown"]);
  });

  it("company fit = average of configured groups only (notes ignored)", () => {
    const e = scored(input({ company: { employeeMin: 80, employeeMax: 200 } }));
    // industry 100, size 50, characteristics 100 (both phrases present), keywords 100 → 87.5
    expect(e.categories.company_fit.raw).toBe(87.5);
    const onlyIndustry = scored(input({ icp: { idealCustomer: { ...ideal, companySize: { minEmployees: null, maxEmployees: null }, characteristics: [], keywords: [] } } }));
    expect(onlyIndustry.categories.company_fit.raw).toBe(100);
    expect(onlyIndustry.categories.company_fit.coverage).toEqual({ known: 1, total: 1 });
  });
});

// =============================================================================
describe("geography fit", () => {
  const company = input().company;
  it("country, region and city targets at their specificity", () => {
    expect(matchGeography(geo(1, "NO", null, null), company)).toBe("match");
    expect(matchGeography(geo(2, "SE", null, null), company)).toBe("no_match");
    expect(matchGeography(geo(3, "NO", "vestland", null), company)).toBe("match");
    expect(matchGeography(geo(4, "NO", "Rogaland", null), company)).toBe("no_match");
    expect(matchGeography(geo(5, "NO", null, "BERGEN"), company)).toBe("match");
    expect(matchGeography(geo(6, "NO", "Rogaland", "Bergen"), company)).toBe("no_match");
    expect(matchGeography(geo(7, "NO", null, "Bergen"), { ...company, city: null })).toBe("unknown");
  });

  it("any match → 100; location present but outside → 0 known; missing → 0 unknown", () => {
    expect(scored(input({ icp: { geographies: [geo(1, "SE", null, null), geo(2, "NO", null, null)] } })).categories.geography_fit.raw).toBe(100);
    const out = scored(input({ icp: { geographies: [geo(1, "SE", null, null)] } })).categories.geography_fit;
    expect([out.raw, out.coverage.known]).toEqual([0, 1]);
    const missing = scored(input({ company: { country: null, region: null, city: null } })).categories.geography_fit;
    expect([missing.raw, missing.coverage.known, missing.items[0].detail]).toEqual([0, 0, "Company location unavailable"]);
  });
});

// =============================================================================
describe("decision-maker fit", () => {
  const dm = (contacts: ScoringInput["contacts"]) => scored(input({ contacts })).categories.decision_maker_fit;
  it("primary 100, secondary 70, fallback 40, highest wins; none 0 known; no contacts 0 unknown", () => {
    expect(dm([{ title: "Fleet Director, North" }]).raw).toBe(100);
    expect(dm([{ title: "Senior Operations Manager" }]).raw).toBe(70);
    expect(dm([{ title: "Office Lead" }]).raw).toBe(40);
    expect(dm([{ title: "Office Lead" }, { title: "Fleet Director" }]).raw).toBe(100);
    const none = dm([{ title: "Analyst" }, { title: null }]);
    expect([none.raw, none.coverage.known]).toEqual([0, 1]);
    const empty = dm([]);
    expect([empty.raw, empty.coverage.known, empty.items[0].result]).toEqual([0, 0, "unknown"]);
  });
  // "left company" contacts are excluded upstream by public.scoring_input (DB-tested).
});

// =============================================================================
describe("signals and exclusions", () => {
  const sig = (kind: "buying" | "exclusion", n: number, state: "present" | "absent") => ({ kind, id: uuid(n), state });

  it("buying = present weights / enabled weights; absent 0; unknown 0 and lowers coverage; disabled ignored", () => {
    const b = scored(input({ signals: [sig("buying", 301, "present"), sig("buying", 302, "absent"), sig("buying", 303, "present")] })).categories.buying_signal_fit;
    expect([b.raw, b.coverage]).toEqual([60, { known: 2, total: 2 }]);
    const u = scored(input({ signals: [sig("buying", 302, "present")] })).categories.buying_signal_fit;
    expect([u.raw, u.coverage]).toEqual([40, { known: 1, total: 2 }]);
  });

  it("hard exclusion (present only) → Excluded with reason, no grade; unknown/absent never exclude", () => {
    const e = scored(input({ signals: [sig("exclusion", 401, "present")] }));
    expect([e.outcome, e.grade, e.score]).toEqual(["excluded", null, null]);
    expect(e.hardExclusions.map((h) => h.name)).toEqual(["Consumer-only business"]);
    expect(scored(input({ signals: [sig("exclusion", 401, "absent")] })).outcome).toBe("scored");
    expect(scored(input()).outcome).toBe("scored");
    const two = scored(input({ icp: { exclusionSignals: [...exclusionList, { id: uuid(405), name: "Second hard", description: null, behavior: "hard_exclude", penalty: null, enabled: true }] }, signals: [sig("exclusion", 401, "present"), sig("exclusion", 405, "present")] }));
    expect(two.hardExclusions).toHaveLength(2);
    expect(toScoreRecord(two).exclusionReasons).toEqual([{ id: uuid(401), name: "Consumer-only business" }, { id: uuid(405), name: "Second hard" }]);
  });

  it("penalties subtract points (summed, not weighted); clamped at 0", () => {
    const base = scored(input()).score!;
    const one = scored(input({ signals: [sig("exclusion", 402, "present")] }));
    expect(one.score).toBe(base - 10);
    const both = scored(input({ signals: [sig("exclusion", 402, "present"), sig("exclusion", 403, "present")] }));
    expect([both.score, both.exclusionPenalty]).toEqual([base - 25, 25]);
    const floor = scored(input({ company: { industry: null, description: null, employeeMin: null, employeeMax: null, country: null }, contacts: [], signals: [sig("exclusion", 402, "present"), sig("exclusion", 403, "present")] }));
    expect(floor.score).toBe(0);
  });
});

// =============================================================================
describe("configured categories, effective weights, score and grade", () => {
  it("unconfigured categories leave the denominator; configured weights are never rewritten", () => {
    const e = scored(input({ icp: { buyingSignals: [] }, company: { employeeMin: 80, employeeMax: 200 }, contacts: [{ title: "Operations Manager" }] }));
    expect(e.categories.buying_signal_fit).toMatchObject({ configured: false, raw: null, configuredWeight: 20, effectiveWeight: null, contribution: 0 });
    expect(e.categories.company_fit.effectiveWeight).toBe(50); // 40 / 80
    // (87.5×40 + 100×20 + 70×20) / 80 = 86.25 → 86
    expect(e.score).toBe(86);
  });

  it("the documented example: 85/100/70/50, penalty 10 → base 78, final 68, grade B", () => {
    const example = (raw: { c: number; g: number; d: number; b: number }) => {
      const base = (raw.c * 40 + raw.g * 20 + raw.d * 20 + raw.b * 20) / 100;
      return Math.round(Math.min(100, Math.max(0, base - 10)));
    };
    expect(example({ c: 85, g: 100, d: 70, b: 50 })).toBe(68);
    expect(gradeFor(68, { a: 75, b: 50 })).toBe("B");
  });

  it("grades follow the profile's saved thresholds (not hard-coded)", () => {
    expect([gradeFor(75, model.thresholds), gradeFor(74, model.thresholds), gradeFor(50, model.thresholds), gradeFor(49, model.thresholds)]).toEqual(["A", "B", "B", "C"]);
    expect(gradeFor(80, { a: 90, b: 80 })).toBe("B");
    const a = scored(input({ signals: [{ kind: "buying", id: uuid(301), state: "present" }, { kind: "buying", id: uuid(302), state: "present" }] }));
    expect([a.score, a.grade]).toEqual([100, "A"]);
    const c = scored(input({ company: { industry: "Other", description: "Other", employeeMin: 500, employeeMax: 900, country: "SE" }, contacts: [{ title: "Analyst" }] }));
    expect(c.grade).toBe("C");
    const strict = scored(input({ icp: { scoringModel: { ...model, thresholds: { a: 100, b: 99 } } } }));
    expect(strict.grade).toBe(strict.score! >= 99 ? (strict.score === 100 ? "A" : "B") : "C");
  });

  it("rounds once (Math.round) and clamps to 0–100", () => {
    const e = scored(input({ icp: { geographies: [geo(1, "SE", null, null)], buyingSignals: [] }, company: { employeeMin: 80, employeeMax: 200 }, contacts: [{ title: "Operations Manager" }] }));
    // (87.5×40 + 0×20 + 70×20) / 80 = 61.25 → 61
    expect(e.score).toBe(61);
  });

  it("no scoring model or no configured category → not evaluable (no manufactured score)", () => {
    expect(evaluateCompanyAgainstIcp(input({ icp: { scoringModel: null } }))).toEqual({ outcome: "not_evaluable", reason: "no_scoring_model", inputFingerprint: FP });
    expect(evaluateCompanyAgainstIcp(input({ icp: { idealCustomer: null, geographies: null, decisionMakers: null, buyingSignals: null } })).outcome).toBe("not_evaluable");
    const zeroWeights = { ...model, categoryWeights: { company_fit: 0, geography_fit: 0, decision_maker_fit: 0, buying_signal_fit: 100 } };
    expect(evaluateCompanyAgainstIcp(input({ icp: { scoringModel: zeroWeights, buyingSignals: [] } })).outcome).toBe("not_evaluable");
  });

  it("each category combination evaluates (every non-empty subset)", () => {
    const subsets: [boolean, boolean, boolean, boolean][] = [];
    for (let m = 1; m < 16; m++) subsets.push([!!(m & 1), !!(m & 2), !!(m & 4), !!(m & 8)]);
    for (const [c, g, d, b] of subsets) {
      const e = evaluateCompanyAgainstIcp(input({ icp: { idealCustomer: c ? ideal : null, geographies: g ? [geo(1, "NO", null, null)] : [], decisionMakers: d ? roles : [], buyingSignals: b ? buying : [] } }));
      expect(e.outcome, JSON.stringify([c, g, d, b])).not.toBe("not_evaluable");
      if (e.outcome !== "not_evaluable") {
        const shares = Object.values(e.categories).reduce((t, x) => t + (x.effectiveWeight ?? 0), 0);
        expect(Math.round(shares)).toBe(100);
      }
    }
  });
});

// =============================================================================
describe("coverage (separate from fit)", () => {
  it("known units / configured units; doesn't change the score", () => {
    const full = scored(input({ signals: [{ kind: "buying", id: uuid(301), state: "absent" }, { kind: "buying", id: uuid(302), state: "absent" }, { kind: "exclusion", id: uuid(401), state: "absent" }, { kind: "exclusion", id: uuid(402), state: "absent" }, { kind: "exclusion", id: uuid(403), state: "absent" }] }));
    expect(full.coveragePercent).toBe(100);
    const thin = scored(input());
    // units: industry 1 + size 1 + 2 characteristics + 2 keywords + geo 1 + dm 1 + 2 buying + 3 exclusions = 13; known 8
    expect(thin.coveragePercent).toBe(Math.round((8 / 13) * 100));
    expect(thin.score).toBe(full.score);
    expect(thin.missing.map((m) => m.label)).toEqual(["2 buying-signal observations", "3 exclusion observations"]);
  });

  it("names what's missing so users can improve coverage", () => {
    const e = scored(input({ company: { industry: null, description: null, employeeMin: null, employeeMax: null, country: null }, contacts: [] }));
    expect(e.missing.map((m) => m.key)).toEqual(["industry", "size", "text", "location", "contacts", "buying_signals", "exclusions"]);
  });
});

// =============================================================================
describe("explanation and persisted record", () => {
  it("bounded deterministic sentences; raw breakdown + penalty; effective weights; exclusion reasons", () => {
    const e = scored(input({ signals: [{ kind: "buying", id: uuid(301), state: "present" }, { kind: "exclusion", id: uuid(402), state: "present" }] }));
    const r = toScoreRecord(e);
    expect(r.status).toBe("scored");
    expect(r.breakdown).toEqual({ company_fit: 100, geography_fit: 100, decision_maker_fit: 100, buying_signal_fit: 60, exclusion_penalty: 10 });
    expect(r.effectiveWeights.company_fit).toEqual({ configured: 40, effective: 40 });
    expect(r.explanation.categories.company_fit[0]).toEqual({ criterion: "Industry", result: "matched", detail: "Industry matches “Marine robotics”" });
    expect(r.explanation.categories.decision_maker_fit[0].detail).toBe("Primary decision-maker found: “Fleet Director” (role “Fleet Director”)");
    expect(r.explanation.exclusions[1].detail).toBe("“Uses a competitor” present: −10 points");
    expect(r.inputFingerprint).toBe(FP);
    expect(JSON.stringify(r).length).toBeLessThan(16384);
    const view = toFitResultView({ ...r, revision: 3, scoredAt: null, exclusionReasons: [] }, { current: true, reason: null })!;
    expect(view.categories.map((c) => [c.label, c.points])).toEqual([["Company fit", 40], ["Geography", 20], ["Decision makers", 20], ["Buying signals", 12]]);
    expect(view.penalty).toBe(10);
  });

  it("is deterministic: same input → identical result", () => {
    expect(JSON.stringify(evaluateCompanyAgainstIcp(input()))).toBe(JSON.stringify(evaluateCompanyAgainstIcp(input())));
  });
});

// =============================================================================
describe("scoring input and browser boundary", () => {
  it("parses the canonical DB document; invalid ICP sections count as not configured", () => {
    const doc = {
      fingerprint: FP,
      input: {
        v: 1,
        company: { id: uuid(1), name: "X", industry: null, description: null, employee_count_min: null, employee_count_max: null, country: "NO", region: null, city: null },
        tags: ["Survey"],
        contacts: [{ title: "Fleet Director" }],
        signals: [{ kind: "buying", id: uuid(301), state: "present" }],
        icp: { id: uuid(900), revision: 2, ideal_customer: { broken: true }, target_geographies: [{ id: uuid(101), countryCode: "NO", region: null, city: null }], decision_maker_titles: null, buying_signals: buying, exclusion_signals: [], scoring_model: model },
      },
    };
    const parsed = parseScoringInput(doc)!;
    expect(parsed.icp.idealCustomer).toBeNull();
    expect(parsed.icp.geographies).toHaveLength(1);
    expect(parsed.company.country).toBe("NO");
    expect(parseScoringInput({ ...doc, fingerprint: "nope" })).toBeNull();
  });

  it("evaluation input accepts ids only: browser-computed scores are rejected", () => {
    expect(evaluateFitSchema.safeParse({ companyId: uuid(1), icpProfileId: uuid(900) }).success).toBe(true);
    for (const extra of [{ score: 99 }, { grade: "A" }, { breakdown: {} }, { coverage: 100 }, { fingerprint: FP }]) {
      expect(evaluateFitSchema.safeParse({ companyId: uuid(1), icpProfileId: uuid(900), ...extra }).success).toBe(false);
    }
    expect(saveSignalsSchema.safeParse({ companyId: uuid(1), icpProfileId: uuid(900), revision: 1, changes: [{ kind: "buying", signalId: uuid(301), state: "maybe", note: null }] }).success).toBe(false);
  });
});
