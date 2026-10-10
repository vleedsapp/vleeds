# Vleeds — ICP Configuration

Status: implemented in P0-E1-S2 · Code: `src/lib/config/icp.ts`, `src/lib/config/icp-status.ts`, `src/components/settings/*` · Table: `public.icp_profiles`

## 1. What an ICP is in Vleeds

An **ideal customer profile (ICP)** is a workspace's own description of who it wants to sell to. It is the first step of the Vleeds loop:

```
Define who to sell to → discover companies → identify decision-makers → qualify → contact → record outcome → follow up
```

Everything in an ICP is **data the workspace enters**. Vleeds has no built-in industries, regions, job titles or signals, so the same code serves any business. A workspace selling software and one selling field services differ only in their configuration.

A workspace can hold **several ICP profiles** (for example one per segment). The data model already supports this. In this release Settings edits the workspace's **default profile** only. The first save in any section creates it, named "Default profile" until someone renames it.

## 2. The sections

| Section | What it records | Notes |
| --- | --- | --- |
| **Ideal customer profile** | Profile name, a plain-language description of the ideal customer, industries/categories (free labels), company size (optional min/max employees), company characteristics (free labels), positive keywords, notes | No industry list is built in. Labels are compared case-insensitively to prevent duplicates. |
| **Target geographies** | A list of targets. Each has a country (required, ISO code), an optional region/state/province, an optional city/locality and an optional display label | A country on its own covers the whole country. Region and city are free text, so no country's subdivisions are assumed. No maps or autocomplete service is used. |
| **Decision-maker titles** | Roles to look for at target companies: title, priority (*primary*, *secondary*, *fallback*) and an optional seniority hint (*executive*, *director*, *manager*, *individual contributor*) | Titles are compared after trimming, collapsing spaces and ignoring case, so "Head of X" and " head of x " count as the same title. |
| **Buying signals** | Signs that a company is more worth contacting: name, optional description, weight 1–100, enabled/disabled | Signals are just names and weights. Vleeds does not interpret them yet. |
| **Exclusion signals** | Signs that a company should be left out or ranked lower: name, optional description, behaviour, penalty and enabled/disabled. Behaviour is either *exclude* (hard exclusion) or *lower score* (penalty of 1–100 points) | Saving an empty list is meaningful: it records "No exclusions". |
| **Scoring rules** | Grade thresholds (A from *a*, B from *b*, C below *b*) and category weights for the future fit score: company fit, geography fit, decision-maker fit, buying signals | Thresholds must satisfy 1 ≤ b < a ≤ 100. Weights are whole numbers that add up to 100. The editor suggests A ≥ 75, B ≥ 50 and weights 40/20/20/20, but nothing is stored until the user saves. |

**Enrichment providers** and **Calling provider** appear in Settings but are not configurable yet. Each shows "Not configured" and "Available in a later setup step".

## 3. Who can change it

| | Owner | Admin | Member |
| --- | :-: | :-: | :-: |
| View business profile and ICP configuration | ✓ | ✓ | ✓ (read-only sheets) |
| Edit business profile (name, domain, website, description) | ✓ | ✓ | ✗ |
| Create / edit / archive ICP profiles, change the default | ✓ | ✓ | ✗ |

These rules are enforced by the database (Row Level Security) and checked again by every server action. Hiding a button is never the protection.

## 4. Configuration status rules (exact)

The status pill next to each section is computed from **saved** data only (`src/lib/config/icp-status.ts`). A section that has never been saved is *Not configured*. An empty object or empty list does not count, except for exclusions.

| Section | Not configured | Partially configured | Configured |
| --- | --- | --- | --- |
| Ideal customer profile | No description **and** no company criterion | Only one of: a description, or at least one company criterion | A description **and** at least one company criterion |
| Target geographies | Never saved, or saved empty | — | At least one target |
| Decision-maker titles | Never saved, or saved empty | — | At least one title |
| Buying signals | Never saved, or saved empty | Signals exist but all are disabled | At least one **enabled** signal |
| Exclusion signals | Never saved | — | Saved with at least one enabled exclusion (**Configured**), or saved with none enabled (**No exclusions**) |
| Scoring rules | Never saved | — | A valid model is saved |

A *company criterion* is at least one industry/category, characteristic or keyword, or a minimum or maximum company size. The profile name does not count, because a default name is always present.

Each status is shown as text, with colour only as a supporting cue: *Not configured* is peach, *Partially configured* amber, *Configured* and *No exclusions* green.

## 5. How later stories will use this

None of the following exists yet. This section describes the intended use so that today's data shape fits it.

- **Discovery (after the lead core):** geographies and company criteria will become search parameters for whichever discovery provider a workspace connects. Providers will be generic adapters, so the ICP never names one.
- **Decision-maker identification:** titles will be matched in priority order (primary → secondary → fallback), using the seniority hint to break ties.
- **Grading (implemented in P1-E6, `vleeds-lead-scoring.md`):**
  - Each company gets a deterministic fit score from 0–100 per profile and revision.
  - Category weights are each category's share of the score. Categories without criteria are left out of the denominator; the saved weights are never rewritten.
  - Enabled buying signals contribute their weight within the buying-signal category, from **signal observations** recorded per company and revision.
  - Penalty exclusions subtract points; hard exclusions make the outcome **Excluded** (no grade).
  - The thresholds turn the score into A/B/C.
  - Data coverage is reported separately from fit.
  - ICP notes are never scored.
  - Editing any section raises the revision, so earlier results show as **Outdated** until recalculated. Observations are not carried over to a new revision.
- **Campaigns:** a campaign will target one ICP profile. When campaigns arrive they will snapshot the profile (or pin its revision) so later edits do not silently change a running campaign.

## 6. Deliberately not implemented

Company discovery, maps/places lookups, enrichment, contact or phone lookups, calling, campaigns, lead records, AI-generated profiles or signals, profile switching/archiving UI, and history of past revisions.
