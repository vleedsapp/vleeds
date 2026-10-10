import { z } from "zod";
import { isCountryCode } from "@/lib/config/countries";
import type { ResultAttribution } from "@/lib/providers/company-discovery/types";

/**
 * Discovery domain rules shared by the server actions, the DAL and the UI.
 * Pure (no I/O), so they are unit-tested directly. Generic: no industry,
 * place or provider is assumed beyond the provider key passed in.
 */

export const RUN_STATUSES = ["running", "review", "completed", "cancelled", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const CANDIDATE_DECISIONS = ["unreviewed", "selected", "dismissed", "needs_enrichment"] as const;
export type CandidateDecision = (typeof CANDIDATE_DECISIONS)[number];

export const MATCH_STATES = ["new", "seen_before", "existing_company"] as const;
export type CandidateMatchState = (typeof MATCH_STATES)[number];

export const PAGE_SIZES = [5, 10, 20] as const;

// -----------------------------------------------------------------------------
// Search input
// -----------------------------------------------------------------------------

const place = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .pipe(z.string().max(120, "Use 120 characters or fewer."))
  .nullable()
  .transform((v) => v || null);

/** Where to search: one of the ICP's geographies (by id), a location typed by the user, or nowhere specific. */
export const geographyChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("icp"), id: z.uuid() }),
  z.strictObject({
    kind: z.literal("custom"),
    countryCode: z.string().trim().toUpperCase().refine(isCountryCode, "Choose a country."),
    region: place,
    city: place,
  }),
  z.strictObject({ kind: z.literal("none") }),
]);

export const discoverySearchSchema = z.strictObject({
  icpProfileId: z.uuid().nullable(),
  query: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(2, "Describe what you are looking for (at least 2 characters).").max(120, "Use 120 characters or fewer.")),
  geography: geographyChoiceSchema,
  pageSize: z.union([z.literal(5), z.literal(10), z.literal(20)]),
});
export type DiscoverySearchRequest = z.output<typeof discoverySearchSchema>;

/** A continuation cursor from the browser: opaque provider text, bounded, never stored. */
export const cursorSchema = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/, "Invalid cursor.");

// -----------------------------------------------------------------------------
// Candidate status and decisions
// -----------------------------------------------------------------------------

/**
 * What Vleeds can truthfully say about a provider reference, using DURABLE
 * data only (provider identity in lead_sources, earlier discovery runs):
 *   existing_company  the reference is linked to a company in this workspace
 *   seen_before       an earlier search in this workspace found it
 *   new               neither
 * Transient provider content (names, addresses) is never used for matching.
 */
export function candidateMatchState(
  externalId: string,
  linkedCompanies: ReadonlyMap<string, string>,
  seenBefore: ReadonlySet<string>,
): { matchState: CandidateMatchState; matchCompanyId: string | null } {
  const company = linkedCompanies.get(externalId);
  if (company) return { matchState: "existing_company", matchCompanyId: company };
  if (seenBefore.has(externalId)) return { matchState: "seen_before", matchCompanyId: null };
  return { matchState: "new", matchCompanyId: null };
}

export type DecisionAction = "select" | "dismiss" | "reset";
export const decisionActionSchema = z.enum(["select", "dismiss", "reset"]);

/**
 * Selecting a reference that is already a Vleeds company marks it "selected"
 * (it IS that company). Otherwise it becomes "needs_enrichment": Vleeds keeps
 * only the provider reference until a source whose terms allow durable
 * company data fills it in (a later story).
 */
export function decisionFor(action: DecisionAction, matchCompanyId: string | null): CandidateDecision {
  if (action === "dismiss") return "dismissed";
  if (action === "reset") return "unreviewed";
  return matchCompanyId ? "selected" : "needs_enrichment";
}

/** Which runs still accept actions. */
export function runIsOpen(status: RunStatus): boolean {
  return status === "running" || status === "review" || status === "failed";
}

// -----------------------------------------------------------------------------
// What the browser receives for the active search
// -----------------------------------------------------------------------------

/**
 * One candidate in the active search. name/address/category are TRANSIENT
 * provider content: they exist only in this response and the browser's state
 * for the current interaction, and are never written to the database.
 */
export type TransientCandidateView = {
  candidateId: string;
  providerKey: string;
  externalId: string;
  name: string | null;
  address: string | null;
  category: string | null;
  sourceUrl: string | null;
  attributions: ResultAttribution[];
  matchState: CandidateMatchState;
  matchCompanyId: string | null;
  decision: CandidateDecision;
};

export type UsageView = {
  providerLabel: string;
  run: { requests: number; results: number };
  month: { requests: number; results: number };
};

export const PROVIDER_ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Company discovery is not configured yet.",
  timeout: "The search took too long to respond. Try again in a moment.",
  rate_limited: "The discovery provider is limiting requests right now. Wait a minute and try again.",
  setup: "The discovery provider rejected the request. Its setup (API key, enabled API or billing) needs checking by an owner.",
  invalid_request: "The provider couldn't run this search. Adjust the search and try again.",
  unavailable: "The discovery provider is temporarily unavailable. Try again in a moment.",
  malformed: "The provider returned something Vleeds couldn't read. Try again.",
  storage: "The results couldn't be saved to this search. Try again.",
};
