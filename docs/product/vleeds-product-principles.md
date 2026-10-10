# Vleeds — Product Principles

Status: adopted in P0-E1-S1 · Owner: product · Applies to every story

## 1. Why Vleeds exists

Vleeds is a lightweight lead-discovery and prospecting workspace. It exists to make one workflow faster:

```
Discover companies → identify decision-makers → qualify leads → contact them → record the outcome → follow up
```

Every feature must shorten, clarify or de-risk a step in that loop. A feature that doesn't is out of scope, however useful it might be elsewhere.

## 2. What Vleeds is not

Vleeds is deliberately **not**:

| Not this | Why it matters |
| --- | --- |
| A full CRM | No deal pipelines, forecasting, account hierarchies or quote management. Leads leave Vleeds when they become customers. |
| An email marketing platform | No bulk sends, sequences, templates marketplace or deliverability tooling. |
| An autonomous AI sales agent | People decide who to contact and what to say. Any assistance is suggestive and reviewable. |
| An auto-dialer | Calls are placed one at a time by a person, through the workspace's chosen provider. |
| A marketing automation suite | No journeys, triggers, landing pages or attribution. |
| A billing / subscription SaaS product | No plans, metering or payments until the product is explicitly opened to paying tenants. |

A proposed feature that pulls Vleeds toward one of these needs explicit product approval before design starts.

## 3. Business-agnostic by construction

Vleeds is first used internally, but it must serve unrelated businesses without code changes.

**Rule:** no business, industry, customer type, geography, job title, scoring rule, lead source or telephone provider is hard-coded in application code, schema defaults, copy, or tests' production paths.

Businesses we work with today exist only as **workspaces**, which are data. A new business can use Vleeds by creating a workspace and defining:

- business name, website/domain, logo, description
- target geographies
- ideal company / customer characteristics
- target decision-maker titles
- positive buying signals and negative/exclusion signals
- scoring rules
- enrichment providers and preferred calling provider

Enforcement: `tests/unit/business-agnostic.test.ts` fails the build if named businesses or specific providers appear in `src/`, migrations or seed data. Provider integrations, when they arrive, are generic adapters selected per workspace; no workflow branches on a provider name.

## 4. Tenancy is a product feature, not an afterthought

- An **organization** is the tenant. People belong to organizations through **memberships**.
- A **workspace** is one business being prospected for. All prospecting records belong to exactly one workspace.
- Isolation is enforced by the database (Row Level Security), not by UI conventions. See `docs/architecture/vleeds-tenancy.md`.

## 5. Experience principles

1. **Operational clarity over decoration.** The UI is a work surface: dense enough to scan, calm enough to use all day. Light theme, neutral palette, one restrained accent.
2. **Not visually AI-centric.** No sparkles, gradients, chat-first layouts or "magic" metaphors. Automated suggestions look like ordinary data, labelled with their source.
3. **The active workspace is always obvious.** The workspace switcher is persistent; every URL contains the workspace; switching never mixes data between workspaces.
4. **Honest empty, loading and error states.** Empty states say what will appear and why it isn't there yet. Errors never expose internals.
5. **Desktop-first, mobile-usable.** Primary work happens at a desk; checking today's follow-ups on a phone must still work.
6. **Primary navigation is fixed:** Today · Discover · Leads · Campaigns · Settings. New capabilities fit inside these, not beside them.

## 6. Data & trust principles

- **Provenance on everything.** Every company/contact records where it came from (`lead_sources`) and when.
- **Suppression wins.** Suppression/do-not-contact entries override every other signal and are checked before any contact action.
- **Secrets stay server-side.** Provider credentials are never sent to the browser, and never readable by end-user database roles.
- **People own outcomes.** Activities and follow-ups are recorded by, and attributed to, a person.

## 7. How scope is controlled

Work is delivered in small, approved stories (e.g. `P0-E1-S1`). Each story ends with a completion report in `docs/reports/`, and the next story starts only after explicit approval.
