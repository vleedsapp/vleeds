# Vleeds — Manual contact workflow

Status: implemented in P1-E7 · Code: `src/lib/contact-workflow/*` (pure rules), `src/lib/dal/{contact-workflow,today}.ts`, `src/app/w/[workspaceId]/today/actions.ts`, `src/components/workflow/*` · Migration: `20261015000000_today_contact_workflow.sql`

Vleeds helps a seller decide **who to call next** and remember **what happened**. The seller calls from their own phone or system; Vleeds records the outcome they enter. Vleeds doesn't place calls, send email or SMS, or run campaigns.

The loop:

> current A/B company → eligible contact with a phone → Today → manual call → outcome → callback / follow-up → due task → activity history → Today again

## 1. Workspace time zone

Each workspace has an IANA time zone (`UTC`, `Europe/London`, `America/Chicago`, …). New and existing workspaces start on **UTC**. Owners and admins change it under **Settings → Business profile → Time zone**; members can see it. The browser's time zone is never stored implicitly.

The time zone decides:
- what **today** means (the calendar day in the workspace zone, not UTC and not the viewer's device)
- how typed dates and times are read (for example "Callback · 14 Oct · 14:00" in Europe/London)
- how times are shown, such as "Today · 10:42" and "Tomorrow · 14:00"
- whether a task is overdue, due today or later

All timestamps are stored in UTC (`timestamptz`). Conversions use a maintained library (`@date-fns/tz`) and the runtime's time-zone data, so daylight-saving changes are handled: a local day can be 23 or 25 hours long. A local time that doesn't exist because clocks jump forward (for example 02:30 on the spring-forward night) moves forward by the gap.

## 2. Start contact

**Call** (on Today) or **Start contact** (on a contact in the company drawer) opens a focused sheet showing:
- the company, with its grade and fit
- the contact, with job title and phone
- the last attempt ("Never contacted" or "Yesterday · 16:05 · No answer")
- the due task, if the contact has one

From the sheet the seller can:
- **Copy number**
- **Call on device**, a normal `tel:` link handled by their own phone or system

**Opening the sheet, copying the number or following the `tel:` link records nothing.** An attempt exists only when the seller submits an outcome. Vleeds makes no network request for the `tel:` link and does no call tracking.

A restricted company or contact, a contact who left the company, or a contact without a phone can't be called. The sheet says why, and the server refuses the attempt.

## 3. Outcomes (dispositions)

| Outcome | What it records | Next action |
| --- | --- | --- |
| No answer | the attempt | optional **retry call** (date + time) |
| Left voicemail | the attempt | optional **retry call** |
| Connected — interested | the attempt | optional **follow-up**; qualification is NOT changed |
| Connected — not interested | the attempt | none; no restriction, no qualification change |
| Callback requested | the attempt | **callback, date + time required** |
| Follow-up needed | the attempt | **follow-up, date + time required** |
| Wrong number | the attempt | none; "Try another contact at this company if one is available." The number is kept and nothing is restricted. |
| Do not contact | the attempt + a **do-not-contact restriction** | scope required: **This person** or **Entire company**; open tasks in that scope are cancelled |
| Other | the attempt; **a note is required** | optional next action |

Notes are optional, up to 1,000 characters (except for Other, which requires one). Times are read in the workspace time zone and must be in the future.

**Dispositions never change** qualification, the ICP score, grade or fit. The only exception is **Do not contact**, which creates a restriction using the existing rules: any member may add one, and only owners and admins can lift it. "Not interested" is a contact outcome, not a restriction.

## 4. Tasks: one next action per contact

A task is a contact's **next action**:
- kinds: **Callback**, **Follow-up** and **Retry call**
- statuses: open, completed or cancelled

Each contact has **at most one open task**, enforced by the database. To change the next action, reschedule the open task; a second one is never created alongside it.

- **Schedule follow-up**, from the drawer: choose the contact, kind, date, time and an optional note. If the contact already has an open task, the drawer shows it with **Reschedule** instead.
- **Reschedule** changes only the due time. The task keeps its identity, creator and creation time.
- **Complete** marks the task handled **without** recording a call (handled elsewhere, or no longer needed). No attempt is created.
- **Cancel** closes the task. Completed and cancelled tasks stay in the history.
- **Logging an outcome from a task** (Call on a due item) completes that task automatically, in the same transaction as the attempt.
- If an outcome schedules a next action while the contact still has another open task, that task is replaced (cancelled).

Overdue, Due now and Later today are **not stored**. They are calculated from the due time, the current time and the workspace's today.

A task can become **blocked** if, after it was scheduled:
- the company or contact was restricted
- the contact left the company
- the contact no longer has a phone
- the company or contact was archived

A blocked task is never deleted and never counted as actionable. Today lists it under **Needs attention** with the reason and **Cancel task**.

## 5. One transaction per outcome

`public.record_contact_attempt` runs as the signed-in user and does everything in one transaction:
1. re-checks membership, that the contact belongs to the company and workspace, and current restrictions
2. appends the attempt, using server time
3. completes the source task
4. creates the next task
5. adds the restriction and cancels tasks in its scope, for Do not contact

The browser sends ids, choices and the typed local date and time; the server converts the time with the workspace zone. The database repeats every check, so neither a missing check in the UI nor a stale screen can bypass it.

Submitting the same form twice (a retry or double click) returns the attempt that was already recorded. Each sheet carries a request id for this.

Attempts are **history**: they can't be edited or deleted through the application or the API. Correcting or voiding an attempt would need an explicitly designed feature.

## 6. Activity timeline

The company drawer has an **Activity** section, newest first and limited to the most recent 30 attempts and tasks. It shows:
- **Attempts:** time, outcome, contact, note and who recorded it ("by you" / "by a teammate")
- **Tasks:** kind, due time, status (Open / Completed / Cancelled), contact and note

Each contact also shows its last contact and its open task. Internal ids are never shown.

## 7. What it intentionally does not do

- No calling provider, call recording, email, SMS, campaigns or automated follow-up.
- No automatic qualification, scoring or restriction from ordinary outcomes.
- No generic CRM: no deals, pipelines, opportunities or project tasks.
- No automatic retries: Vleeds never invents a retry date.
- Contact history is not a scoring input. Attempts, tasks and dispositions are not part of the ICP fingerprint, so logging calls never makes a score outdated.
