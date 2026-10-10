import { z } from "zod";
import { countryName, isCountryCode } from "./countries";

/**
 * ICP (ideal customer profile) configuration, schema_version 1.
 *
 * These schemas are the single definition of the jsonb stored in
 * public.icp_profiles. They are used by the browser for instant feedback AND
 * re-run by every server action before anything is written; the database adds
 * CHECK constraints for top-level types and core numeric bounds.
 *
 * Everything here is generic: no industry, geography, title or signal is
 * known to the code. Those are workspace data.
 */

export const ICP_SCHEMA_VERSION = 1;

/** Name given to the first profile when a workspace saves any ICP section before naming it. */
export const DEFAULT_PROFILE_NAME = "Default profile";

export const LIMITS = {
  profileName: 120,
  description: 2000,
  notes: 2000,
  tag: 80,
  tags: 30,
  geographies: 100,
  place: 120,
  geographyLabel: 120,
  title: 120,
  titles: 50,
  signalName: 80,
  signalDescription: 500,
  signals: 50,
  maxEmployees: 10_000_000,
} as const;

// -----------------------------------------------------------------------------
// Building blocks
// -----------------------------------------------------------------------------

/** Trims and collapses internal whitespace. */
export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Comparison key for duplicate detection: normalized and case-insensitive. */
export function comparisonKey(value: string): string {
  return normalizeText(value).toLocaleLowerCase("en");
}

const requiredText = (max: number, emptyMessage: string) =>
  z
    .string()
    .transform(normalizeText)
    .pipe(z.string().min(1, emptyMessage).max(max, `Use ${max} characters or fewer.`));

/** Optional free text: "" and whitespace become null. Keeps line breaks. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .nullable()
    .transform((v) => (v ? v : null));

const optionalPlace = (max: number) =>
  z
    .string()
    .transform(normalizeText)
    .pipe(z.string().max(max, `Use ${max} characters or fewer.`))
    .nullable()
    .transform((v) => (v ? v : null));

function rejectDuplicates<T>(
  items: T[],
  ctx: z.RefinementCtx,
  key: (item: T) => string,
  path: (index: number) => (string | number)[],
  message: (item: T) => string,
) {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const k = key(item);
    if (seen.has(k)) ctx.addIssue({ code: "custom", path: path(i), message: message(item) });
    seen.add(k);
  });
}

function uniqueIds<T extends { id: string }>(items: T[], ctx: z.RefinementCtx) {
  rejectDuplicates(items, ctx, (i) => i.id, (i) => [i, "id"], () => "Duplicate entry id.");
}

const tagList = (what: string) =>
  z
    .array(requiredText(LIMITS.tag, "Enter a value."))
    .max(LIMITS.tags, `Add at most ${LIMITS.tags} ${what}.`)
    .superRefine((items, ctx) =>
      rejectDuplicates(items, ctx, comparisonKey, (i) => [i], (v) => `“${v}” is already listed.`),
    );

const entryId = z.uuid("Invalid entry id.");

// -----------------------------------------------------------------------------
// Ideal customer
// -----------------------------------------------------------------------------

const employees = z
  .number("Enter a number.")
  .int("Use a whole number.")
  .min(0, "Use 0 or more.")
  .max(LIMITS.maxEmployees, `Use ${LIMITS.maxEmployees.toLocaleString("en")} or fewer.`)
  .nullable();

export const companySizeSchema = z
  .strictObject({ minEmployees: employees, maxEmployees: employees })
  .superRefine((v, ctx) => {
    if (v.minEmployees !== null && v.maxEmployees !== null && v.minEmployees > v.maxEmployees) {
      ctx.addIssue({ code: "custom", path: ["maxEmployees"], message: "Maximum must be at least the minimum." });
    }
  });

export const idealCustomerSchema = z.strictObject({
  industries: tagList("industries or categories"),
  companySize: companySizeSchema,
  characteristics: tagList("characteristics"),
  keywords: tagList("keywords"),
  notes: optionalText(LIMITS.notes),
});

/** What the ICP editor saves: profile name + description (columns) + ideal_customer (jsonb). */
export const idealCustomerSectionSchema = z.strictObject({
  name: requiredText(LIMITS.profileName, "Enter a profile name."),
  description: optionalText(LIMITS.description),
  idealCustomer: idealCustomerSchema,
});

