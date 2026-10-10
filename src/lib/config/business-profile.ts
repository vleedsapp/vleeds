import { z } from "zod";
import { isValidTimeZone } from "./timezone";

/**
 * Validation for a workspace's business profile. Shared by workspace creation
 * and the Settings editor; mirrors the CHECK constraints on public.workspaces.
 */

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// null is accepted as empty: editors validate locally and send the parsed value
// (empty → null), which the server action validates again.
export const optionalText = (max: number) =>
  z
    .preprocess((v) => (v === null ? "" : v), z.string().trim().max(max, `Use ${max} characters or fewer.`))
    .transform((v) => (v === "" ? null : v));

/** Accepts "Example.com", "https://example.com/path"; stores "example.com". */
export const primaryDomainField = optionalText(253)
  .transform((v) => v?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") ?? null)
  .refine((v) => v === null || DOMAIN_RE.test(v), { message: "Enter a domain like example.com." });

export const websiteUrlField = optionalText(2048).refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), {
  message: "Enter a full URL starting with https://",
});

export const workspaceNameField = z.string().trim().min(1, "Enter a workspace name.").max(120, "Use 120 characters or fewer.");

export const businessProfileSchema = z.strictObject({
  name: workspaceNameField,
  primaryDomain: primaryDomainField,
  websiteUrl: websiteUrlField,
  description: optionalText(2000),
  /** IANA zone that defines the workspace's "today" (P1-E7). */
  timezone: z.string().refine((v) => isValidTimeZone(v), { message: "Choose a time zone from the list." }),
});

export type BusinessProfileInput = z.input<typeof businessProfileSchema>;
export type BusinessProfile = z.output<typeof businessProfileSchema>;
