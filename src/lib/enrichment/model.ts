import { z } from "zod";
import { normalizeDomain } from "@/lib/lead-core/normalize";

/**
 * Company-enrichment rules shared by the server actions, the DAL and the UI
 * (P1-E4). Pure (no I/O), so they are unit-tested directly. Provider-neutral.
 */

export const ENRICHMENT_RUN_STATUSES = ["draft", "resolving_domain", "domain_review", "enriching", "review", "processing", "completed", "cancelled", "failed"] as const;
export type EnrichmentRunStatus = (typeof ENRICHMENT_RUN_STATUSES)[number];

export const ENRICHMENT_INPUT_KINDS = ["discovery_reference", "manual_name", "domain", "existing_company"] as const;
export type EnrichmentInputKind = (typeof ENRICHMENT_INPUT_KINDS)[number];

export const ENRICHMENT_MATCH_STATES = ["new", "existing_company", "possible_duplicate"] as const;
export type EnrichmentMatchState = (typeof ENRICHMENT_MATCH_STATES)[number];

export const ENRICHMENT_DECISIONS = ["create", "merge", "skip"] as const;
export type EnrichmentDecision = (typeof ENRICHMENT_DECISIONS)[number];

export const runIsFinal = (s: EnrichmentRunStatus) => s === "completed" || s === "cancelled";

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

/** Hunter-style Domain Finder needs at least 3 characters; Vleeds applies the same floor for every provider. */
export const MIN_LOOKUP_NAME = 3;

export const companyNameSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(MIN_LOOKUP_NAME, `Enter at least ${MIN_LOOKUP_NAME} characters of the company name.`).max(200, "Use 200 characters or fewer."));

/** Any domain-ish input ("https://www.Example.com/about") → its normalized host (lead-core rule). */
export const domainInputSchema = z
  .string()
  .max(300, "Enter a domain like example.com.")
  .transform((v, ctx) => {
    const d = normalizeDomain(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Enter a domain like example.com." });
      return z.NEVER;
    }
    return d;
  });

export const lookupSchema = z.discriminatedUnion("by", [
  z.strictObject({ by: z.literal("name"), companyName: companyNameSchema }),
  z.strictObject({ by: z.literal("domain"), domain: domainInputSchema }),
]);
export type Lookup = z.output<typeof lookupSchema>;

/**
 * How an enrichment starts.
 *  discovery: a selected discovery reference. The company name, if given, is
 *             TRANSIENT provider content from the open search (or typed by the
 *             user for an older reference): it is used for this one domain
 *             lookup and never stored.
 *  manual:    a name or domain typed on Discover.
 *  existing:  an existing Vleeds company (its domain, or a name/domain typed).
 */
export const startEnrichmentSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("discovery"), discoveryRunId: z.uuid(), candidateId: z.uuid(), lookup: lookupSchema }),
  z.strictObject({ source: z.literal("manual"), lookup: lookupSchema }),
  z.strictObject({ source: z.literal("existing"), companyId: z.uuid(), lookup: lookupSchema }),
]);
export type StartEnrichmentInput = z.output<typeof startEnrichmentSchema>;

export function inputKindFor(input: StartEnrichmentInput): EnrichmentInputKind {
  if (input.source === "discovery") return "discovery_reference";
  if (input.source === "existing") return "existing_company";
  return input.lookup.by === "name" ? "manual_name" : "domain";
}

/**
 * The name that may be STORED on the run. Never for discovery references
 * (that name may be transient provider content).
 */
export function storableName(input: StartEnrichmentInput): string | null {
  if (input.source === "discovery" || input.lookup.by !== "name") return null;
  return input.lookup.companyName;
}

export const decisionSchema = z.enum(ENRICHMENT_DECISIONS, "Choose what should happen.");

// -----------------------------------------------------------------------------
// Decisions
// -----------------------------------------------------------------------------

/**
 * Same rule as CSV duplicate review: a strong identity (provider id, domain,
 * or the company the enrichment was started from) means it IS that company,
 * so "create separately" is not offered.
 */
