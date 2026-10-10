# Provider: Hunter (company enrichment)

Status: implemented in P1-E4 (company enrichment) and P1-E5 (contact discovery) · Code: `src/lib/providers/company-enrichment/hunter/*` and `src/lib/providers/contact-discovery/hunter/*` (the only places that know Hunter's API; the contact adapter reuses the enrichment adapter's HTTP client) · Registries: `src/lib/providers/{company-enrichment,contact-discovery}/registry.ts` · Product: `docs/product/vleeds-company-enrichment.md`, `docs/product/vleeds-contact-discovery.md`

Hunter is Vleeds' first **durable company enrichment** provider and first **professional contact discovery** provider. Vleeds uses it for three things only: suggesting a company's domain from its name, looking up company-level data for a domain (P1-E4), and finding professional people at a company's domain (Domain Search, P1-E5; §8). Facts below were checked against Hunter's API v2 documentation on 2026-10-09. Plans, prices and rules change; Hunter's documentation and your Hunter account are the authority.

## 1. Setup

1. Create a Hunter account, or sign in. The Free plan currently includes API access.
2. Open your Hunter account's **API** settings.
3. Create or copy an API key.
4. Add it to the Vleeds **server** environment (`.env.local` locally, or the hosting provider's environment settings):

   ```
   HUNTER_API_KEY=<your key>
   ```

5. Restart the local app (`npm run dev` / `next start`), or redeploy.
6. **Never** use `NEXT_PUBLIC_HUNTER_API_KEY`. A `NEXT_PUBLIC_` variable is copied into browser JavaScript. Vleeds ignores that name, and the bundle check (`npm run check:bundle`) fails if the key's name or value reaches the browser bundle.
7. Domain Finder is currently **Beta** at Hunter. Its answers are suggestions for a person to check.
8. Company Enrichment **consumes credits** under Hunter's current rules (§4).
9. Plans, quotas and credit rules may change. Vleeds shows *estimated* usage only.

Without a key, Vleeds loads normally: Discover and Leads work, and the Company data panel says "Company enrichment is not configured yet." Selected discovery results stay *saved for enrichment*.

**Development / UI review only.** `HUNTER_API_ENDPOINT` points the adapter at a local mock (base URL including `/v2`, e.g. `http://127.0.0.1:54321/hunter/v2`). It is accepted only for loopback hosts and ignored on a Vercel production deployment. It is not a general outbound-URL setting.

## 2. Authentication and requests

- Base URL: `https://api.hunter.io/v2`, **GET** requests only.
- The key is sent in the **`X-API-KEY` header**, never in the query string (Hunter also accepts `api_key=`; Vleeds doesn't use it). It is read from `HUNTER_API_KEY` at request time, only in server-only code, and is never logged, stored, returned to the browser or written to reports.
- Timeout: 10 s per request (`AbortController`).
- Retry: at most **one** extra attempt, and only for network errors, timeouts and 5xx. Every attempt is counted in usage.
- Never retried: quota/usage limit (429), rate limit (403), invalid request (400/422), missing or bad key (401), not found (404), legal restriction (451).
- Error bodies are not read into Vleeds (they can echo inputs). Only the HTTP status is mapped to a category.

| HTTP | Category | What the user sees |
| --- | --- | --- |
| 200 | ok | the data |
| 404 | not_found | "Hunter couldn't find company data for this domain." (a normal outcome; try another domain) |
| 400 / 422 | invalid_request | "The provider couldn't use this input…" |
| 401 | setup | "…Its setup (API key) needs checking by an owner." |
| 403 | rate_limited | "…limiting requests right now. Wait a minute…" |
| 429 | quota_exhausted | "…monthly quota for this account appears to be used up…" |
| 451 | restricted | "This data isn't available from the provider." (no workaround through other endpoints) |
| 5xx / network | unavailable | "…temporarily unavailable…" + Try again |
| timeout | timeout | "…took too long…" + Try again |
| unreadable 200 | malformed | "…couldn't read…" + Try again |

## 3. Endpoints used

| Endpoint | Parameters Vleeds sends | Used for |
| --- | --- | --- |
| `GET /v2/domain-finder` (**Beta**) | `company` (≥ 3 characters, whitespace collapsed), `limit` (≤ 5) | Domain suggestions for a company name |
| `GET /v2/companies/find` | `domain` (normalized by the lead-core domain helper) | Company Enrichment |

`perfect_match` is not sent (default `false`), so close names are offered for the user to choose from.

**Not used (by design):** Email Enrichment, Combined Enrichment, Email Finder, Email Verifier, Multi-Domain Search, Discover, leads/campaign endpoints. Domain Search is used since P1-E5 (§8); P1-E4 itself requests no person data.

The Domain Finder response shape is isolated in `hunter/schemas.ts` + `hunter/mapper.ts` and mapped at once to the generic `DomainSuggestion { domain, companyName, confidenceLabel?, emailCount? }`. Neither the UI nor the database depends on Hunter's Beta shape. Suggestions are not stored.

## 4. Credits, quota and rate limits (current documentation)

| Item | Current rule | How Vleeds uses it |
| --- | --- | --- |
| Domain Finder | Free of credit charge; may be unavailable once the account's search quota is used up | Estimated credits **0** |
| Company Enrichment | **0.2 credit** when the core company data is returned | Estimated **200 millis** (1000 = 1 credit) for a 200 response with data; **0** for 404 or errors; **NULL** (unknown) for an unreadable 200 |
| Rate limit (Company Enrichment) | 15 requests/second, 500 requests/minute | Vleeds stays far below: one request per explicit click, one company at a time |
| Free plan | Currently 50 credits/month, API access, monthly reset | **Not** hard-coded. No "remaining" figure is shown |

The rule lives in `hunter/usage.ts` (`COMPANY_ENRICHMENT_CREDIT_MILLIS`, `estimateCreditMillis`) as provider metadata, together with the text of the rule it came from. Change it there if Hunter changes it.

## 5. Data Vleeds keeps

From `companies/find`, `hunter/mapper.ts` maps only company-level fields:

| Hunter field | Vleeds | Notes |
| --- | --- | --- |
| `id` | `lead_sources.external_record_id` (`provider_key = hunter`) | Provider identity only; no `hunter_company_id` column |
| `name` (else `legalName`) | `companies.canonical_name` | Falls back to the domain if Hunter returns no name |
| `domain` | `companies.primary_domain` | Normalized; falls back to the requested domain |
| — | `companies.website_url` | Derived as `https://<domain>` |
| `phone`, else first `site.phoneNumbers` | `companies.primary_phone` | Company switchboard only; dropped if the lead-core phone rule rejects it |
| `geo.countryCode`, `geo.state` (or `stateCode`), `geo.city`, `geo.postalCode`, `geo.streetAddress` (or number + name) | `companies.location` `{countryCode, region, city, postalCode, addressLine1}` | Unknown country codes are dropped; no country is assumed; no coordinates |
| `metrics.employeesCount` / numeric `employees` | `employee_count_min = max` | Exact count |
| `metrics.employees` "11-50", "1,001–5,000" | min/max | "10001+" → min only; anything else (e.g. "10K+") → nothing |
| `category.industry` | `companies.industry` | One documented field; the taxonomy is not concatenated |
| `description` | `companies.description` | Whitespace collapsed, ≤ 2000 characters |
| `tags` | evidence `company.tags` only | ≤ 10, ≤ 60 characters each |

**Ignored** (never mapped, stored or sent to the browser): `site.emailAddresses` and any email address, social handles and follower counts (facebook, linkedin, twitter, instagram, crunchbase), `logo`, `foundedYear`, `legalName` (except as a name fallback), `domainAliases`, `type`/`company_type`, `ticker`, `identifiers`, the rest of `category` (sector, industryGroup, subIndustry, SIC/NAICS/GICS codes), `geo.lat/lng`, `timeZone`, `metrics` other than employees (traffic and Alexa ranks, market cap, raised, revenue, fiscal year), `tech`, `techCategories`, `emailProvider`, `fundingRounds`, `parent`, `ultimateParent`, `indexedAt`. From Domain Finder: `logo` is ignored, and `email_count` is shown as a size hint only. Future stories may add fields deliberately if they support qualification.

**Never stored:** the raw response, the API key, personal data, contact records, the Google name used for a domain lookup.

## 6. Usage accounting

Every Hunter request is recorded in `provider_usage_events` (`provider_key = hunter`, `operation = domain_finder | company_enrichment`, `request_count` including the retry, `result_count`, `status`, `estimated_credit_millis`, `pricing_reference` = the credit rule text, `enrichment_run_id`). Discover shows "Hunter this month: Domain resolution · Company enrichments · Estimated credits", labelled as an estimate. Hunter's account page is authoritative.

## 7. Optional live smoke test

Automated tests and UI reviews use mocks only and never spend credits. With a real key you may run a manual check:

1. **Default: Domain Finder only** (currently free). Use one generic company-name query, e.g. from a Node REPL on the server:
   ```js
   const r = await fetch("https://api.hunter.io/v2/domain-finder?company=" + encodeURIComponent("<a generic company name>") + "&limit=5", { headers: { "X-API-KEY": process.env.HUNTER_API_KEY } });
   ```
   Record only: success/failure, the number of suggestions, the response time. Do not record the key or the raw response.
2. **Company Enrichment only if the owner explicitly chooses to** (it costs ~0.2 credit). Record success/failure, the domain, the mapped field names and the estimated credits, never the raw response.

P1-E4 status: **LIVE HUNTER TEST: NOT RUN — HUNTER_API_KEY NOT CONFIGURED.**

## 8. Domain Search (contact discovery, P1-E5)

| Item | Vleeds use |
| --- | --- |
| Endpoint | `GET /v2/domain-search`, key in the `X-API-KEY` header (shared client: same timeout, one bounded retry for transient errors, same status mapping) |
| `domain` | The company's stored, normalized domain (re-read on the server) |
| `type` | Always `personal` |
| `job_titles` | Comma-separated titles from the ICP roles chosen for the search (or typed for it), ≤ 10; commas inside a title become spaces. Hunter matches whole words and common equivalents |
| `decision_maker` | `true` only when the user ticks "Only show Hunter-classified decision makers"; not forced when titles are given |
| `seniority` / `department` | Supported by the adapter (Hunter's own lists: seniority junior/senior/executive; departments executive, it, finance, management, sales, legal, support, hr, marketing, communication, education, design, health, operations, product, research, consulting, administrative, procurement); not exposed in the P1-E5 UI |
| `limit` / `offset` | `10` / `0`: **one page of at most 10 people per explicit search; no automatic pagination** |
| Not sent | `company`, `required_field`, `verification_status`, `location`, `aggregations` |

**Mapped (minimal professional data):**
- `first_name` + `last_name`: results without a name are skipped; no name is invented from an email
- `value`: the email, normalized
- `position`: the title
- `phone_number`: shape-checked; saved only when selected; never an identity
- `linkedin`: only an existing https URL; nothing is fetched or built
- `seniority`: Hunter's taxonomy, kept as context and evidence; only `executive` maps to the Vleeds hint
- `department`: context and evidence; there is no contact column
- `decision_maker`
- `verification.status`: `valid`, `accept_all`, `unknown` and `invalid` are shown as reported; anything else counts as not provided
- `confidence`: 0–100, otherwise empty
- `sources`: only a count and the latest `last_seen_on`

**Ignored:** `type: generic` results, `twitter`, source URLs/pages, `position_raw`, the response's `domain`/`disposable`/`webmail`/`accept_all`/`pattern`/`organization`/`linked_domains`, and `meta`. Domain Search returns no stable per-person record id, so `provider_external_id` stays NULL.

**Verification.** Domain Search already returns each email's verification state. Vleeds shows it as reported and **does not call Email Verifier**, which would cost an extra credit.

**Credit rule (current documentation; provider metadata in `contact-discovery/hunter/usage.ts`).**
- One Domain Search credit when the call returns 1–10 emails → estimated **1000 millis**.
- No emails, or an error → **0**.
- An unreadable success → **NULL**.
- Recorded per search in `provider_usage_events` (`operation = domain_search`, with the contact run and company).
- Free plans also cap `limit + offset` at 10, which matches the P1-E5 single page.

**Errors.** As in §2: 400 invalid request, 401 setup, 403 rate limit, 429 quota, 451 restricted, 5xx/timeout temporary. An empty result is a 200 with no emails. Vleeds then shows "No contacts found" with explicit next steps and runs no automatic second search.

### Optional live Domain Search smoke test

This test is not part of the quality gate. A successful search may use a credit, so run it only deliberately, with one generic company domain you are allowed to look up. For example, from a server-side Node REPL:

```js
const r = await fetch("https://api.hunter.io/v2/domain-search?type=personal&limit=10&offset=0&domain=" + encodeURIComponent("<a company domain>"), { headers: { "X-API-KEY": process.env.HUNTER_API_KEY } });
```

Record only:
- success or failure
- the number of contacts returned
- the filters used (type, limit, and titles/decision_maker if any)
- the estimated credit (1 if 1–10 emails, else 0)

Never record the key, the raw response or any real person's data.

P1-E5 status: **LIVE HUNTER DOMAIN SEARCH: NOT RUN** (no key configured).
