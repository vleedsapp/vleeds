# Vleeds — Adding Leads: Manual Entry and CSV Import

Status: implemented in P1-E2 · Code: `src/lib/imports/*`, `src/lib/dal/imports.ts`, `src/app/w/[workspaceId]/leads/{actions.ts,import/*}`, `src/components/imports/*`, `src/components/leads/{add-leads-menu,add-contact-sheet,restriction-control,lead-filters,pagination}.tsx` · Migration: `20261010000000_manual_csv_ingestion.sql`

P1-E2 adds two controlled ways to fill the lead core (`vleeds-lead-core.md`): typing a company in by hand, and importing a spreadsheet. Both use the **same** normalization (`src/lib/lead-core/normalize.ts`), validation (`src/lib/lead-core/schemas.ts`) and duplicate rules (`src/lib/lead-core/dedupe.ts`), and both write through the same database function (`public.ingest_lead`). Nothing here is specific to a business, industry, country, job title or provider.

## 1. Where to find it

**Leads → Add leads** opens a small menu:

- **Add manually**: one company, optionally with its first contact.
- **Import CSV**: the staged import workflow (§3).

An empty workspace also offers **Import a CSV** in its empty state. Contacts can be added to an existing company from the company drawer (**Add contact**).

## 2. Manual entry

**Company form:** company name (required), website, primary domain, phone, country / region / city, employee minimum and maximum, notes, and an optional first contact (full name, job title, email, phone). Only the name is required.

When **Add company** is pressed, the server validates and normalizes the input, then looks for possible duplicates in this workspace using the P1-E1 rules:

| Match | What the user sees |
| --- | --- |
| Same domain (or provider record) | "This company may already exist", the existing company, **Use existing**. It can't be added again, because a domain identifies one company (the database enforces one active company per domain). |
| Same international phone, or the same name in the same place | The possible matches, **Use existing**, or **Add as a separate company** to confirm they really are different. |
| None | The company is created and opened in the drawer. |

If the first contact's email already belongs to a contact in the workspace, the contact is refused with an explanation.

**Add contact** (company drawer): full name (or first and last name), job title, seniority, email, phone, profile URL, notes and a **Primary contact** checkbox.

- An email that already belongs to a contact is refused. Email is a strong identity.
- The same name at the same company asks first: **Add anyway** if it is a different person.
- A company can have only one primary contact. The checkbox is disabled when one exists, and the database enforces it too.
- The first contact of a company without a primary becomes primary by default.

**Evidence:** each non-empty field the user entered is recorded as `lead_sources` evidence with `source_kind = manual`. Keys are `company.name`, `.website`, `.domain`, `.phone`, `.location`, `.employee_range`, `contact.name`, `.title`, `.seniority`, `.email`, `.phone` and `.linkedin`. Empty fields create no evidence.

The company, the contact and the evidence are written as **one transaction**.

## 3. CSV import: the staged workflow

```
Upload → Map → Review (validate, match, decide) → Import → Report
```

A file is **never** written straight into companies and contacts. Its rows are staged first (`import_batches`, `import_rows`). Nothing reaches the lead core until the user presses **Import N rows**. The URL of an import (`/leads/import/<id>`) is stable, so a reload or a later visit returns to the same step. **Leads → Import CSV** also lists recent imports.

### 3.1 Upload

| Limit | Value |
| --- | --- |
| Format | `.csv` only. XLS/XLSX are not read; save them as CSV first. |
| Size | 5 MB (the Server Action body limit is 6 MB to allow for upload overhead) |
| Rows | 5,000 data rows |
| Columns | 100 |
| Cell | 1,000 characters (longer is a row error) |
| Encoding | UTF-8 with or without BOM; otherwise Windows-1252 (common legacy exports) |

The extension and size are checked in the browser for quick feedback and **again on the server**. The browser-reported file type is not trusted. The file is then parsed with **Papa Parse** (a mature parser), which handles quoted commas, quoted line breaks, escaped quotes and CRLF/LF/CR. The first non-blank line is the header row. Blank rows are dropped, short rows are padded and long rows are trimmed to the header width. Blank or repeated column names get unique labels ("Email", "Email (2)"). An unclosed quote rejects the file, because it can't be read reliably.

Values are **only ever text**. Nothing is evaluated: a cell such as `=SUM(A1)` stays the literal string.

**File lifecycle:** the file is read into memory by the upload server action, parsed, and discarded when the request ends. It is never written to disk or storage by Vleeds. Only the parsed cells of each row are kept (`import_rows.raw_data`, at most 16 KB per row; a pathological row is shortened).

### 3.2 Map

Each CSV column is matched to a Vleeds field or **Ignore this column**:

- **Company:** Company name, Website, Primary domain, Primary phone, Country, Region / state / province, City, Postal code, Address line 1 and 2, Employee minimum and maximum, Qualification state, Company notes.
- **Contact:** Contact full name, first name, last name, Job title, Seniority, Contact email, Contact phone, Profile URL, Contact notes.

