import type { FieldRetention, CandidateField } from "../types";

/**
 * The ONE place that decides which Google Places fields Vleeds requests.
 *
 * Places API (New) requires a field mask, and the fields requested decide the
 * billed SKU. This mask is deliberately small: durable identity + what the
 * discovery review needs to show. Not requested (by design, P1-E3): phone,
 * website, ratings, reviews, photos, opening hours, price level, summaries.
 *
 * SKU (per Google documentation, checked 2026-10-08; pricing can change, so
 * no prices are coded here):
 *   places.id, places.attributions, nextPageToken   → Text Search Essentials (IDs Only)
 *   places.displayName, places.formattedAddress,
 *   places.primaryType                              → Text Search Pro
 * The highest tier among requested fields applies → "Text Search Pro".
 */
export const GOOGLE_PLACES_PROVIDER_KEY = "google_places";

export const GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export const googlePlacesDiscoveryFields = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.primaryType",
  "places.attributions",
  "nextPageToken",
] as const;

/** Value of the X-Goog-FieldMask header (comma-separated, no spaces, never "*"). */
export const googlePlacesDiscoveryFieldMask = googlePlacesDiscoveryFields.join(",");

export const GOOGLE_TEXT_SEARCH_SKU_HINT = "Text Search Pro";
export const GOOGLE_PRICING_REFERENCE = "https://developers.google.com/maps/billing-and-pricing/pricing";

/** Text Search (New) accepts 1–20 results per page and at most 60 per query across pages. */
export const GOOGLE_MAX_PAGE_SIZE = 20;

/**
 * Retention per field under the Google Maps Platform terms as applied by
 * Vleeds: Place IDs are exempt from caching restrictions and may be stored
 * indefinitely; other Places content must not be stored, so it is shown only
 * during the active search.
 */
export const GOOGLE_PLACES_FIELD_RETENTION: Partial<Record<CandidateField, FieldRetention>> = {
  externalId: "durable",
  name: "transient",
  address: "transient",
  category: "transient",
};
