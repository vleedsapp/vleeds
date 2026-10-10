import type { DiscoveryGeography } from "./types";

/**
 * Provider-neutral helpers for building a search. No industry, place or
 * wording is assumed: both the query and the geography come from the user or
 * the workspace's ICP configuration.
 */

/** "City, Region, Country" from the parts that exist (the user's label wins). */
export function geographyText(g: DiscoveryGeography): string {
  return g.label || [g.city, g.region, g.countryName].filter(Boolean).join(", ");
}

/** The text query sent to a text-search provider: "<query> in <geography>". */
export function composeTextQuery(query: string, geography: DiscoveryGeography | null): string {
  const q = query.trim().replace(/\s+/g, " ");
  if (!geography) return q;
  const where = [geography.city, geography.region, geography.countryName].filter(Boolean).join(", ");
  return where ? `${q} in ${where}` : q;
}

/** Clamp a requested page size into what the provider supports. */
export function clampPageSize(requested: number, max: number): number {
  if (!Number.isFinite(requested)) return Math.min(10, max);
  return Math.min(Math.max(Math.trunc(requested), 1), max);
}
