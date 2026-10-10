# Vleeds — ICP evaluation and lead scoring

Status: implemented in P1-E6 · Code: `src/lib/scoring/*` (pure engine), `src/lib/dal/{scoring,lead-scores}.ts`, `src/app/w/[workspaceId]/leads/scoring-actions.ts`, `src/components/scoring/*` · Migration: `20261014000000_icp_lead_scoring.sql`

Scoring answers one question: **how well does this company match this ideal customer profile (ICP), and why?** The answer is deterministic and explainable, and it is tied to an exact ICP revision. It uses only durable Vleeds data (no AI, no provider calls, no transient discovery content).

## 1. Fit and coverage are different things

| | Meaning | Example |
| --- | --- | --- |
| **Fit score** (0–100, grade A/B/C) | How well the *known* facts match the ICP | 90 |
| **Data coverage** (0–100%) | How much of the configured ICP Vleeds could actually check | 35% |

"Fit 90, coverage 35%" means that what Vleeds knows looks strong, but most of the ICP is still unchecked. "Fit 55, coverage 95%" means that Vleeds knows the company well and the fit is moderate. Coverage never changes the fit score; it is shown next to it with this explanation.

## 2. Categories and effective weights

The ICP's saved scoring model (P0-E1-S2) is authoritative: thresholds A/B and four category weights that sum to 100. A category takes part only if the ICP **configures** it:

| Category | Configured when |
| --- | --- |
| Company fit | at least one of industries, company size, characteristics or keywords is set (notes are never scored) |
| Geography | at least one target geography exists |
| Decision makers | at least one decision-maker role exists |
| Buying signals | at least one *enabled* buying signal exists |

Unconfigured categories leave the **denominator**; the saved weights are never rewritten. With weights 40/20/20/20 and no buying signals, the denominator is 80, so the score is `(company×40 + geography×20 + decision makers×20) / 80`. The result shows each category's configured weight and its effective share.

If the ICP has no scoring model, or no configured category with weight above zero, Vleeds shows **"This ICP does not have enough criteria configured to evaluate companies."** with a link to Settings, and produces no score.

## 3. How each category is scored (raw 0–100)

All text matching is literal: lower-case, Unicode-normalized, punctuation treated as spaces, and the phrase must appear as **whole words** ("Marine robotics" matches "Marine robotics and ROV services"; "multi-location" does **not** match "several branches"). There is no fuzzy, semantic or AI matching.

**Company fit** is the average of its configured groups, so twenty keywords can't outweigh the rest:
- **Industry:** 100 if any ICP industry appears in the company's industry or its tag evidence; 0 otherwise. With no industry data: 0 and *unknown* ("Industry data unavailable", which is different from "no match").
- **Company size:** interval comparison of the company's employee range with the target. Fully inside → 100; overlapping → 50; outside → 0; open-ended bounds respected; no employee data → 0, unknown. For example: "Employee range 25–50 overlaps target 20–100".
- **Characteristics / keywords:** each phrase is found or not found in the company text (name, industry, description, tag evidence). The group score is the share found. With no description, industry or tags, they are *unknown*.

**Geography:** structured location only (no geocoding).
- A country target needs the same country.
- A region target needs the same country and region.
- A city target needs the same country and city (and region, if the target has one).
- Any match → 100. A location outside every target → 0. Missing data (or data too general for the target) → 0, unknown.

