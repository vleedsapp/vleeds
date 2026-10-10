# Vleeds — Company enrichment

Status: implemented in P1-E4 · Code: `src/lib/providers/company-enrichment/*`, `src/lib/enrichment/*`, `src/lib/dal/{enrichment,provider-usage}.ts`, `src/app/w/[workspaceId]/enrichment/actions.ts`, `src/components/enrichment/*` · Migration: `20261012000000_company_enrichment_hunter.sql` · Provider: `docs/providers/hunter.md`

## 1. Why enrichment is separate from discovery

- **Discovery** (P1-E3) answers *"What businesses exist?"*. Its first provider, Google Places, lets Vleeds keep only Place IDs. Names and addresses are transient.
- **Enrichment** (P1-E4) answers *"What durable company data may Vleeds keep about this business?"*. Its first provider, Hunter, returns company-level data that may be stored.

The two are separate provider families with separate contracts (`CompanyDiscoveryProvider`, `CompanyEnrichmentProvider`), so each provider's licence and cost model stays explicit. Enrichment never changes the discovery retention rules.

```
Discover: select a result → saved for enrichment (Place ID only)
   ↓ "Find company data" (explicit)
resolve a likely domain (free) → choose / type the domain
   ↓ "Enrich company · estimated 0.2 credit" (explicit)
durable company data → normalize → match → review → Create / Merge / Skip
   ↓ ingest_lead (the P1-E2 pipeline)
company + provider evidence + Place ID identity link
```

## 2. Where it starts

| Start | Input | Notes |
| --- | --- | --- |
| **Discover → Find company data** on a result *saved for enrichment* | The result's name from the **open** search | The name is sent to the server for this one domain lookup and is never stored. |
| **Discover → Company data → Saved for enrichment** (an earlier search) | The user types a name or domain | The original names are gone (transient), and Vleeds doesn't try to recover them. |
| **Discover → Company data → Enrich a company** | A company name or a domain | Works without Google. |
| **Leads → company drawer → Enrich company** | The company's domain (prefilled), or a typed name/domain | Shown only when a provider is configured. The match is the company itself. |

## 3. The four stages (one sheet)

