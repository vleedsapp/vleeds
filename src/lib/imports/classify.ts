import { matchCompany, type CompanyMatchReason, type KnownCompany } from "@/lib/lead-core/dedupe";
import type { StagedRow } from "./rows";

/**
 * Classifies staged rows with the P1-E1 matching hierarchy (dedupe.ts),
 * against the workspace's existing companies AND earlier rows of the same
 * file (so a file that lists a company twice doesn't try to create it twice).
 *
 *   matched            strong identity (provider id / domain): suggested Merge;
 *                      "Create separately" is not allowed
 *   possible_duplicate weaker signal (phone / name + place): the user decides
 *   new                no match: suggested Create
 *   invalid            row has errors: can only be skipped
 *
 * Contacts are matched at commit time against the then-current data
 * (see commit.ts), so rows earlier in the same file are taken into account.
 */

export type MatchState = "unprocessed" | "new" | "possible_duplicate" | "matched" | "invalid";
export type Decision = "create" | "merge" | "skip";

export const DECISION_LABEL: Record<Decision, string> = { create: "Create new", merge: "Merge", skip: "Skip" };

export type ClassifyInput = { id: string; rowNumber: number; staged: StagedRow; valid: boolean };

export type Classification = {
  matchState: MatchState;
  matchReason: CompanyMatchReason | null;
  matchedCompanyId: string | null;
  matchedRowId: string | null;
  decision: Decision | null;
};

const ROW = "row:";

export function classifyRows(rows: ClassifyInput[], known: KnownCompany[]): Map<string, Classification> {
  const out = new Map<string, Classification>();
  const fromFile: KnownCompany[] = [];

  for (const row of [...rows].sort((a, b) => a.rowNumber - b.rowNumber)) {
    const c = row.staged.company;
    if (!row.valid || !c) {
      out.set(row.id, { matchState: "invalid", matchReason: null, matchedCompanyId: null, matchedRowId: null, decision: "skip" });
      continue;
    }
    const result = matchCompany(
      { name: c.canonicalName, domain: c.primaryDomain, phone: c.primaryPhone, location: c.location },
      [...known, ...fromFile],
    );
    const target = (id: string) =>
      id.startsWith(ROW) ? { matchedCompanyId: null, matchedRowId: id.slice(ROW.length) } : { matchedCompanyId: id, matchedRowId: null };

    if (result.outcome === "match") {
      out.set(row.id, { matchState: "matched", matchReason: result.reason, ...target(result.id), decision: "merge" });
    } else if (result.outcome === "review") {
      out.set(row.id, { matchState: "possible_duplicate", matchReason: result.reason, ...target(result.ids[0]), decision: null });
    } else {
      out.set(row.id, { matchState: "new", matchReason: null, matchedCompanyId: null, matchedRowId: null, decision: "create" });
    }

    // Rows that will create a company become candidates for later rows.
    if (result.outcome === "new") {
      fromFile.push({
        id: `${ROW}${row.id}`,
        primaryDomain: c.primaryDomain,
        primaryPhoneNormalized: c.primaryPhoneNormalized,
        normalizedName: c.normalizedName,
        location: c.location,
        externalIds: [],
      });
    }
  }
  return out;
}

/** Decisions a user may choose for a row, given its match. */
export function allowedDecisions(matchState: MatchState): Decision[] {
  switch (matchState) {
    case "new":
      return ["create", "skip"];
    case "matched":
      // A strong identity (domain / provider id) means it IS that company: merge or skip.
      return ["merge", "skip"];
    case "possible_duplicate":
      return ["merge", "skip", "create"];
    default:
      return ["skip"];
  }
}

export function isDecisionAllowed(matchState: MatchState, decision: Decision): boolean {
  return allowedDecisions(matchState).includes(decision);
}
