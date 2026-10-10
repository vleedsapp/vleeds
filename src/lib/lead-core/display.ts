import type { Tone } from "@/components/ui/primitives";
import { countryName } from "@/lib/config/countries";
import {
  KNOWN_FIELD_KEYS,
  type CompanyLocation,
  type ContactStatus,
  type QualificationState,
  type SourceKind,
} from "./schemas";

/** Display labels for lead-core values. Text always carries the meaning; tone is supplementary. */

export const QUALIFICATION_LABEL: Record<QualificationState, { label: string; tone: Tone }> = {
  unreviewed: { label: "Unreviewed", tone: "neutral" },
  needs_review: { label: "Needs review", tone: "warning" },
  qualified: { label: "Qualified", tone: "brand" },
  unqualified: { label: "Unqualified", tone: "danger" },
};

export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  active: "Active",
  left_company: "Left company",
  unknown: "Status unknown",
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  manual: "Manual",
  csv: "CSV import",
  public_dataset: "Public dataset",
  website: "Website",
  api: "API",
  other: "Other",
};

export function fieldLabel(fieldKey: string | null): string {
  if (!fieldKey) return "General";
  return (KNOWN_FIELD_KEYS as Record<string, string>)[fieldKey] ?? fieldKey.replace(/^(company|contact)\./, "").replace(/_/g, " ");
}

/** "City, Region, Country" (whatever parts exist). */
export function formatLocation(location: CompanyLocation | null): string | null {
  if (!location) return null;
  const parts = [location.city, location.region, location.countryCode ? countryName(location.countryCode) : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Full postal-style address for the drawer. */
export function formatAddress(location: CompanyLocation | null): string | null {
  if (!location) return null;
  const parts = [
    location.addressLine1,
    location.addressLine2,
    [location.postalCode, location.city].filter(Boolean).join(" "),
    location.region,
    location.countryCode ? countryName(location.countryCode) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function formatEmployees(min: number | null, max: number | null): string | null {
  const f = (n: number) => n.toLocaleString("en");
  if (min !== null && max !== null) return min === max ? `${f(min)} employees` : `${f(min)}–${f(max)} employees`;
  if (min !== null) return `${f(min)}+ employees`;
  if (max !== null) return `Up to ${f(max)} employees`;
  return null;
}

/** Short, locale-stable date ("8 Oct 2026") rendered on the server. */
export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Compact text for an observed evidence value. */
export function formatObserved(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const json = JSON.stringify(value);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}
