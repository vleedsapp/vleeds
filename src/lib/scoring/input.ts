import { z } from "zod";
import {
  buyingSignalsSchema,
  decisionMakersSchema,
  exclusionSignalsSchema,
  geographiesSchema,
  idealCustomerSchema,
  scoringModelSchema,
} from "@/lib/config/icp";
import type { ScoringInput } from "./types";

/**
 * public.scoring_input() document → ScoringInput. The database assembles the
 * canonical document (and its fingerprint); this only validates and types it.
 * An ICP section that doesn't match its schema is treated as not configured
 * (the same rule Settings uses), never guessed.
 */

const str = z.string().nullable().optional().transform((v) => v ?? null);
const int = z.number().int().nullable().optional().transform((v) => v ?? null);

const docSchema = z.object({
  input: z.object({
    v: z.literal(1),
    company: z.object({
      id: z.string(),
      name: z.string(),
      industry: str,
      description: str,
      employee_count_min: int,
      employee_count_max: int,
      country: str,
      region: str,
      city: str,
    }),
    tags: z.array(z.string()).max(1000),
    contacts: z.array(z.object({ title: str })).max(5000),
    signals: z.array(z.object({ kind: z.enum(["buying", "exclusion"]), id: z.string(), state: z.enum(["present", "absent"]) })).max(500),
    icp: z.object({
      id: z.string(),
      revision: z.number().int(),
      ideal_customer: z.unknown().nullable().optional(),
      target_geographies: z.unknown().nullable().optional(),
      decision_maker_titles: z.unknown().nullable().optional(),
      buying_signals: z.unknown().nullable().optional(),
      exclusion_signals: z.unknown().nullable().optional(),
      scoring_model: z.unknown().nullable().optional(),
    }),
  }),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

function section<T>(schema: z.ZodType<T>, value: unknown): T | null {
  if (value === null || value === undefined) return null;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseScoringInput(raw: unknown): ScoringInput | null {
  const parsed = docSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { input, fingerprint } = parsed.data;
  const c = input.company;
  return {
    fingerprint,
    company: {
      id: c.id,
      name: c.name,
      industry: c.industry,
      description: c.description,
      employeeMin: c.employee_count_min,
      employeeMax: c.employee_count_max,
      country: c.country,
      region: c.region,
      city: c.city,
    },
    tags: input.tags,
    contacts: input.contacts,
    signals: input.signals,
    icp: {
      id: input.icp.id,
      revision: input.icp.revision,
      idealCustomer: section(idealCustomerSchema, input.icp.ideal_customer),
      geographies: section(geographiesSchema, input.icp.target_geographies),
      decisionMakers: section(decisionMakersSchema, input.icp.decision_maker_titles),
      buyingSignals: section(buyingSignalsSchema, input.icp.buying_signals),
      exclusionSignals: section(exclusionSignalsSchema, input.icp.exclusion_signals),
      scoringModel: section(scoringModelSchema, input.icp.scoring_model),
    },
  };
}
