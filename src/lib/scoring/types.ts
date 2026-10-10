import type { BuyingSignal, DecisionMaker, ExclusionSignal, Geography, IdealCustomer, ScoringCategory, ScoringModel } from "@/lib/config/icp";

/**
 * Scoring types (P1-E6). The evaluator receives ONLY normalized durable facts
 * (ScoringInput) and returns an Evaluation; it never touches a database,
 * provider, browser state or clock.
 */

export type ScoringInput = {
  /** SHA-256 of the canonical input document this DTO was built from (public.scoring_input). */
  fingerprint: string;
  company: {
    id: string;
    name: string;
    industry: string | null;
    description: string | null;
    employeeMin: number | null;
    employeeMax: number | null;
    country: string | null;
    region: string | null;
    city: string | null;
  };
  /** Provider-neutral company tag evidence values. */
  tags: string[];
  /** Active contacts (not archived, not "left company"): only their titles matter for scoring. */
  contacts: { title: string | null }[];
  /** Structured observations for this ICP revision (unknown = absent from the list). */
  signals: { kind: "buying" | "exclusion"; id: string; state: "present" | "absent" }[];
  icp: {
    id: string;
    revision: number;
    idealCustomer: IdealCustomer | null;
    geographies: Geography[] | null;
    decisionMakers: DecisionMaker[] | null;
    buyingSignals: BuyingSignal[] | null;
    exclusionSignals: ExclusionSignal[] | null;
    scoringModel: ScoringModel | null;
  };
};

export type ItemResult = "matched" | "partial" | "not_matched" | "unknown";

/** One short, deterministic explanation line. */
export type ExplanationItem = { criterion: string; result: ItemResult; detail: string };

export type CategoryResult = {
  key: ScoringCategory;
  configured: boolean;
  /** Raw 0–100 (null when not configured). */
  raw: number | null;
  /** The user's configured weight (authoritative, never rewritten). */
  configuredWeight: number;
  /** Share of the score after excluding unconfigured categories (percent, null when not configured). */
  effectiveWeight: number | null;
  /** Points this category adds to the base score. */
  contribution: number;
  coverage: { known: number; total: number };
  items: ExplanationItem[];
};

export type MissingItem = { key: "industry" | "size" | "text" | "location" | "contacts" | "buying_signals" | "exclusions"; label: string };

export type ExclusionHit = { id: string; name: string; behavior: "hard_exclude" | "penalty"; penalty: number | null };

export type Evaluation =
  | { outcome: "not_evaluable"; reason: "no_scoring_model" | "no_criteria"; inputFingerprint: string }
  | {
      outcome: "scored" | "excluded";
      /** Final score 0–100 (Math.round of base − penalties, clamped); null when hard-excluded. */
      score: number | null;
      /** Weighted score before penalties (rounded), shown for explanation. */
      baseScore: number;
      grade: "A" | "B" | "C" | null;
      coveragePercent: number;
      categories: Record<ScoringCategory, CategoryResult>;
      exclusionPenalty: number;
      penalties: ExclusionHit[];
      hardExclusions: ExclusionHit[];
      exclusionItems: ExplanationItem[];
      /** What is unknown, as short phrases ("Company size", "2 buying-signal observations"). */
      missing: MissingItem[];
      thresholds: { a: number; b: number };
      inputFingerprint: string;
    };