Suggestions come from common, generic header names ("Company", "Website", "Email", "Zip", …). The user confirms or changes them, and sample values are shown for each column. Ignored columns need no action. Each field can be used by **one** column. **Company name is required**, because every imported row must identify a company. The mapping is saved with the batch. There are no reusable mapping templates yet.

### 3.3 Validate and match

**Continue to review** maps, normalizes and validates every row, then matches it. Each row is shown as **Valid**, **Warning** or **Error**, with its messages listed under it and linked to its decision control.

| Errors (row can't be imported) | Warnings (row can be imported) |
| --- | --- |
| Missing company name (including contact-only rows: contacts must belong to a company) | Unknown country: the value is left out |
| Invalid website or domain | Unsupported qualification or seniority: the value is left out |
| Invalid email or profile URL | Website and domain point to different hosts: the domain is used |
| Employee minimum greater than maximum, or not a whole number | National phone number: kept as entered, but it can't be compared for duplicates |
| A value longer than 1,000 characters | |
| A contact without a name | |

One bad row never rejects the file. Invalid rows are simply not imported.

**Matching** uses the P1-E1 hierarchy (`dedupe.ts`) against this workspace's active companies **and the earlier rows of the same file**, so a file that lists a company twice doesn't create it twice.

| Match | State | Suggested decision | Allowed |
| --- | --- | --- | --- |
| Same domain or provider record as an existing company or an earlier row | **Matched** | Merge | Merge, Skip |
| Same international phone, or the same name in the same country and city/region | **Possible duplicate** | *none: the user decides* | Merge, Skip, Create new |
| No match | **New** | Create new | Create new, Skip |
| Errors | **Invalid** | Skip | — |

Low-confidence matches are never merged automatically. A strong domain match is preselected as Merge but can be inspected before import.

### 3.4 Review decisions

The review table (cards on phones) shows **Row, Company, Contact, Validation, Match, Decision**. The filters are **All**, **Ready** (will be imported), **Duplicates**, **Needs decision** and **Invalid**, each with its count, 50 rows per page.

For matched rows and possible duplicates, **Compare** opens a side-by-side view of the imported row and the existing company (or the earlier row): name, domain, location, phone and primary contact. It offers:

- **Merge**: add missing details to the existing company (§4).
- **Skip**: leave the lead core unchanged; the row is recorded as skipped.
- **Create new** (create separately): make a separate company, for genuinely different companies. For a **domain match this is unavailable**, and the sheet says why: a domain identifies one company, so it can't be created twice. The user chooses Merge or Skip. The domain rule is not weakened for convenience.

**Back to mapping** recomputes everything from the raw cells. Decisions are replaced by fresh suggestions, and nothing has been written yet. **Cancel import** marks the batch *cancelled*; nothing is written to the lead core.

### 3.5 Confirm and import

Above the rows a summary shows the numbers the import will produce, for example *29 new companies · 2 merges · 1 skipped · 2 invalid · 1 need a decision · 34 rows in file*. The button reads **Import 31 rows**, which is exactly the number of create + merge decisions. Invalid rows and rows without a decision are not imported. A row without a decision is recorded as skipped, and the summary says so beforehand.

The import runs in **chunks of 100 rows**, one server action per chunk, with a progress line ("Importing… 120 of 340 rows processed", announced politely to screen readers). If the page is closed, reopening the import continues where it stopped.

### 3.6 Report

When every row has an outcome, the batch is **completed** and the page becomes the **Import report**: Total rows, Created, Merged, Skipped, Invalid and Failed. Below them is a row-by-row list (All, Created, Merged, Skipped, Invalid, Failed). Each row shows its outcome and a link to the company, and lists any notes: kept values on a merge, a contact that wasn't imported, or the reason a row failed. Example:

```
Row 1 — Merged · Kept existing website "https://www.example.test/about" (import had "https://www.example.test")
Row 2 — Created
Row 4 — Invalid: Missing company name. Contacts must belong to a company.
Row 6 — Skipped by decision
```

A completed import shows no Import action. Reloading or retrying can't import it again (§5).

## 4. Merge rules (exact)

A merge never overwrites existing data. Implemented in `src/lib/imports/merge.ts`:

1. A **blank** imported value never changes anything.
2. An imported value **fills a field that is empty** on the existing company or contact.
3. **Equal** values need no change. Equality is case-insensitive; websites ignore a trailing slash; phones compare their normalized form, or their digits.
4. **Different populated values:** the **existing value is kept** and the difference is reported in the row's notes ("Kept existing phone …"). The imported value is still recorded as CSV evidence, so nothing observed is lost.
5. **Names are never changed** by a merge. A different name is reported.
6. **Location** is filled only if the company has none. A different location is reported.
7. **Employee range:** empty ends are filled, unless that would make minimum > maximum (reported). Different values are reported.
8. **Qualification:** applied only while the company is *Unreviewed*. A team decision is never overwritten.

**Contacts in a merged row:**
- The imported contact is matched against the target company's contacts (`matchContact`). The same email is the same person.
- The same name at the company is merged and noted ("Contact merged into … (same name at this company)").
- Otherwise the contact is added. It becomes primary only if the company has no primary.
- If the email belongs to a contact at **another** company, the contact is not imported (noted). It is never moved or duplicated.
- The same applies to newly created companies. Contacts are never created without a company.

## 5. Commit, transactions and idempotency

- **One row = one transaction.** `public.ingest_lead()` writes the company (insert or merge patch), the contact and the evidence, and sets the row's outcome, all together. If any part fails (for example a domain claimed by another company in the meantime), nothing from that row is written and the row is marked **Failed** with a plain reason. The other rows are unaffected: a failure in row 5,000 never rolls back rows 1–4,999.
- **Rows are committed in file order**, so a row that merges into a company created by an earlier row of the same file finds it. If that earlier row was skipped or failed, the later row creates the company instead.
- **Double commits are impossible:**
  - `ingest_lead()` locks the staged row, returns the recorded outcome if it already has one, and refuses to run unless the batch is *processing*.
  - A database trigger freezes any row with an outcome.
  - Only one review → processing transition can succeed, so a double click can't start two imports.
  - A *completed* or *cancelled* batch can't change again; it can only be archived.

## 6. Traceability

CSV evidence uses `source_kind = csv` with no provider key: a spreadsheet is not an external provider. Each evidence row carries `import_batch_id` and `import_row_id`, so "which import created or updated this company?" is answered from `lead_sources`. Both columns are nullable, because manual and future provider evidence has no import. They are same-workspace foreign keys and immutable once written. Each import row also records the company and contact it created or merged into. Evidence holds the observed value of a single field, never the whole row.

## 7. Retention

- **Kept:** import metadata (file name, counts, status, mapping, dates) and each row's outcome, notes and links. This is the operational record of what an import did.
- **Kept for now:** each row's parsed cells (`raw_data`) and normalized values (`normalized_data`), at most 16 KB per row. This includes cancelled imports, so they stay reviewable. **There is no automatic clean-up yet.** A later operational task should clear `raw_data` and `normalized_data` of completed and cancelled imports after a retention period, for example 90 days, keeping outcomes and counts. See the data-model doc §3c.
- **Never kept:** the uploaded file itself.
- Imports can't be deleted from the product UI.

## 8. Leads page additions

- **Pagination:** 25 companies per page, on the server, with Previous / Next and "Showing 26–31 of 31 companies". Thousands of companies are never loaded into the browser. A page past the end says so.
- **Filters:** Qualification, Grade (A/B/C/Not scored; real scores only), Restriction, Contacts (has / has none) and Country.
- **Sort:** Recently updated, Company name, Qualification, Grade.
- All of these live in the URL (`?qualification=…&page=2&company=…`), so views are shareable and the company drawer keeps working on any page. On phones the filters fold behind a **Filters** button. Full text search is **not** included; it is left for a later story.

## 9. Restrictions in the drawer

- **Do not contact this company** / **Do not contact** (per contact) adds a restriction with an optional reason. Any member can do this.
- **Lift restriction** is shown to owners and admins. Members see "Only an owner or admin can lift this restriction." The role rules are unchanged from P1-E1, and RLS enforces them.

## 10. Who can do what

| | Owner | Admin | Member | Other workspaces |
| --- | :-: | :-: | :-: | :-: |
| Add companies/contacts manually | ✓ | ✓ | ✓ | ✗ |
| Upload, map, review, import, cancel CSV imports | ✓ | ✓ | ✓ | ✗ |
| See the workspace's imports and reports | ✓ | ✓ | ✓ | ✗ |
| Add a restriction | ✓ | ✓ | ✓ | ✗ |
| Lift a restriction | ✓ | ✓ | ✗ | ✗ |

## 11. Limitations

- CSV only, 5 MB / 5,000 rows per file. A 5,000-row import runs as 50 chunk requests, each a series of single-row transactions. That is fine on a normal connection, but the browser tab must stay open; reopening resumes. There is no background job queue.
- Phones are compared only in international format (P1-E1 limitation).
- There is no editing of existing companies yet (**Edit company** was left out, to keep this story focused). Corrections are made by merging or by future editing.
- There are no reusable mapping templates, no full text search, and no automatic retention clean-up.
- Row numbers count data rows after blank lines are removed. They match the spreadsheet row minus the header, unless the file contains blank lines.

## 12. What comes next

**P1-E3: automated company discovery.** A provider adapter will produce staged results that go through the **same** pipeline: normalization, matching, review decisions, `ingest_lead`, and evidence with a provider key. Discovery, enrichment, scoring and contact actions are not part of P1-E2.
