import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decisionMakersSchema, geographiesSchema, idealCustomerSectionSchema } from "@/lib/config/icp";

/**
 * Guard for the core architectural rule: no business, industry, geography or
 * provider may be hard-coded in application code or schema. Businesses exist
 * only as workspace data.
 *
 * Terms are stored reversed so this file itself does not trip searches.
 */
const FORBIDDEN = ["nyrmen", "htlehc", "drawnez"].map((t) => t.split("").reverse().join(""));

// Industries of current businesses: allowed as workspace data, never in code or fixtures.
const FORBIDDEN_INDUSTRIES = ["medical transport", "healthcare staffing", "paratransit"];
const FORBIDDEN_WORDS = [/\bnemt\b/];

// Providers that must only ever appear as configurable data, never in code.
const FORBIDDEN_PROVIDERS = ["google places", "hunter.io", "apollo.io", "twilio", "aircall", "ringcentral", "krispcall", "uplead", "clay.com"];

/**
 * Approved provider integrations may name their provider ONLY inside their own
 * adapter folder (and that adapter's UI review script). Everything else uses
 * the generic provider interface and keys.
 */
const PROVIDER_HOMES: Record<string, RegExp[]> = {
  // P1-E3 (approved): Google Places company discovery
  "google places": [/src[\\/]lib[\\/]providers[\\/]company-discovery[\\/]google-places[\\/]/, /scripts[\\/]ui-review[\\/]review-discover\.mjs$/],
  // P1-E4 (approved): Hunter company enrichment (the bundle scan names the host too)
  // P1-E5 (approved): Hunter Domain Search contact discovery
  "hunter.io": [
    /src[\\/]lib[\\/]providers[\\/](company-enrichment|contact-discovery)[\\/]hunter[\\/]/,
    /scripts[\\/]ui-review[\\/]review-(enrichment|contacts)\.mjs$/,
    /scripts[\\/]check-client-bundle\.mjs$/,
  ],
};

/** Provider-specific endpoints/headers must stay inside their adapter folder (generic code uses keys and labels). */
const ADAPTER_ONLY: [RegExp, RegExp][] = [
  [/x-api-key/, /src[\\/]lib[\\/]providers[\\/]company-enrichment[\\/]hunter[\\/]/],
  [/domain-finder|companies\/find/, /src[\\/]lib[\\/]providers[\\/]company-enrichment[\\/]hunter[\\/]/],
  [/domain-search/, /src[\\/]lib[\\/]providers[\\/]contact-discovery[\\/]hunter[\\/]/],
];

const ROOT = path.resolve(__dirname, "../..");
const SCANNED_DIRS = ["src", "supabase/migrations", "supabase/seed.sql", "scripts"];

async function* walk(target: string): AsyncGenerator<string> {
  const full = path.join(ROOT, target);
  const entries = await readdir(full, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    yield full;
    return;
  }
  for (const entry of entries) {
    const rel = path.join(target, entry.name);
    if (entry.isDirectory()) yield* walk(rel);
    else if (/\.(tsx?|mjs|css|sql|json)$/.test(entry.name)) yield path.join(ROOT, rel);
  }
}

