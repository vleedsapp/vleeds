# Google Places (company discovery provider)

Status: implemented in P1-E3. Provider key: `google_places`. Code: `src/lib/providers/company-discovery/google-places/` (Google-specific), behind the generic interface in `src/lib/providers/company-discovery/types.ts`.

Google Places is Vleeds' first **interactive company-discovery** source. It helps a user find businesses for a workspace's target market. It is **not** a permanent prospect-data source: Vleeds keeps Google **Place IDs** and its own decisions, and shows all other Google content only while a search is open.

## 1. API used

| | |
| --- | --- |
| API | **Places API (New)**. The legacy Places API is not used. |
| Operation | **Text Search (New)**: `POST https://places.googleapis.com/v1/places:searchText` |
| Headers | `Content-Type: application/json`, `X-Goog-Api-Key: <key>`, `X-Goog-FieldMask: <mask>` (required; never `*`) |
| Body | `textQuery` (user query + geography text), `pageSize` (1–20), `pageToken` (next pages only), `regionCode` (the geography's country, when known) |
| Paging | One page per explicit user action (**Load more**). Google returns at most 60 results per query across pages, and a `pageToken` only works with otherwise identical parameters. |
| Timeout | 10 s per request (AbortController). |
| Retry | At most one automatic retry for a transient failure (network error, timeout, 5xx). Quota, permission and invalid-request errors are not retried. |
| Not called | Place Details, Photos, Autocomplete, Nearby Search. No phone, website, ratings, reviews, hours, prices or summaries are requested in P1-E3. |

## 2. Field mask (billing-aware)

Defined once, in `google-places/fields.ts` (`googlePlacesDiscoveryFieldMask`):

```
places.id,places.displayName,places.formattedAddress,places.primaryType,places.attributions,nextPageToken
```

| Field | Why | SKU group (Google docs, checked 2026-10-08) |
| --- | --- | --- |
| `places.id` | durable identity (Place ID) | Text Search Essentials (IDs Only) |
| `places.attributions` | required third-party attributions | Text Search Essentials (IDs Only) |
| `nextPageToken` | Load more | Text Search Essentials (IDs Only) |
| `places.displayName` | show the business name | Text Search **Pro** |
| `places.formattedAddress` | show where it is | Text Search **Pro** |
| `places.primaryType` | show a category | Text Search **Pro** |

The highest tier among the requested fields is billed, so each request is expected to be billed as **Text Search Pro**. Vleeds records this as `sku_hint` on each usage event. **No prices are coded**: Google's pricing changes, so check the current [pricing page](https://developers.google.com/maps/billing-and-pricing/pricing) and the Google Cloud console. Adding any field to the mask can change the SKU, so the mask is covered by a unit test.

## 3. What Vleeds keeps and what it doesn't

| Data | Treatment |
| --- | --- |
| **Place ID** (`places.id`) | **Durable.** Google's policies say place IDs can be stored indefinitely. Stored as `discovery_candidates.external_record_id` with `provider_key = google_places`. |
| Name, address, primary type | **Transient.** Held only in server memory during the request and in the browser's state for the open search. Never written to a database column, a log or a report. History therefore shows the user's query and counts, not business names. |
| Third-party attributions | Transient, shown with the results. |
| `nextPageToken` | Transient. Returned to the browser for **Load more** and sent back with the next request. Never stored; it expires with the interaction. |
| Raw responses | Never stored, logged or shown. Errors are reduced to a status category. |
| The user's query and geography, decisions, counts, timestamps | Vleeds data, stored. |

Google content is not turned into company records. A selected place becomes a `needs_enrichment` **reference**. Company data for it must later come from a source whose terms allow durable use (a future story); that data then goes through the normal ingestion pipeline. Re-check the current Google Maps Platform terms before changing any of this.

## 4. Attribution

Whenever results are shown, the results panel's footer, in the same container, shows **"Google Maps"**:

- as text (no map is shown, and no logo asset is bundled)
- unmodified, not translated (`translate="no"`), on one line
- sans-serif, weight 400, `#5E5E5E`, 13px
- with an accessible label

Third-party providers that Google returns in `places.attributions` are listed next to it, linked when Google provides a link. The attribution is styled as attribution, not as a Vleeds status or company field. It appears only next to Google-derived content.

**About these results** (a disclosure in the same footer) explains that Google Maps ranks local results using several factors, primarily relevance, distance and prominence, and that Vleeds does not change this order.

## 5. Usage accounting

Every request batch writes one `provider_usage_events` row:

| Column | Value |
| --- | --- |
| `provider_key` | `google_places` |
| `operation` | `text_search` |
| `requested_fields` | the field-mask entries |
| `request_count` | 1, or 2 when the bounded retry ran |
| `result_count` | places returned |
| `status` | one of `ok`, `empty`, `timeout`, `rate_limited`, `setup`, `invalid_request`, `unavailable`, `malformed` |
| `sku_hint` | `Text Search Pro` |
| `pricing_reference` | Google's pricing page URL |
| `estimated_cost_micros` | null, because there is no configured price snapshot |

No API key, token or payload is stored. When the key is missing, no request is made and nothing is recorded. Discover shows requests and candidates for the current search and the current month. It shows no money amounts.

## 6. Errors users see

| Situation | Message |
| --- | --- |
| No key configured | "Company discovery is not configured yet." Discover still loads. |
| Timeout | "The search took too long to respond. Try again in a moment." |
| 429 / quota | "The discovery provider is limiting requests right now. Wait a minute and try again." |
| 401/403, API not enabled, billing | "The discovery provider rejected the request. Its setup (API key, enabled API or billing) needs checking by an owner." |
| 400 / invalid page token | "The provider couldn't run this search. Adjust the search and try again." |
| 5xx / network | "The discovery provider is temporarily unavailable. Try again in a moment." |
| Unreadable response | "The provider returned something Vleeds couldn't read. Try again." |
| No results | "No companies found", with suggestions to broaden the search. |

A failed first page marks the run **Failed**, with **Try again** in the results panel and **Retry** in history. A failed **Load more** keeps the results already shown.

## 7. Google Cloud setup (owner, outside Vleeds)

1. In the [Google Cloud console](https://console.cloud.google.com/), create or select a project for Vleeds.
2. Enable **billing** on the project.
3. In *APIs & Services → Library*, enable **Places API (New)**. Not "Places API" (legacy).
4. In *APIs & Services → Credentials*, **create an API key**.
5. Restrict the key:
   - API restrictions: allow **Places API (New)** only.
   - Application restrictions: the key is used server-side, so restrict it by the server's egress IP addresses if your hosting provides fixed ones. Never use HTTP-referrer restrictions for a server key. If fixed IPs aren't available, rely on the API restriction plus quotas.
   - Optionally set per-day quotas and budget alerts in the console.
6. Add the key to the **server** environment as `GOOGLE_PLACES_API_KEY` (for example `.env.local` locally, or the hosting provider's encrypted environment variables). **Never** name it `NEXT_PUBLIC_…`, never commit it, never paste it into tickets or reports.
7. Restart the server or redeploy. Discover then shows the search form.

The key is read only by server code (`registry.ts`, which imports `server-only`). The build check (`npm run check:bundle`) fails if the variable name, its value, the Google endpoint or the field-mask header appears in browser files.

## 8. Development and tests (no real key needed)

- Unit tests use a scripted fake `fetch` and small fictional fixtures (`tests/fixtures/google-places.ts`): several places, a next-page token, missing optional fields, an empty result, quota/permission/invalid errors, and malformed bodies.
- UI review uses the UI-review mock (`scripts/ui-review/mock-supabase.mjs`). It serves a fake Text Search endpoint with fictional places; the server is started with `GOOGLE_PLACES_API_KEY=review-only-key` and `GOOGLE_PLACES_ENDPOINT=http://127.0.0.1:54321/v1/places:searchText`. `GOOGLE_PLACES_ENDPOINT` is **development only**: it is ignored unless the host is loopback, and always ignored when `VERCEL_ENV=production`.
- No test or quality gate calls Google.

## 9. Optional live smoke test (manual)

Only when a real key is configured and an owner agrees to spend one request:

1. Start Vleeds with `GOOGLE_PLACES_API_KEY` set (and **no** `GOOGLE_PLACES_ENDPOINT`).
2. Sign in, open **Discover**, and search one harmless, generic query (for example "public library") with page size 5.
3. Record only:
   - whether the request succeeded or failed
   - the number of results
   - the field mask used (§2)
4. Check that the "Google Maps" attribution is shown. Then press **Cancel search**.
5. Do not record the key, the response, or business names.

If no key is configured, the report states: `LIVE GOOGLE PLACES TEST: NOT RUN — API KEY NOT CONFIGURED`. That is not a failure.
