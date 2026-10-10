/**
 * Small FICTIONAL Places API (New) Text Search responses for tests only.
 * Generic names and example.test-style content; never real businesses, never
 * shipped with the application (tests/ is not part of the build).
 */

export const PAGE_ONE = {
  places: [
    {
      id: "fixture-place-001",
      displayName: { text: "Lakeside Bookkeeping", languageCode: "en" },
      formattedAddress: "1 Example Road, Sample City",
      primaryType: "accounting",
    },
    {
      id: "fixture-place-002",
      displayName: { text: "Harbor Tax Advisors", languageCode: "en" },
      formattedAddress: "22 Placeholder Avenue, Sample City",
      primaryType: "tax_preparation_service",
      attributions: [{ provider: "Example Data Partner", providerUri: "https://partner.example.test" }],
    },
    // Optional fields missing: only the id is guaranteed.
    { id: "fixture-place-003" },
  ],
  nextPageToken: "fixture-next-page-token",
};

export const PAGE_TWO = {
  places: [
    { id: "fixture-place-004", displayName: { text: "Summit Ledger Co" }, formattedAddress: "9 Demo Street, Sample City" },
    // repeated within the page: kept once
    { id: "fixture-place-004", displayName: { text: "Summit Ledger Co" } },
  ],
};

export const EMPTY = {};

export const QUOTA_ERROR = { error: { code: 429, message: "Quota exceeded (fixture).", status: "RESOURCE_EXHAUSTED" } };
export const PERMISSION_ERROR = { error: { code: 403, message: "API key not valid (fixture).", status: "PERMISSION_DENIED" } };
export const INVALID_ERROR = { error: { code: 400, message: "Invalid page token (fixture).", status: "INVALID_ARGUMENT" } };

export const MALFORMED = { places: "not-an-array" };
export const MALFORMED_NO_IDS = { places: [{ displayName: { text: "No id" } }] };
