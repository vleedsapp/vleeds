import { z } from "zod";

/**
 * The parts of Hunter's Domain Search response Vleeds reads. Everything else
 * (company pattern/organization data, twitter handles, source URLs and pages,
 * aggregations, …) is ignored by these schemas and never leaves the adapter.
 */
const str = z.string().optional().nullable();

export const personSchema = z.object({
  value: str,
  type: str,
  confidence: z.number().optional().nullable(),
  first_name: str,
  last_name: str,
  position: str,
  seniority: str,
  department: str,
  decision_maker: z.boolean().optional().nullable(),
  linkedin: str,
  phone_number: str,
  verification: z.object({ status: str }).partial().optional().nullable(),
  sources: z
    .array(z.object({ last_seen_on: str }).partial())
    .max(1000)
    .optional()
    .nullable(),
});

export const domainSearchResponseSchema = z.object({
  data: z.object({
    emails: z.array(z.unknown()).max(200).optional().nullable(),
  }),
});

export type HunterPerson = z.output<typeof personSchema>;