export function allowedEnrichmentDecisions(matchState: EnrichmentMatchState): EnrichmentDecision[] {
  if (matchState === "new") return ["create", "skip"];
  if (matchState === "existing_company") return ["merge", "skip"];
  return ["merge", "skip", "create"];
}

export const suggestedDecision = (m: EnrichmentMatchState): EnrichmentDecision | null =>
  m === "new" ? "create" : m === "existing_company" ? "merge" : null;

// -----------------------------------------------------------------------------
// What the browser receives
// -----------------------------------------------------------------------------

export type ReviewFieldView = { key: string; label: string; incoming: string | null; existing: string | null; outcome: "new" | "fill" | "same" | "keep" | "none" };

/**
 * The state of one enrichment for the sheet. `suggestions` are provider
 * domain suggestions for this response only (never stored).
 */
export type EnrichmentView = {
  runId: string;
  status: EnrichmentRunStatus;
  inputKind: EnrichmentInputKind;
  providerLabel: string;
  requestedDomain: string | null;
  suggestions: { domain: string; companyName: string | null; confidenceLabel: string | null; emailCount: number | null }[];
  error: { code: string; message: string; retry: boolean } | null;
  review: {
    fields: ReviewFieldView[];
    matchState: EnrichmentMatchState;
    matchText: string;
    matched: { id: string; name: string } | null;
    allowed: EnrichmentDecision[];
    decision: EnrichmentDecision | null;
    tags: string[];
  } | null;
  outcome: {
    commitResult: "created" | "merged" | "skipped";
    companyId: string | null;
    companyName: string | null;
    evidenceAdded: number;
    identityLinked: boolean;
    notes: string[];
  } | null;
  /** Estimated credits this enrichment has used so far (millis). */
  creditsUsedMillis: number;
  /** Estimated credits one company enrichment costs (millis), for the confirm button. */
  enrichmentEstimateMillis: number | null;
};

export type EnrichmentActionResult = { ok: true; view: EnrichmentView } | { ok: false; error: string; code: string; view: EnrichmentView | null };

// -----------------------------------------------------------------------------
// Display
// -----------------------------------------------------------------------------

/** 200 → "0.2", 1400 → "1.4", 0 → "0" (credits are estimates; never more precise than 0.1). */
export function formatCredits(millis: number): string {
  const v = Math.round(millis / 100) / 10;
  return v.toLocaleString("en", { maximumFractionDigits: 1 });
}

export const ENRICHMENT_MESSAGES: Record<string, string> = {
  not_configured: "Company enrichment is not configured yet.",
  invalid_name: `Enter at least ${MIN_LOOKUP_NAME} characters of the company name.`,
  no_suggestions: "No domain suggestions were found for this name. Enter the company's domain if you know it.",
  not_found: "{provider} couldn't find company data for this domain.",
  quota_exhausted: "The enrichment provider's monthly quota for this account appears to be used up. Usage resets with the provider's plan; check the provider account for details.",
  rate_limited: "The enrichment provider is limiting requests right now. Wait a minute and try again.",
  timeout: "The enrichment provider took too long to respond. Try again in a moment.",
  unavailable: "The enrichment provider is temporarily unavailable. Try again in a moment.",
  malformed: "The provider returned something Vleeds couldn't read. Try again.",
  setup: "The enrichment provider rejected the request. Its setup (API key) needs checking by an owner.",
  invalid_request: "The provider couldn't use this input. Check the name or domain and try again.",
  restricted: "This data isn't available from the provider.",
  unusable: "The provider's answer didn't include enough company data to use.",
  storage: "The result couldn't be saved. Try again.",
  target_gone: "The company is no longer available in this workspace.",
  conflict: "Another active company already has this domain.",
  stale: "This enrichment changed in the meantime. Close it and try again.",
  decision: "That choice isn't available for this result.",
  reference_linked: "This reference is already linked to a company.",
};

/** Fixed, calm text for a code ({provider} = the provider's label). Never a raw provider message. */
export function enrichmentMessage(code: string, providerLabel: string): string {
  return (ENRICHMENT_MESSAGES[code] ?? "Something went wrong. Try again.").replace("{provider}", providerLabel);
}
