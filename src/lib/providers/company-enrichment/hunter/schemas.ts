import { z } from "zod";

/**
 * The parts of Hunter's responses Vleeds reads. Everything else in a response
 * (emails, social handles, funding, traffic, technology, logos, …) is ignored
 * by these schemas and never leaves the adapter. Unknown fields are allowed
 * (Hunter adds fields over time); a body that isn't this shape is "malformed".
 *
 * Domain Finder is documented as Beta: its shape is isolated here and mapped
 * to the generic DomainSuggestion immediately.
 */

const str = z.string().optional().nullable();
const num = z.number().optional().nullable();

export const domainFinderResponseSchema = z.object({
  data: z
    .array(
      z.object({
        domain: str,
        company_name: str,
        email_count: num,
      }),
    )
    .max(50),
});

export const companyResponseSchema = z.object({
  data: z.object({
    id: z.union([z.string(), z.number()]).optional().nullable(),
    name: str,
    legalName: str,
    domain: str,
    description: str,
    phone: str,
    tags: z.array(z.unknown()).optional().nullable(),
    site: z.object({ phoneNumbers: z.array(z.unknown()).optional().nullable() }).partial().optional().nullable(),
    category: z.object({ industry: str }).partial().optional().nullable(),
    geo: z
      .object({
        streetAddress: str,
        streetNumber: str,
        streetName: str,
        city: str,
        postalCode: str,
        state: str,
        stateCode: str,
        country: str,
        countryCode: str,
      })
      .partial()
      .optional()
      .nullable(),
    metrics: z
      .object({
        employees: z.union([z.string(), z.number()]).optional().nullable(),
        employeesCount: num,
      })
      .partial()
      .optional()
      .nullable(),
  }),
});

export type HunterCompany = z.output<typeof companyResponseSchema>["data"];