describe("business-agnostic codebase", () => {
  it("contains no named businesses or providers in application code, schema or seed", async () => {
    const hits: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for await (const file of walk(dir)) {
        const text = (await readFile(file, "utf8")).toLowerCase();
        for (const term of [...FORBIDDEN, ...FORBIDDEN_INDUSTRIES, ...FORBIDDEN_PROVIDERS]) {
          if (PROVIDER_HOMES[term]?.some((home) => home.test(file))) continue;
          if (text.includes(term)) hits.push(`${path.relative(ROOT, file)}: "${term}"`);
        }
        for (const re of FORBIDDEN_WORDS) {
          if (re.test(text)) hits.push(`${path.relative(ROOT, file)}: ${re}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("keeps provider endpoints and auth headers inside their adapter folder", async () => {
    const hits: string[] = [];
    for await (const file of walk("src")) {
      const text = (await readFile(file, "utf8")).toLowerCase();
      for (const [re, home] of ADAPTER_ONLY) if (re.test(text) && !home.test(file)) hits.push(`${path.relative(ROOT, file)}: ${re}`);
    }
    expect(hits).toEqual([]);
  });

  // Generic examples used by UI review / tests must stay fixtures: they may never
  // become defaults, placeholders or logic in application code or schema.
  const FIXTURE_ONLY_EXAMPLES = [
    "professional services",
    "operations director",
    "founder",
    "office manager",
    "california",
    "new contract",
    "new location",
    // P1-E1 lead-core review fixtures (scripts/ui-review/mock-supabase.mjs)
    "northwind",
    "lumen field",
    "cedar point",
    "brightwave",
    "atlas ridge",
    "example-registry",
    // P1-E2 import review fixtures (scripts/ui-review/review-imports.mjs)
    "harbor lane",
    "harborlane",
    "quayside",
    "fernway",
    "orchard lane",
    "sample company",
    // P1-E3: no industry or place may steer discovery from code
    "georgia",
    "united states",
    "transportation",
    "automotive",
    "staffing",
    "healthcare",
    // P1-E3 discovery review/test fixtures (mock provider responses)
    "maple row",
    "brightline print",
    "northgate ledger",
    "copperleaf",
    "willowbank",
    "harborview",
    "lakeside bookkeeping",
    "fixture-place",
    "mock-place",
    // P1-E4 enrichment test/review fixtures (tests/fixtures/hunter.ts, mock-supabase.mjs)
    "quillstone",
    "fictional way",
    "sample county",
    "maple row bookkeeping",
    "mapleleaf",
    "brightline-print",
    // P1-E5 contact-discovery test/review fixtures (tests/fixtures/hunter-domain-search.ts, mock-supabase.mjs)
    "tidewell",
    "ada quill",
    "casey rowe",
    "drew lin",
    "quinn hart",
    "parker vale",
  ];
  const RUNTIME_DIRS = ["src", "supabase/migrations"];

  it("keeps example ICP values (industries, titles, places, signals) out of runtime code and schema", async () => {
    const hits: string[] = [];
    for (const dir of RUNTIME_DIRS) {
      for await (const file of walk(dir)) {
        // Development-only UI fixtures (excluded from normal builds) may use examples.
        if (/[\\/](dev-fixtures|ui-fixtures)[\\/]/.test(file)) continue;
        const text = (await readFile(file, "utf8")).toLowerCase();
        for (const term of FIXTURE_ONLY_EXAMPLES) {
          if (text.includes(term)) hits.push(`${path.relative(ROOT, file)}: "${term}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("accepts the configuration of an unrelated, invented business without code changes", () => {
    const id = () => crypto.randomUUID();
    const config = {
      ideal_customer: idealCustomerSectionSchema.safeParse({
        name: "Coastal fleets",
        description: "Operators of small marine robotics fleets.",
        idealCustomer: {
          industries: ["Marine robotics", "Aquaculture"],
          companySize: { minEmployees: 3, maxEmployees: 80 },
          characteristics: ["Owns vessels"],
          keywords: ["subsea", "ROV"],
          notes: null,
        },
      }),
      geographies: geographiesSchema.safeParse([
        { id: id(), countryCode: "NO", region: null, city: null },
        { id: id(), countryCode: "CL", region: "Los Lagos", city: "Puerto Montt" },
        { id: id(), countryCode: "JP", region: "Hokkaidō", city: null, label: "Northern Japan" },
      ]),
      decision_makers: decisionMakersSchema.safeParse([
        { id: id(), title: "Directeur technique", priority: "primary", seniority: "director" },
        { id: id(), title: "船長", priority: "secondary", seniority: null },
      ]),
    };
    for (const [section, result] of Object.entries(config)) expect(result.success, section).toBe(true);
  });
});
