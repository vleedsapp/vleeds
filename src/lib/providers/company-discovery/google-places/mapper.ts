import { z } from "zod";
import type { DiscoveryCandidate } from "../types";
import { GOOGLE_PLACES_FIELD_RETENTION, GOOGLE_PLACES_PROVIDER_KEY } from "./fields";

/**
 * Google Places (New) Text Search response → generic candidates. The Google
 * response shape never leaves this folder. Unknown extra fields are ignored;
 * a response that isn't the documented shape is "malformed".
 */

const placeSchema = z.object({
  id: z.string().min(1).max(256).optional(),
  displayName: z.object({ text: z.string().optional(), languageCode: z.string().optional() }).partial().optional(),
  formattedAddress: z.string().optional(),
  primaryType: z.string().optional(),
  attributions: z.array(z.object({ provider: z.string().optional(), providerUri: z.string().optional() })).optional(),
});

const responseSchema = z.object({
  places: z.array(z.unknown()).optional(),
  nextPageToken: z.string().max(4096).optional(),
});

const clip = (v: string | undefined, max: number) => {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
};

/** "accounting_firm" → "Accounting firm" (a readable form of Google's type code). */
export function categoryLabel(primaryType: string | undefined): string | null {
  const t = clip(primaryType, 80);
  if (!t) return null;
  const words = t.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Google Maps URL for a place, derived from its durable Place ID (documented Maps URLs format). */
export function placeUrl(placeId: string, name: string | null): string {
  const q = new URLSearchParams({ api: "1", query: name ?? "place", query_place_id: placeId });
  return `https://www.google.com/maps/search/?${q.toString()}`;
}

export function mapPlace(raw: unknown): DiscoveryCandidate | null {
  const parsed = placeSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.id) return null;
  const p = parsed.data;
  const name = clip(p.displayName?.text, 300);
  return {
    providerKey: GOOGLE_PLACES_PROVIDER_KEY,
    externalId: p.id!,
    display: {
      name,
      address: clip(p.formattedAddress, 400),
      category: categoryLabel(p.primaryType),
    },
    sourceUrl: placeUrl(p.id!, name),
    attributions: (p.attributions ?? [])
      .filter((a) => a.provider?.trim())
      .slice(0, 5)
      .map((a) => ({ provider: a.provider!.trim().slice(0, 120), uri: a.providerUri?.startsWith("https://") ? a.providerUri : null })),
    fieldRetention: GOOGLE_PLACES_FIELD_RETENTION,
  };
}

export type MappedPage = { ok: true; candidates: DiscoveryCandidate[]; nextCursor: string | null } | { ok: false };

/** Maps a parsed JSON body. Places without an id are dropped; duplicates within a page are removed. */
export function mapTextSearchResponse(body: unknown): MappedPage {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  const seen = new Set<string>();
  const candidates: DiscoveryCandidate[] = [];
  for (const raw of parsed.data.places ?? []) {
    const c = mapPlace(raw);
    if (c && !seen.has(c.externalId)) {
      seen.add(c.externalId);
      candidates.push(c);
    }
  }
  // Every returned place lacked a usable id: treat as malformed rather than "no results".
  if ((parsed.data.places?.length ?? 0) > 0 && candidates.length === 0) return { ok: false };
  return { ok: true, candidates, nextCursor: parsed.data.nextPageToken || null };
}