// -----------------------------------------------------------------------------
// Geographies
// -----------------------------------------------------------------------------

/**
 * A manual geographic target. Country is required (ISO 3166-1 alpha-2), so a
 * region or city is never ambiguous; region and city are optional free text,
 * which keeps the model independent of any one country's subdivisions.
 * countryName is derived on the server; label is an optional display override.
 */
export const geographySchema = z
  .object({
    id: entryId,
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCountryCode, "Choose a country."),
    region: optionalPlace(LIMITS.place),
    city: optionalPlace(LIMITS.place),
    label: optionalPlace(LIMITS.geographyLabel).optional().transform((v) => v ?? null),
  })
  .transform((g) => ({
    id: g.id,
    countryCode: g.countryCode,
    countryName: countryName(g.countryCode),
    region: g.region,
    city: g.city,
    label: g.label,
  }));

export const geographiesSchema = z
  .array(geographySchema)
  .max(LIMITS.geographies, `Add at most ${LIMITS.geographies} geographies.`)
  .superRefine((items, ctx) => {
    uniqueIds(items, ctx);
    rejectDuplicates(
      items,
      ctx,
      (g) => [g.countryCode, comparisonKey(g.region ?? ""), comparisonKey(g.city ?? "")].join("|"),
      (i) => [i],
      (g) => `${geographyLabel(g)} is already a target.`,
    );
  });

export function geographyLabel(g: { countryName: string; region: string | null; city: string | null; label?: string | null }): string {
  return g.label || [g.city, g.region, g.countryName].filter(Boolean).join(", ");
}

export function geographyScope(g: { region: string | null; city: string | null }): "city" | "region" | "country" {
  return g.city ? "city" : g.region ? "region" : "country";
}

// -----------------------------------------------------------------------------
// Decision-maker titles
// -----------------------------------------------------------------------------

export const DECISION_MAKER_PRIORITIES = ["primary", "secondary", "fallback"] as const;
export type DecisionMakerPriority = (typeof DECISION_MAKER_PRIORITIES)[number];

export const SENIORITY_HINTS = ["executive", "director", "manager", "individual_contributor"] as const;
export type SeniorityHint = (typeof SENIORITY_HINTS)[number];

export const decisionMakerSchema = z.strictObject({
  id: entryId,
  title: requiredText(LIMITS.title, "Enter a title."),
  priority: z.enum(DECISION_MAKER_PRIORITIES, "Choose a priority."),
  seniority: z.enum(SENIORITY_HINTS, "Choose a seniority level.").nullable(),
});

export const decisionMakersSchema = z
  .array(decisionMakerSchema)
  .max(LIMITS.titles, `Add at most ${LIMITS.titles} roles.`)
  .superRefine((items, ctx) => {
    uniqueIds(items, ctx);
    rejectDuplicates(items, ctx, (d) => comparisonKey(d.title), (i) => [i, "title"], (d) => `“${d.title}” is already listed.`);
  });

// -----------------------------------------------------------------------------
// Buying and exclusion signals
// -----------------------------------------------------------------------------

const points = (what: string) =>
  z.number(`Enter a ${what}.`).int("Use a whole number.").min(1, "Use 1 to 100.").max(100, "Use 1 to 100.");

export const buyingSignalSchema = z.strictObject({
  id: entryId,
  name: requiredText(LIMITS.signalName, "Enter a signal name."),
  description: optionalText(LIMITS.signalDescription),
  weight: points("weight"),
  enabled: z.boolean(),
});

