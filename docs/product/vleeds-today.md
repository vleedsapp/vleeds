# Vleeds — Today

Status: real data since P1-E7 · Code: `src/app/w/[workspaceId]/today/*`, `src/lib/dal/today.ts`, `src/lib/contact-workflow/{eligibility,queue}.ts`, `src/components/today/*`

Today answers one question: **what should I do now?** It keeps the canonical Today design: summary cards, a tabbed work panel in the lead-table language, and the mobile layout. It is not a CRM dashboard; every number is a real count of something to act on or something done today.

"Today" is the calendar day in the **workspace time zone** (shown as "Times in …" under the page title). Its start and end are computed in that zone and converted to UTC for queries.

## Summary cards

| Card | Counts |
| --- | --- |
| **Ready to contact** | companies with a recommended contact in the Ready queue |
| **Callbacks due** | open, actionable callback tasks due by the end of today |
| **Follow-ups due** | open, actionable follow-up and retry-call tasks due by the end of today |
| **Contacted today** | contact attempts recorded today (workspace day) |

Blocked tasks are not counted. Copying a number, following a `tel:` link or opening a drawer is never counted as contact.

## Work panel (tabs)

- **Lead Queue:** Ready to contact (below).
- **Callbacks / Follow-ups:** due work, ordered overdue first, then by due time, then a stable id. Each item shows:
  - **Overdue**, **Due now** or **Later today** (as text, not only colour)
  - the kind and the time
  - company, contact, job title, a tappable phone and a short note
  - **Call**, **Reschedule**, **Complete** and **Cancel task**

  Overdue = due before today began; Due now = due today and not after now; Later today = later today.
- **Contacted today:** today's attempts with time, contact, company, outcome, note and "by you"/"by a teammate". It shows the 25 most recent; the count is complete.

When a callback or follow-up is due now or overdue, Today opens on that tab; otherwise it opens on the Lead Queue.

## Ready to contact

A company is ready when **all** of these hold (default ICP only):
- it is active and the workspace has a default ICP
- its result for the default ICP is **current** (same revision and fingerprint, P1-E6) with **grade A or B**; never C, Excluded, Outdated or Not scored
- its qualification is **unreviewed or qualified** (not needs review, not unqualified)
- it has no active company restriction
- at least one **eligible contact**

A contact is eligible for the phone queue when:
- it hasn't left the company and has a usable phone (at least 3 digits)
- it isn't restricted
- it has no open task: a future task waits for its day, and a due task is listed under due work
- its latest outcome doesn't keep it out:
  - *not interested* and *wrong number*: never returned to Ready automatically (schedule a task deliberately to revisit)
  - *no answer*, *voicemail*, *interested*, *other* (with no task): not again on the same workspace-local day; eligible again the next day
  - *callback / follow-up needed*: their task decides when the contact returns
  - *do not contact*: governed by the restriction

**One item per company**, with one recommended contact. Among the eligible contacts, the first match decides:
1. a primary-role title match (default ICP decision-maker roles; the same whole-word matching as scoring and contact discovery)
2. a secondary-role match
3. a fallback-role match
4. the contact marked primary
5. name, then id

If the best contact isn't eligible, the next eligible one is used. If nobody is callable at all, the company appears under Needs attention.

**Order:** grade A before B, then fit descending, then name. Data coverage never reorders fit.

**Limit:** Today shows 25 ready companies ("Showing 25 of N leads" · **View all Leads**). The count covers the full set, up to 2,000 candidate companies.

Each ready item shows:
- grade, fit, company and location
- the recommended contact, job title and phone
- the last contact ("Never contacted" or "Yesterday · 16:05 · No answer")
- **Call**

## Needs attention

A compact area that appears only when something needs action:
- **Outdated scores:** links to Leads filtered by Outdated. Outdated scores never feed Ready.
- **A/B companies that need a callable contact:** links to the company, where you can add a contact or Find decision makers.
- **Blocked tasks:** shown with the reason (restricted, left the company, no phone) and **Cancel task**.

## Refresh lead scores

Lead scores are never calculated automatically when Today loads or when data changes. **Refresh lead scores** is an explicit button that:
- evaluates up to **50** active companies whose default-ICP result is **not scored or outdated**, unscored first
- uses the same P1-E6 evaluator and the trusted score writer
- calls no provider
- reports a concise result, for example "Evaluated 38 · A: 9 · B: 14 · C: 12 · Excluded: 3", plus "27 more leads need evaluation" when more remain; click again to continue

New results affect Today immediately. A hard-excluded company never enters Ready.

## Empty and calm states

- No default ICP: "Set a default ICP to build your Today queue." (links to Settings)
- Unscored or outdated leads and nothing ready: "Evaluate leads to create your daily queue."
- Nothing ready: "No prospects are ready to contact right now."
- No callbacks or follow-ups due: calm "No callbacks due" / "No follow-ups due".
- Everything done: "Today's work is done", with the number of attempts recorded today.

## Mobile

- Summary cards stay compact (four in a row).
- The tabs remain available.
- Ready rows become cards with a tappable phone number and a 44 px Call button.
- Due items wrap their actions.
- The bottom navigation is unchanged and nothing scrolls sideways.
