# Vleeds — Decision-maker / contact discovery

Status: implemented in P1-E5 · Code: `src/lib/providers/contact-discovery/*`, `src/lib/contact-discovery/*`, `src/lib/dal/contact-discovery.ts`, `src/app/w/[workspaceId]/leads/contact-discovery-actions.ts`, `src/components/contacts/*` · Migration: `20261013000000_contact_discovery_hunter.sql` · Provider: `docs/providers/hunter.md` §8

## 1. Why it is separate

| Step | Question | Provider family |
| --- | --- | --- |
| Company discovery (P1-E3) | What businesses exist? | `CompanyDiscoveryProvider` (Google Places) |
| Company enrichment (P1-E4) | What is this company? | `CompanyEnrichmentProvider` (Hunter Domain Finder + Company Enrichment) |
| **Contact discovery (P1-E5)** | **Who is the right professional person inside it?** | **`ContactDiscoveryProvider`** (Hunter Domain Search) |

Each step has its own contract, capabilities, retention rules and credit accounting, so a different provider can be added to one step without touching the others. Company and person data are kept apart: a contact search never rewrites company data or company evidence.

```
Company (stored domain) + ICP decision-maker roles
  → "Find decision makers · estimated up to 1 credit" (explicit)
  → one provider search (≤ 10 people, one page)
  → candidates: role match · email status · confidence · existing/duplicate/conflict
  → Select / Dismiss / Undo → "Save N contacts"
  → contacts + provider evidence (through ingest_lead)
```

## 2. Requirements before a search

- **A stored domain.** The search uses the company's normalized `primary_domain`, which the server re-reads. Without one, the drawer says *"Add or enrich this company with a domain before finding contacts."* The existing **Enrich company** action (P1-E4) is next to it. The two credit-bearing steps are never chained in one click.
- **Not restricted.** A company with an active company-level do-not-contact record gets no search: *"This company is marked do not contact."* Owners and admins keep the existing **Lift restriction** control; permissions are unchanged. The server checks again before searching and before saving.
- **A configured provider.** Without `HUNTER_API_KEY` the drawer says *"Contact discovery is not configured yet."* Everything else, including P1-E4, is unchanged.

## 3. ICP role targeting

- The **default ICP** is preselected; another active profile can be chosen. The run stores `icp_profile_id` + `icp_revision`.
- Its **decision-maker roles** (P0-E1-S2: title, priority, seniority hint) are listed with their priority (*Primary*, *Secondary*, *Fallback*), ordered primary → secondary → fallback, then in configured order.
- Every role is preselected, up to **10 distinct titles**. The user can untick roles; beyond 10, the user chooses which. The selection belongs to **this search only**, and the ICP is never edited from here.
- **No roles configured** (or no profile): the user types titles for this search (one per line, ≤ 10). They are never written back. A link says *"Configure decision-maker roles in Settings to reuse them automatically."*
- **Only show Hunter-classified decision makers** (`decision_maker=true`) is an option, off by default: a role from the ICP may matter even if the provider doesn't classify the person as a decision maker. A search needs at least one title or this option.
- No titles are invented or generated.

## 4. The search

- `type=personal`, the stored domain, the chosen titles, `limit` 10 and `offset` 0: **one page per explicit click**. There is no automatic pagination and no automatic fallback search. The client's single bounded transport retry for transient errors is counted in usage.
- Before the request the sheet shows: *Hunter Domain Search · Up to 10 professional contacts · Estimated usage: up to 1 credit if results are returned*, and the button **Find decision makers · estimated up to 1 credit**. It never promises that 10 people exist.
- **No results:** *No contacts found*, with explicit choices: **Edit target roles**, **Search only Hunter-classified decision makers**, or try again later. Each is a new, deliberate search. The empty run is completed, with 0 credits estimated.
- **Errors** (quota, rate limit, invalid request, temporary failure, timeout, unreadable answer, restriction) show fixed, calm messages (role=alert). **Try again** appears only for temporary problems and is never automatic.

## 5. Candidates and role-match labels

Results are staging records (`contact_discovery_candidates`), not contacts and not outreach records. Each keeps only:
- the name, title and professional email (+ normalized);
- the phone and https profile URL if returned;
- the provider's seniority, department and decision-maker flag;
- the provider's email verification status and confidence;
- a source count and last-seen date.

No raw payload, source URLs/pages, twitter, organization or pattern data is kept. Results without a name or a usable email are not shown ("1 result was not shown"). Domain Search has no stable per-person id, so `provider_external_id` stays NULL; none is invented from array positions.