1. **Identify company:** look up by *Company name* (domain suggestions first) or *Domain* (straight to company data). A discovery result with a live name skips this stage.
2. **Choose domain:** radio choices of suggested domains (with the provider's company name, "Exact name match" when the names agree, and a public-address count as a size hint), plus **Enter another domain**. Nothing is chosen silently, and nothing is spent yet. "Domain suggestions provided by Hunter" is shown quietly. The action button states the cost: **Enrich company · estimated 0.2 credit**.
3. **Review company data:**
   - *Vleeds match:* New company / Existing company / Possible duplicate, with the reason.
   - A comparison of Company name, Domain, Industry, Location, Phone, Employees and Description, provider value vs. the Vleeds value. Each row is labelled *New*, *Will fill*, *Same*, *Keeps existing* or *Not provided*, in text and not by colour alone. On phones the table becomes stacked cards.
   - Tags are listed as "kept as source evidence only".
   - Decision: **Create / Merge / Skip**.
4. **Save to Vleeds:** a compact result: *Company created* / *Company updated* / *Skipped*, "Hunter evidence added (N fields)", "Discovery reference linked" when applicable, the kept-value notes, and "Estimated Hunter credits used: X".

**One open run per discovery reference (P1-E5).** A database rule allows at most one open (not completed/cancelled) run per reference. Pressing *Find company data* again, or double-clicking, continues the open run instead of starting another.

Errors appear in the sheet as calm, fixed messages (role=alert). **Try again** appears for temporary problems. After *not found* the user can enter another domain. Cancelling (or closing) marks the run cancelled, and nothing is written.

## 4. Durable company data

Stored on `companies` (provider-neutral columns): canonical name, primary domain, website URL, primary phone, location `{countryCode, region, city, postalCode, addressLine1}`, employee min/max, and the two new columns **industry** (≤ 200) and **description** (≤ 2000). Tags are evidence only. The provider's company id is stored only as source identity (`lead_sources.provider_key/external_record_id`). The field list and the ignored fields are in `docs/providers/hunter.md` §5. No emails, people, social handles, revenue/funding/traffic, technology lists, logos or raw payloads are stored.

Every value goes through the **lead-core** schema (`companyInputSchema`). A value it rejects (e.g. an unusable phone) is dropped, not forced. A company without a provider name is named after its domain, never after transient discovery content.

## 5. Matching, decisions and merge

Matching is the P1-E1 hierarchy (`dedupe.ts`), applied to the incoming record:

1. **Provider identity:** the enrichment provider's company id, *or* the discovery reference's Place ID, already linked to an active company in this workspace → *Existing company*
2. **Domain** → *Existing company*
3. **International phone** → *Possible duplicate*
4. **Name + same place** → *Possible duplicate*
5. otherwise *New company*

| Match | Allowed | Suggested |
| --- | --- | --- |
| New company | Create, Skip | Create |
| Existing company | Merge, Skip (Create is shown disabled, with the reason) | Merge |
| Possible duplicate | Merge, Skip, Create | none (the user decides) |
| Started from an existing company | Merge, Skip | Merge |

**Merge** reuses the P1-E2 planner (`planCompanyMerge`), so there is one algorithm:
- blank incoming values change nothing; equal normalized values need no change;
- empty Vleeds fields are filled (including industry and description);
- conflicting populated values **keep the Vleeds value**, and each conflict is reported ("Kept existing description … (Hunter had …)") in the result and on the run (`commit_notes`);
- the company name is never changed; location and employee ranges only fill missing values;
- the provider's observed value is still recorded as evidence.

One active company per domain stays the rule. If the provider's domain already belongs to another company, the domain isn't moved; a note says so.

## 6. Commit and evidence

The commit uses the existing ingestion path: the CSV row planner (`planRowCommit`) builds the write, and `public.ingest_lead` executes it as **one transaction**. P1-E4 extended `ingest_lead` with `industry`, `description`, provider-keyed evidence and an enrichment run parameter (idempotent per run, like import rows). Manual and CSV behaviour is unchanged.

Evidence (`lead_sources`, `source_kind = api`, `provider_key = hunter`, `external_record_id = Hunter company id`), one row per non-empty value: `company.name`, `.website`, `.domain`, `.phone`, `.location`, `.employee_range`, `.industry`, `.description`, `.tags`. Descriptions are shortened to fit the 2 KB evidence limit. An identical identity row that already exists is kept, not duplicated.

## 7. Google identity link

When an enrichment started from a discovery reference is created or merged, `ingest_lead` (in the same transaction):

- adds `lead_sources (provider_key = google_places, external_record_id = <Place ID>, field_key = company.provider_reference)` to the **committed** company, with no value. There is no name, address or category, only identity;
- marks the reference `selected` / `existing_company` with that company. This is the smallest P1-E3 state change, and it is allowed even after the search was completed (the only change allowed on a finished search).

Later searches therefore show that Place ID as **Existing company**. A second run for the same reference can't re-link it to another company.

## 8. Free-tier usage

- No credits are spent automatically. Selecting a result spends nothing, domain suggestions are free, and company enrichment runs only on the explicit **Enrich company · estimated 0.2 credit** action, for **one company at a time**. There is no bulk enrichment.
- Every request is recorded with an **estimated** credit figure (`provider_usage_events.estimated_credit_millis`, 1000 = 1 credit; 0 when not chargeable; unknown when Vleeds can't tell).
- Discover → Company data shows: *Hunter this month: Domain resolution N requests · Company enrichments N · Estimated credits X*, with the note that the provider account shows the actual balance. No plan limit is coded, so no "remaining" figure is shown.
- Hunter's quota message (HTTP 429) is shown calmly, and nothing retries automatically.

## 9. Not configured

Without `HUNTER_API_KEY`, everything loads. The Company data panel says **"Company enrichment is not configured yet."** There is no *Find company data* and no *Enrich company*. Selected discovery results stay *saved for enrichment*.

## 10. Contact discovery (P1-E5)

Company enrichment still creates no contacts and calls no person endpoints. Finding professional people is a separate step: **Find decision makers** in the company drawer (`vleeds-contact-discovery.md`). It needs the stored domain that enrichment provides, and it never runs enrichment and a contact search in one click. The Discover usage panel now shows both company enrichment and decision-maker searches, with estimated credits and a total.
