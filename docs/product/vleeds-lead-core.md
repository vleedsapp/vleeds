# Vleeds — Lead Core

Status: implemented in P1-E1, extended in P1-E2, P1-E4 and P1-E5 · Code: `src/lib/lead-core/*`, `src/lib/dal/{companies,contacts,lead-sources,lead-scores,suppressions}.ts`, `src/components/leads/*` · Migrations: `20261009000000_lead_core_foundation.sql`, `20261010000000_manual_csv_ingestion.sql`, `20261012000000_company_enrichment_hunter.sql`

The lead core is where Vleeds keeps the companies a workspace may sell to, the people at those companies, and what is known about them. Since P1-E2 it is filled by **manual entry** and **CSV import** (see `vleeds-imports.md`); since P1-E4 also by **company enrichment** (see `vleeds-company-enrichment.md`), including for companies found in Discover (`vleeds-discovery.md`). Since P1-E5, contacts can also come from **decision-maker discovery** (`vleeds-contact-discovery.md`).

## 1. A company is the lead

In Vleeds a **lead is a company** in a workspace. There is no separate "leads" table repeating the company. Everything hangs off the company:

```
Workspace → Company → Contacts
                    → Source evidence      (where each fact came from)
                    → Qualification        (the team's decision)
                    → ICP scores           (per profile and revision, later)
                    → Restrictions         (do not contact)
```

A company record holds its name, website and domain, main phone, a structured location (country, region, city, postal code, address lines; all optional, any country), an optional employee range, an **industry** and a short **description** (P1-E4; provider-neutral, filled by enrichment or later by hand), notes, and its **qualification state**. Companies are archived, never deleted.

The same real-world company can exist in two workspaces. Workspaces never share or merge records.

## 2. Contacts

A **contact** is a person at a company: name (required), job title, optional seniority hint, email, phone, profile URL, notes and a status (*active*, *left company*, *status unknown*). Name, title and company are enough. Email and phone are optional.

A company may mark one contact as **primary** for convenience. Nothing depends on it. A contact always belongs to exactly one company in the same workspace and cannot be moved to another one.

## 3. Source evidence: why we keep it

Vleeds should not only know "this person is the head of operations". It should also know **where that came from**. Each piece of evidence records:

- the subject: the company, a contact, or both
- the kind of source: *manual*, *CSV import*, *public dataset*, *website*, *API* or *other*. Provider names are never categories. A provider is a free-text key such as `example-directory`.
- which fact it supports (`company.phone`, `contact.title`, …)
- the value as observed (small, at most 2 KB, never a whole provider payload)
- an optional **confidence** from 0–100. This is confidence in the data, not ICP fit.
- the provider's record id, source URL and observation time

Evidence is **append-only**: a correction is new evidence, so the history stays traceable. The same provider record and field for the same subject is stored only once per workspace, so re-importing a source does not duplicate evidence.

Contact discovery (P1-E5) adds contact evidence the same way (`api`, `hunter`, no record id, because Domain Search has none): name, title, email, phone, profile, the provider's seniority and department, the email verification status and the decision-maker flag.

Enrichment providers (P1-E4) add evidence with `source_kind = api`, their provider key and their company id (`hunter` + Hunter company id); a discovery reference that became a company adds an **identity-only** row (`google_places` + Place ID, field `company.provider_reference`, no value), which is how Discover recognises the place later.

In the company drawer, the **Sources** section lists the most recent 25 records with their source, confidence and date.

## 4. Duplicates: how matching will work

Lists like *ABC Company / ABC COMPANY LLC / abc company* should not become separate records by accident. Vleeds uses **deterministic rules**, not guesswork (`src/lib/lead-core/dedupe.ts`), and always compares within one workspace:

| Order | Company signal | Result |
| --- | --- | --- |
| 1 | Same provider record (provider key + record id) | Same company |
| 2 | Same domain (`https://www.example.com/x`, `example.com/` and `example.com` are equal) | Same company |
| 3 | Same phone in international format | **Review**: shared switchboards exist |
| 4 | Same normalized name in the same country and city/region | **Review**: namesakes and branches exist |
| — | Anything else, including similar names | New company |

| Order | Contact signal | Result |
| --- | --- | --- |
| 1 | Same email (case-insensitive) | Same person |
| 2 | Same provider record | Same person |
| 3 | Same name at the same company | **Review** |
| — | A shared phone number | **Never** merged: colleagues share lines |

How values are normalized:

- **Names:** only formatting is removed: case, extra spaces, periods, commas, quotes, "&" vs "and". Words such as *Ltd*, *Inc*, *Group* or *Holdings* are kept, because they can distinguish real companies.
- **Domains:** the scheme, `www.`, path, port and credentials are dropped. Invalid domains are rejected.
- **Phones:** the number is stored exactly as entered. A comparison value is derived only for international numbers (`+…` or `00…`). National numbers get none, because their country can't be known safely. A full phone library can replace this later.

The database enforces that **one active company per domain** exists in a workspace. Archived companies don't block a new one.

## 5. Qualification vs. ICP score

These are different things:

- **Qualification** is the team's operational decision about a company: *Unreviewed* (default), *Needs review*, *Qualified*, *Unqualified*, with an optional reason. Any workspace member can change it in the company drawer.
- **ICP scores** (since P1-E6, `vleeds-lead-scoring.md`) are deterministic results of how well a company fits an ideal customer profile. Each result stores:
  - the **profile and revision** it was calculated from
  - a fit score 0–100 and a grade (A/B/C from that profile's thresholds), or the outcome **Excluded** with its reasons
  - data coverage, a breakdown, an explanation
  - the **input fingerprint** of the facts it used

  A company can have results for several profiles.

Scores are calculated on the server by the scoring engine (**Evaluate fit** in the drawer), never typed in. A result is **current** only for the profile's current revision **and** the current fingerprint. Editing the profile, or changing the company data, contacts or signal observations, makes it **Outdated** until it is recalculated. The Leads page shows only the default profile's current result as the company's grade. A grade never changes qualification, and an exclusion never changes do-not-contact status.

## 6. Restrictions (suppression)

A **restriction** records that a company, or one contact at it, must not be contacted. The reason is optional.

- Any member can add one from the company drawer. Only owners and admins can lift or edit one; members see that an owner or admin is needed. Adding the same restriction twice has no effect.
- Restrictions are shown in text ("Company restricted", "Contact restricted", "Do not contact this company").
- **Every contact action must check active restrictions before acting.** Since P1-E7 the manual phone workflow does so on the server and in the database: Start contact, logging an outcome, scheduling and rescheduling are refused for a restricted company or contact. The outcome **Do not contact** creates a restriction (this person or the entire company) and cancels the open tasks in that scope (`vleeds-contact-workflow.md`). Restricted tasks show as blocked on Today until cancelled.

## 7. Who can do what

| | Owner | Admin | Member | Other workspaces |
| --- | :-: | :-: | :-: | :-: |
| See companies, contacts, evidence, scores, restrictions | ✓ | ✓ | ✓ | ✗ |
| Create and update companies and contacts; change qualification; archive | ✓ | ✓ | ✓ | ✗ |
| Record evidence | ✓ | ✓ | ✓ | ✗ |
| Add a restriction | ✓ | ✓ | ✓ | ✗ |
| Lift or edit a restriction | ✓ | ✓ | ✗ | ✗ |
| Write score results | — (server scoring engine through the trusted writer only, P1-E7) | — | — | ✗ |
| Log contact attempts; schedule, reschedule, complete and cancel tasks | ✓ | ✓ | ✓ | ✗ |
| Edit or delete contact attempts | ✗ | ✗ | ✗ | ✗ |
| Change the workspace time zone | ✓ | ✓ | ✗ (read only) | ✗ |
| Permanently delete anything | ✗ | ✗ | ✗ | ✗ |

## 8. What the Leads page shows today

- **Add leads** (primary action) offers **Add manually** and **Import CSV** (`vleeds-imports.md`).
- **No companies:** an empty state that offers adding companies or importing a spreadsheet. No sample data is ever shown in a real workspace.
- **With companies:** a table on desktop and cards on phones. Each company shows its primary contact, qualification, number of sources, last update and any restriction. A **Grade** column appears only when a current score exists.
  - **Server-side pagination**, 25 per page (Previous / Next).
  - **Filters:** qualification, grade, restriction, has contacts, country.
  - **Sort:** recently updated (default), company name, qualification, grade.
  - All of this is URL state. There is no text search yet.
  - There are no fit rings, signals or call buttons, because that data doesn't exist yet.
- **Company drawer:** opened from a row, with the URL as `?company=…` (shareable, works on any page or filter). It is a side panel on desktop and a full-height sheet on phones. It shows details, the qualification control, contacts (with **Add contact**), ICP scores, sources and restrictions (**Do not contact** / **Lift restriction**).
  - Since P1-E5 the Contacts section offers **Find decision makers** (ICP roles → one provider search → review → Save N contacts). When it isn't available, it says why (not configured, no domain, do not contact). It also shows the company's last search.
  - Since P1-E4 it also shows **Industry** and **Description**, and offers **Enrich company** when an enrichment provider is configured (fills empty fields only; see `vleeds-company-enrichment.md`).
  - Since P1-E7 each contact shows its last contact and next action, with **Start contact**, **Schedule follow-up**, **Reschedule**, **Complete** and **Cancel task**. An **Activity** section lists recent attempts and tasks (`vleeds-contact-workflow.md`). Calls are placed on the user's own phone; there is no email action and no company editing yet.

## 9. Next

- ~~**P1-E2 — Manual + CSV ingestion.**~~ Done: see `vleeds-imports.md`.
- ~~**P1-E3 — Automated discovery**~~ (Google Places references) and ~~**P1-E4 — Company enrichment**~~ (Hunter, through the same matching, review and `ingest_lead` pipeline, with provider-keyed evidence): done.
- ~~**P1-E5 — Decision-maker / contact discovery**~~ (Hunter Domain Search; contacts go through the same contact matching and `ingest_lead`): done.
- ~~**P1-E6 — ICP evaluation + lead scoring**~~: done (`vleeds-lead-scoring.md`).
- ~~**P1-E7 — Today queue + contact workflow**~~: done (`vleeds-today.md`, `vleeds-contact-workflow.md`).
- **Later (each needs approval):** company editing, search, suppression management, campaigns, other channels.