**Decision makers:** saved contacts only (people who *left the company* are ignored; search candidates that were never saved don't count). Titles are matched like contact discovery (P1-E5). The best priority found decides: **primary 100, secondary 70, fallback 40**, none 0. With no contacts: 0, unknown. Provider decision-maker flags, seniority or the number of contacts add nothing.

**Buying signals:** `sum(weights of signals observed present) / sum(weights of all enabled signals) × 100`. Absent → 0. Unknown → 0 and lower coverage.

## 4. Signal observations

The ICP defines signals; whether a company shows one is a **structured observation** recorded by a person in the evaluation sheet: *Present*, *Not present* or *Unknown*, with an optional note. Unknown means no record. Observations belong to the ICP **revision** they were made for and are not copied to a new revision, because a new revision may change what a signal means. The database checks that the signal exists in the profile with that kind. Vleeds never infers signals from text or websites. Future evidence-driven detection can write the same records.

## 5. Exclusions, penalties and grades

- Only enabled exclusions observed **present** count; unknown and absent never exclude.
- **Hard exclusion** → outcome **Excluded**: no A/B/C grade, with the reason shown (e.g. "Excluded · Reason: Consumer-only business"). The breakdown is still shown for explanation.
- **Penalty** → its points are subtracted from the base score (summed, not weighted).
- `final = clamp(base − penalties, 0, 100)`, rounded once with `Math.round`. One server-side engine computes it; the UI never recalculates.
- **Grade:** A if final ≥ the profile's A threshold; B if ≥ its B threshold; otherwise C. The saved thresholds decide; nothing is hard-coded.

Example (weights 40/20/20/20; raw 85/100/70/50; one 10-point penalty): weighted 34 + 20 + 14 + 10 = 78, minus 10 = **68 → B** with thresholds 75/50.

## 6. Coverage

Each configured criterion is one unit:
- industry
- size
- each characteristic
- each keyword
- geography
- decision makers
- each enabled buying signal
- each enabled exclusion

A unit is *known* when the company value exists, contact data exists, or the signal was marked present/absent. `coverage = known / configured × 100` (rounded). The result lists what is missing ("Company industry", "Decision-maker contacts", "2 buying-signal observations") under **Improve data coverage**. It points to the existing actions (Enrich company, Find decision makers, Review signals), and nothing runs automatically.

## 7. Current or outdated

A stored result is **current** only if:
1. it was produced for the profile's **current revision**, and
2. its **input fingerprint** equals the fingerprint of the company's scoring inputs **now**.

The fingerprint is a SHA-256 of a canonical document containing only scoring-relevant facts:
- company industry/description/size/location/name
- tag evidence
- the titles of active contacts
- the signal observations
- the ICP configuration

It is built by one database function (`public.scoring_input`). The server evaluates exactly that document, and the Leads list uses the same function, so a company edit, an enrichment, a new or changed contact, a contact leaving, a signal change or an ICP edit all make an old result **Outdated**. Timestamps, notes, qualification and contact names don't. Nothing is changed by background triggers; the comparison is the source of truth. **Recalculate fit** evaluates again. For the same revision this updates the existing result; a new revision gets its own row, and older ones stay readable as history.

## 8. Where it shows

- **Company drawer → ICP Scores:**
  - the default ICP's result: grade badge and text, "Grade A · 84 fit", coverage, Current/Outdated (and why), and a signals summary ("Signals 2 confirmed · 1 unknown")
  - **Evaluate fit** / **Recalculate fit**
  - other profiles' results
- **Evaluation sheet:**
  1. ICP and signal review: profile (any active profile), revision, weights, thresholds, signals with "Weight N" / "If present: −20" / "If present: Excludes company", **Save signals only**, **Evaluate fit**
  2. Result: score, grade, coverage, Current/Outdated, breakdown (fit %, configured/effective weight, points, penalty), **Why this score?** and **Improve data coverage**
- **Leads:** the Grade column shows the **default ICP**'s current result:
  - a grade with "84 fit"
  - **Excluded**, **Outdated** or "—" (not scored)
  The Grade filter offers A, B, C, Excluded, Outdated and Not scored, and sorting by grade puts current grades first. An old grade is never shown as current. Without a default ICP, Leads shows "Not scored"; companies can still be evaluated by choosing a profile in the sheet.

## 9. What scoring never does

- **No qualification changes.** An A grade doesn't qualify a company; qualification stays the team's decision (a company can be an A fit and still be unqualified for other reasons).
- **No suppression changes.** An exclusion means "bad fit for this ICP"; do-not-contact means "never contact". They are different concepts and records.
- **No provider calls** (Google, Hunter or any other), no web crawling and no AI. Provider usage totals don't change when a company is scored.
- **No trust in the browser.** The browser sends a company id, a profile id and signal choices. The server re-reads everything, runs the engine and stores the result through the trusted score writer. That writer refuses a result whose revision or fingerprint isn't current, or whose grade doesn't follow the profile's thresholds.

## 9a. Trusted score persistence (since P1-E7)

In P1-E6, any authenticated member could call the score-save function directly with values they made up, provided those values matched the current fingerprint and thresholds. P1-E7 closes that write boundary:
- The normal authenticated API role can **no longer persist a score**. `public.save_lead_score_trusted` is executable only by the server's trusted database role (`service_role`), and the old `save_lead_score` is gone.
- **Evaluate fit** and **Refresh lead scores** are server actions. They:
  1. authenticate the user
  2. re-read the canonical scoring input
  3. run the same pure evaluator
  4. hand the result to a tiny `server-only` writer (`src/lib/supabase/trusted-score-writer.ts`), the only code that uses `SUPABASE_SERVICE_ROLE_KEY`, and only for this one function
- The trusted function **still** checks that the acting user (taken from the session, never from the browser) is a member of the workspace. It also checks the company and profile, the current revision and fingerprint, the outcome shape, and that the grade follows the thresholds. It records `scored_by`.
- Without the key configured, Vleeds says scores can't be saved on this server yet; nothing falls back to a weaker path.
- The bundle check fails the build if the key name, the writer or its function name ever reach browser code.

## 10. Multiple ICPs

A company can have a separate result for each profile and revision. Leads shows the default profile; the drawer lists the others. Today (P1-E7) uses only **current** A/B results of the default profile, and **Refresh lead scores** (an explicit batch of up to 50 unscored/outdated companies) uses the same engine and the same trusted writer (`vleeds-today.md`). Contact attempts and tasks are not scoring inputs.