**Role match** (deterministic; `src/lib/contact-discovery/model.ts`):
- Normalize: lower-case, punctuation to spaces, collapsed whitespace.
- A configured title matches when it appears in the person's title as **whole words** ("Senior Operations Manager" contains "Operations Manager"; "Operations Managerial" does not).
- When several match, the highest priority wins.
- Labels:
  - *Primary title match* / *Secondary title match* / *Fallback title match*
  - *Search title match* (typed titles)
  - *No configured-title match*
  - plus *Hunter decision maker* and *Executive seniority* where the provider says so

There is no numeric contact score. **Email status** (*Valid*, *Accept-all*, *Unknown*, *Invalid*, or *Not provided*) and **Hunter confidence** describe the **email**, not role fit. They are shown separately and never combined into a percentage. No Email Verifier call is made.

**Order:**
1. primary title matches
2. secondary title matches
3. fallback title matches
4. typed-title matches
5. provider-classified decision makers
6. everyone else

Within a group, the provider's order is kept.

## 6. Matching existing contacts (P1-E1/P1-E2 rules)

| Situation | State | What the user can do |
| --- | --- | --- |
| Normalized email belongs to a contact **at this company** | **Existing contact** | Select → adds evidence and fills empty fields (nothing overwritten); restricted contacts are labelled **Restricted** and stay restricted |
| Email belongs to a contact **at another company** | **Contact already belongs to another company** (conflict) | Dismiss only. The contact is never moved or duplicated (DB CHECK + a check in the save function) |
| Same normalized name at this company, different/no email | **Possible duplicate** | **Same person** (merge) or **Add as new**, an explicit choice; never a silent merge |
| None of these | **New** | Select / Dismiss |

Phone never identifies a contact. The rules are `dedupe.matchContact` plus the workspace-wide email lookup (the same order as CSV import).

## 7. Saving

- Nothing is selected automatically. The footer says **Save N contacts**.
- Each selected candidate is written by `public.commit_contact_candidate` (one transaction per person), which:
  - re-checks the candidate (selected, not a conflict, run in review);
  - refuses a "new" contact whose email already exists anywhere in the workspace;
  - allows a merge only into the matched contact;
  - calls the existing `public.ingest_lead` and records the outcome.
- Saving again is a no-op for already-saved people (idempotent).
- **Create:** the P1-E2 contact columns. The first new contact becomes primary only if the company has none.
- **Merge:** the P1-E2 conservative contact merge (fill empty fields; keep differing values and report "Kept existing job title …"; never rename).
- **Seniority:** only the provider's `executive` maps to the Vleeds hint *executive*; `senior`/`junior` stay as evidence only. The job title remains the role description. There is no `contacts.department` column; department is review context and evidence.
- **Evidence** (`lead_sources`, `source_kind = api`, `provider_key = hunter`, no record id), per non-empty value:
  - `contact.name`, `.title`, `.email`, `.phone`, `.linkedin`
  - `contact.seniority` (provider value), `.department`, `.verification_status`, `.provider_decision_maker`
- Saved contacts appear at once in the drawer's Contacts, and evidence appears under Sources. The drawer also shows the **last search** ("Last search: 9 contacts found · 5 saved · ICP: Default profile · Completed").

## 8. Suppression

- **Company:** a do-not-contact company can't be searched and can't save contacts.
- **Contact:** a restricted existing contact keeps its restriction when selected; only evidence and empty fields are added.
- Saving a contact never makes anyone "outreach-ready": there is no outreach in Vleeds yet, and every future contact action must check suppression.

## 9. Credits

- **Estimated** per search: 1 credit (1000 millis) when the provider returned 1–10 emails, 0 when none (or on errors), unknown when the answer was unreadable. The rule is provider metadata (`hunter/usage.ts`).
- Recorded in `provider_usage_events` (operation `domain_search`, with the run and company).
- Discover → Company data shows: *Hunter this month: Company enrichment … · Decision-maker searches N searches · estimated Y credits · Total estimated Hunter credits*. The Hunter account is the authoritative balance. No plan allowance is coded.

## 10. Limitations and what comes next

- One provider (Hunter Domain Search), one page of ≤ 10 people per search, one company at a time.
- There is no "search more" (a later story could add it with clear credit visibility).
- Not used: Multi-Domain Search, Email Finder, Email Verifier, Email/Combined Enrichment. No Apollo.
- No outreach, calls, SMS, sequences, campaigns or tasks; Today is unchanged.
- **Next (needs approval):** P1-E6, ICP evaluation and lead scoring. It would use the stored company/contact data (including decision-maker coverage) to compute a transparent, revision-pinned score and grade.