export const buyingSignalsSchema = z
  .array(buyingSignalSchema)
  .max(LIMITS.signals, `Add at most ${LIMITS.signals} signals.`)
  .superRefine((items, ctx) => {
    uniqueIds(items, ctx);
    rejectDuplicates(items, ctx, (s) => comparisonKey(s.name), (i) => [i, "name"], (s) => `“${s.name}” is already listed.`);
  });

export const EXCLUSION_BEHAVIORS = ["hard_exclude", "penalty"] as const;
export type ExclusionBehavior = (typeof EXCLUSION_BEHAVIORS)[number];

export const exclusionSignalSchema = z
  .strictObject({
    id: entryId,
    name: requiredText(LIMITS.signalName, "Enter an exclusion name."),
    description: optionalText(LIMITS.signalDescription),
    behavior: z.enum(EXCLUSION_BEHAVIORS, "Choose what happens."),
    penalty: points("penalty").nullable(),
    enabled: z.boolean(),
  })
  .superRefine((s, ctx) => {
    if (s.behavior === "penalty" && s.penalty === null) {
      ctx.addIssue({ code: "custom", path: ["penalty"], message: "Enter a penalty from 1 to 100." });
    }
    if (s.behavior === "hard_exclude" && s.penalty !== null) {
      ctx.addIssue({ code: "custom", path: ["penalty"], message: "A hard exclusion has no penalty." });
    }
  });

export const exclusionSignalsSchema = z
  .array(exclusionSignalSchema)
  .max(LIMITS.signals, `Add at most ${LIMITS.signals} exclusions.`)
  .superRefine((items, ctx) => {
    uniqueIds(items, ctx);
    rejectDuplicates(items, ctx, (s) => comparisonKey(s.name), (i) => [i, "name"], (s) => `“${s.name}” is already listed.`);
  });

// -----------------------------------------------------------------------------
// Scoring model
// -----------------------------------------------------------------------------

export const SCORING_CATEGORIES = ["company_fit", "geography_fit", "decision_maker_fit", "buying_signal_fit"] as const;
export type ScoringCategory = (typeof SCORING_CATEGORIES)[number];

const threshold = z.number("Enter a number.").int("Use a whole number.");
const categoryWeight = z.number("Enter a number.").int("Use a whole number.").min(0, "Use 0 to 100.").max(100, "Use 0 to 100.");

/**
 * Grades: A = score >= a, B = score >= b, C = below b (scores are 0–100).
 * 1 <= b < a <= 100 keeps every range non-empty and non-overlapping.
 * Category weights are percentages of the future fit score and sum to 100.
 */
export const scoringModelSchema = z
  .strictObject({
    thresholds: z.strictObject({ a: threshold, b: threshold }),
    categoryWeights: z.strictObject({
      company_fit: categoryWeight,
      geography_fit: categoryWeight,
      decision_maker_fit: categoryWeight,
      buying_signal_fit: categoryWeight,
    }),
  })
  .superRefine((m, ctx) => {
    const { a, b } = m.thresholds;
    if (a > 100 || a < 2) ctx.addIssue({ code: "custom", path: ["thresholds", "a"], message: "Use 2 to 100." });
    if (b < 1 || b > 99) ctx.addIssue({ code: "custom", path: ["thresholds", "b"], message: "Use 1 to 99." });
    if (a <= b) {
      ctx.addIssue({ code: "custom", path: ["thresholds", "a"], message: "The A threshold must be higher than the B threshold." });
    }
    const total = SCORING_CATEGORIES.reduce((sum, c) => sum + m.categoryWeights[c], 0);
    if (total !== 100) {
      ctx.addIssue({ code: "custom", path: ["categoryWeights"], message: `Weights must add up to 100 (currently ${total}).` });
    }
  });

/** Starting values offered in an unsaved scoring editor. Saved only when the user saves. */
export const SUGGESTED_SCORING_MODEL: ScoringModel = {
  thresholds: { a: 75, b: 50 },
  categoryWeights: { company_fit: 40, geography_fit: 20, decision_maker_fit: 20, buying_signal_fit: 20 },
};

export type GradeBand = { grade: "A" | "B" | "C"; min: number; max: number; meaning: string };

export function gradeBands(thresholds: { a: number; b: number }): GradeBand[] {
  return [
    { grade: "A", min: thresholds.a, max: 100, meaning: "Strongest fit" },
    { grade: "B", min: thresholds.b, max: thresholds.a - 1, meaning: "Reasonable fit" },
    { grade: "C", min: 0, max: thresholds.b - 1, meaning: "Weaker fit" },
  ];
}

// -----------------------------------------------------------------------------
// Types and section inputs
// -----------------------------------------------------------------------------

export type IdealCustomer = z.output<typeof idealCustomerSchema>;
export type Geography = z.output<typeof geographySchema>;
export type DecisionMaker = z.output<typeof decisionMakerSchema>;
export type BuyingSignal = z.output<typeof buyingSignalSchema>;
export type ExclusionSignal = z.output<typeof exclusionSignalSchema>;
export type ScoringModel = z.output<typeof scoringModelSchema>;

export const ICP_SECTIONS = [
  "ideal_customer",
  "geographies",
  "decision_makers",
  "buying_signals",
  "exclusion_signals",
  "scoring",
] as const;
export type IcpSection = (typeof ICP_SECTIONS)[number];

export const icpSectionValueSchemas = {
  ideal_customer: idealCustomerSectionSchema,
  geographies: geographiesSchema,
  decision_makers: decisionMakersSchema,
  buying_signals: buyingSignalsSchema,
  exclusion_signals: exclusionSignalsSchema,
  scoring: scoringModelSchema,
} as const;

export type IcpSectionValue<S extends IcpSection> = z.output<(typeof icpSectionValueSchemas)[S]>;

/** Mutation envelope sent by the editors. profileId/revision are null when no profile exists yet. */
export const icpSectionInputSchema = z.discriminatedUnion("section", [
  z.strictObject({ section: z.literal("ideal_customer"), profileId: z.uuid().nullable(), revision: z.int().min(1).nullable(), value: idealCustomerSectionSchema }),
  z.strictObject({ section: z.literal("geographies"), profileId: z.uuid().nullable(), revision: z.int().min(1).nullable(), value: geographiesSchema }),
  z.strictObject({ section: z.literal("decision_makers"), profileId: z.uuid().nullable(), revision: z.int().min(1).nullable(), value: decisionMakersSchema }),
  z.strictObject({ section: z.literal("buying_signals"), profileId: z.uuid().nullable(), revision: z.int().min(1).nullable(), value: buyingSignalsSchema }),
  z.strictObject({ section: z.literal("exclusion_signals"), profileId: z.uuid().nullable(), revision: z.int().min(1).nullable(), value: exclusionSignalsSchema }),
  z.strictObject({ section: z.literal("scoring"), profileId: z.uuid().nullable(), revision: z.int().min(1).nullable(), value: scoringModelSchema }),
]);

export type IcpSectionInput = z.input<typeof icpSectionInputSchema>;
export type ParsedIcpSectionInput = z.output<typeof icpSectionInputSchema>;

/** The default profile as the UI sees it. A null section has never been saved. */
export type IcpProfileConfig = {
  id: string;
  name: string;
  description: string | null;
  revision: number;
  idealCustomer: IdealCustomer | null;
  geographies: Geography[] | null;
  decisionMakers: DecisionMaker[] | null;
  buyingSignals: BuyingSignal[] | null;
  exclusionSignals: ExclusionSignal[] | null;
  scoringModel: ScoringModel | null;
};

export const EMPTY_IDEAL_CUSTOMER: IdealCustomer = {
  industries: [],
  companySize: { minEmployees: null, maxEmployees: null },
  characteristics: [],
  keywords: [],
  notes: null,
};

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/** Field errors keyed by dotted issue path ("" for the whole value). First message per path wins. */
export type FieldErrors = Record<string, string>;

export function issuesToFieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    out[key] ??= issue.message;
  }
  return out;
}
