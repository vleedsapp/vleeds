# Vleeds — Data Model

Status: **implemented** = organizations, memberships, workspaces (P0-E1-S1); icp_profiles (P0-E1-S2); companies, contacts, lead_sources, lead_scores, suppression_records (P1-E1); import_batches, import_rows, lead_sources import traceability, ingest_lead / stage_import_rows / list_companies functions (P1-E2); discovery_runs, discovery_candidates, provider_usage_events (P1-E3); company_enrichment_runs, company_enrichment_results, companies.industry/description, provider credit estimates, ingest_lead v2 (P1-E4); contact_discovery_runs, contact_discovery_candidates, commit_contact_candidate, one open enrichment run per discovery reference (P1-E5); company_signal_observations, lead_scores outcome/fingerprint/coverage/explanation, scoring_input, save_lead_score, list_companies currentness (P1-E6); workspaces.timezone, save_lead_score_trusted (replaces save_lead_score), contact_attempts, follow_up_tasks, record_contact_attempt and task functions, today_ready_candidates, today_due_tasks (P1-E7). Everything else here is a **plan**, to be refined and approved story by story. Tenancy rules: `vleeds-tenancy.md`.

## 1. Entity map

```
organizations ─┬─< memberships >── auth.users
               ├─< suppression_list            (planned: org-wide, value-based)
               └─< workspaces ─┬─< icp_profiles ─┬──────────────┐
                               ├─< campaigns >───┘ (planned)    │
                               ├─< provider_connections (planned)│
                               ├─< discovery_runs ─< discovery_candidates (provider REFERENCES; P1-E3)
                               │        └──< provider_usage_events     (request accounting; + estimated credits, P1-E4)
                               ├─< company_enrichment_runs ── company_enrichment_results (1:1; P1-E4)
                               │        ╎ discovery_candidates (origin) · companies (target/matched/committed)
                               ├─< import_batches ─< import_rows  (staged CSV; P1-E2)
                               │        ╎               ╎ (traceability, nullable)
                               ├─< companies ─┬─< contacts       │
                               │              ├─< contact_discovery_runs ─< contact_discovery_candidates (staging; P1-E5)
                               │              │        ╎ icp_profiles (profile + revision) · matched/committed → contacts
                               │              ├─< lead_scores >──┘ (profile + revision)
                               │              ├─< lead_sources   (evidence; company and/or contact; ╎ import batch/row)
                               │              ├─< suppression_records (company or contact)
                               │              ├─< activities     (planned)
                               │              └─< follow_ups     (planned)
                               └─ campaign_leads (planned)
```

**A "lead" is a company in a workspace** (with its contacts, evidence, qualification, scores and restrictions). There is no separate `leads` table. The UI's *Leads* view lists the workspace's active companies.

## 2. Conventions (all workspace-owned tables)

| Convention | Rule |
| --- | --- |
| Keys | `id uuid primary key default gen_random_uuid()` |
| Tenant column | `workspace_id uuid not null references workspaces(id) on delete cascade`, indexed, immutable (`prevent_tenant_key_change`) |
| Same-workspace references | Parents declare `unique (workspace_id, id)`. Children use composite FKs, e.g. `foreign key (workspace_id, company_id) references companies (workspace_id, id)`. A contact can therefore never point at another workspace's company, even with a guessed id. |
| Audit | `created_at`, `updated_at` (trigger), `created_by uuid default auth.uid()` (no column grant) |
| Soft state | `archived_at` where users may hide records. Hard deletes are admin-only where allowed at all. |
| Configurable data | Business-specific criteria live in validated `jsonb` with a `schema_version int`. The shape is defined by a Zod schema in `src/lib/config/*` and a `CHECK (jsonb_typeof(...) = 'object')`. Never encode a business rule as an enum value or column name. |
| Normalization | Domains lower-cased without scheme/`www.`; phones in E.164; emails lower-cased. Stored in `*_normalized` generated columns for dedupe and suppression matching. |
| RLS | `select` → `private.is_workspace_member(workspace_id)`. Writes → member or `private.has_workspace_role(workspace_id, roles)` (exists since P0-E1-S2) depending on the table. Configuration tables (icp_profiles) are owner/admin-write. `delete` → admin/owner, or not at all. |

**RLS performance for high-volume tables.** Per-row `is_workspace_member(workspace_id)` is fine at P0 scale. For companies, contacts and activities, add:

```sql
create function private.my_workspace_ids() returns setof uuid
  language sql stable security definer set search_path = '' as $$
  select w.id from public.workspaces w
  join public.memberships m on m.organization_id = w.organization_id
  where m.user_id = (select auth.uid()) $$;
-- policy: using (workspace_id in (select private.my_workspace_ids()))
```

The planner evaluates this once per statement, not per row.

## 3. Implemented (P0-E1-S1)

### organizations
`id, name (1–120), slug (unique, kebab-case), created_by, created_at, updated_at`. No direct insert: use `create_organization()`. No delete in P0.

### memberships
`id, organization_id, user_id, role (owner|admin|member), created_at, updated_at`; `unique (organization_id, user_id)`. Tenant keys immutable; last owner protected.

### workspaces
`id, organization_id, name, slug (unique per org), description (≤2000), website_url (http/https), primary_domain (validated hostname), logo_url (https), settings jsonb (object), archived_at, created_by, created_at, updated_at`.

`settings` is reserved for small, non-relational preferences (e.g. timezone, locale, default country for phone parsing). Anything queried or validated relationally gets its own table below.

Business-profile editing (P0-E1-S2) writes only `name, primary_domain, website_url, description` through `updateWorkspaceProfile` (owner/admin via the existing `workspaces_update_admin` policy). `slug` does not change on rename. `logo_url` is not editable yet.

## 3a. Implemented (P0-E1-S2): icp_profiles

Migration `20261008000000_icp_configuration_foundation.sql`. Product meaning: `docs/product/vleeds-icp-configuration.md`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `workspace_id` | uuid → workspaces, cascade | Immutable (`prevent_tenant_key_change`). `unique (workspace_id, id)` for future composite FKs. |
| `name` | text 1–120 | |
| `description` | text ≤ 2000 | The ideal-customer description. |
| `is_default` | bool | At most one non-archived default per workspace (partial unique index `icp_profiles_one_default_per_workspace`). |
| `archived_at` | timestamptz | Soft delete. `CHECK (not (is_default and archived_at is not null))`: the default cannot be archived until another profile becomes the default, or until `is_default` is cleared in the same update. |
| `schema_version` | int | `CHECK (schema_version in (1))`. Identifies the jsonb shape. |
| `revision` | int ≥ 1 | Server-managed: no column grant, and a trigger sets it to old + 1 when any configuration column changes (otherwise it is unchanged). Used for optimistic concurrency. |
| `ideal_customer` | jsonb object, ≤ 32 KB | `{ industries: string[], companySize: { minEmployees, maxEmployees }, characteristics: string[], keywords: string[], notes }`. The DB enforces min ≤ max and min ≥ 0. |
| `target_geographies` | jsonb array ≤ 100, ≤ 64 KB | `[{ id, countryCode (ISO 3166-1 alpha-2), countryName (derived), region, city, label }]` |
| `decision_maker_titles` | jsonb array ≤ 50 | `[{ id, title, priority: primary\|secondary\|fallback, seniority: executive\|director\|manager\|individual_contributor\|null }]` |
| `buying_signals` | jsonb array ≤ 50 | `[{ id, name, description, weight 1–100, enabled }]` |
| `exclusion_signals` | jsonb array ≤ 50 | `[{ id, name, description, behavior: hard_exclude\|penalty, penalty 1–100\|null, enabled }]` |
| `scoring_model` | jsonb object, ≤ 8 KB | `{ thresholds: { a, b }, categoryWeights: { company_fit, geography_fit, decision_maker_fit, buying_signal_fit } }`. The DB enforces numeric `1 ≤ b < a ≤ 100`. |
| `created_by`, `created_at`, `updated_at` | | Standard audit columns; `created_by` is immutable. |

**NULL vs empty.** A NULL section has never been saved. A saved empty array is meaningful (an empty `exclusion_signals` array means "No exclusions"). Completeness rules: product doc §4.

**Validation layers.** (1) The editor runs the Zod schemas in `src/lib/config/icp.ts` for instant feedback. (2) Every server action re-runs the same schemas (strict objects, so unknown keys are rejected) and writes only a fixed column map per section, with no spreading of client input. (3) DB CHECKs enforce top-level types, list lengths, size caps, schema version and the core numeric bounds. Per-entry rules (weights, penalties, duplicates, ISO codes) are Zod-only, because CHECK constraints cannot iterate arrays without extra functions. Stored data is parsed again on read, and a section that does not match the schema is treated as unsaved and logged.

Item `id`s inside the jsonb arrays are client-generated UUIDs. They identify entries within one profile only and carry no authorization meaning.

**Permissions (RLS + column grants).** SELECT: `private.is_workspace_member(workspace_id)`. INSERT/UPDATE: `private.has_workspace_role(workspace_id, {owner, admin})` (new SECURITY DEFINER helper, `search_path=''`, not executable by anon). There is no DELETE policy or grant. INSERT grants exclude `id, created_by, revision, archived_at, timestamps`. UPDATE grants exclude `workspace_id, created_by, revision, timestamps`.

**Revision strategy.** `revision` increments on each configuration change. Saves send the revision they started from, and the update is filtered by it, so a concurrent edit gets "changed since you opened it" instead of a silent overwrite. There are no history rows or event sourcing. When campaigns arrive they will either copy the profile into an immutable campaign snapshot or pin `(icp_profile_id, revision)` together with a snapshot table. Lead scores will record the profile id and revision they were computed from.

**Default profile.** Settings edits the active default profile. The first save of any section inserts it with `is_default = true`, and a concurrent second "first save" fails on the unique index with a conflict. To change the default, clear the old one and set the new one in the same transaction (tested). There is no UI for this yet.

**Future relationships.** `campaigns.icp_profile_id` and `lead_scores.icp_profile_id` will reference `(workspace_id, id)`. Discovery providers will receive geographies and company criteria as generic search input. Scoring will consume `scoring_model` (see the product doc §5).

## 3b. Implemented (P1-E1): lead core

Migration `20261009000000_lead_core_foundation.sql`. Product meaning: `docs/product/vleeds-lead-core.md`.

**Company = the primary prospect record.** There is no `leads` table. Qualification (an operational team decision on the company) and ICP scores (calculated per profile and revision in `lead_scores`) are deliberately separate.

Common to all five tables:
- `workspace_id` → workspaces, cascade, indexed and immutable.
- Children reference parents through composite FKs `(workspace_id, parent_id)`, so cross-workspace links are impossible even for a member of both workspaces.
- `created_by default auth.uid()` (no grant).
- RLS with `private.is_workspace_member` / `has_workspace_role`, column-level grants, nothing for anon, and no DELETE grants.

| Table | Key columns | Integrity |
| --- | --- | --- |
| `companies` | `canonical_name` (display), `normalized_name`, `website_url`, `primary_domain` (normalized host), `primary_phone` + `primary_phone_normalized` (`+digits` or null), `location` jsonb ≤ 2 KB `{countryCode, region, city, postalCode, addressLine1, addressLine2}`, `employee_count_min/max`, `qualification_state` (unreviewed\|needs_review\|qualified\|unqualified), `qualification_reason` ≤ 500, `notes` ≤ 5000, `archived_at` | Unique `(workspace_id, primary_domain)` where active (archived rows don't block; other workspaces unaffected). Domain/phone format CHECKs; min ≤ max; immutable `workspace_id, created_by`. Indexes: `(workspace_id, archived_at)`, `(workspace_id, qualification_state)` active, `(workspace_id, normalized_name)` for matching. |
| `contacts` | `company_id`, `first_name`, `last_name`, `full_name` (required), `job_title`, `seniority` (same hints as ICP), `email` + `normalized_email`, `phone` + `phone_normalized`, `linkedin_url` (https), `is_primary`, `status` (active\|left_company\|unknown), `notes`, `archived_at` | FK `(workspace_id, company_id)`. `unique (workspace_id, company_id, id)` lets evidence and suppression require "this contact at this company". One active primary per company (partial unique); an archived contact can't be primary. Email/normalized pair CHECK; normalized email lower-case. Email is indexed but **not unique** (shared inboxes); ingestion decides. Immutable `workspace_id, company_id, created_by`. |
| `lead_sources` | `company_id?`, `contact_id?` (at least one), `source_kind` (manual\|csv\|public_dataset\|website\|api\|other), `provider_key` (free text `^[a-z0-9][a-z0-9_.-]{0,63}$`), `external_record_id` (needs provider key), `source_url`, `field_key` (`^(company\|contact)\.[a-z][a-z0-9_]*$`, documented keys in `KNOWN_FIELD_KEYS`), `observed_value` jsonb ≤ 2 KB, `confidence` 0–100 (data confidence, not fit), `observed_at` | **Append-only** (insert grant only). FKs for the company, the contact, and `(workspace_id, company_id, contact_id)` when both are given. Unique `(workspace_id, provider_key, external_record_id, field_key, company_id, contact_id) NULLS NOT DISTINCT` where an external id exists. |
| `lead_scores` | `company_id`, `icp_profile_id`, `icp_revision`, `score` 0–100, `grade` A\|B\|C, `breakdown` jsonb object ≤ 4 KB (`company_fit, geography_fit, decision_maker_fit, buying_signal_fit, exclusion_penalty`), `status` pending\|scored\|stale, `scored_at` | FK `(workspace_id, icp_profile_id)` → icp_profiles. So the company and the profile must be in the score's workspace. `unique (company_id, icp_profile_id, icp_revision)`. *scored* ⇒ score + grade + scored_at; *pending* ⇒ no score or grade. The DB never derives a grade. Keys and revision are immutable. **Read-only for API roles** (written by the future scoring engine). |
| `suppression_records` | `company_id` (required), `contact_id?`, `scope` company\|contact, `reason` ≤ 500, `active` | company scope ⇒ no contact; contact scope ⇒ contact required, FK `(workspace_id, company_id, contact_id)`. One active row per target (partial unique, NULLS NOT DISTINCT). Members insert; only owners/admins update (lift/edit). Target and scope are immutable. |

**Score ↔ profile revision.** A result is *current* when status = scored and `icp_revision` equals the profile's current revision (`isCurrentScore` in the DAL). Older results stay readable and are shown as outdated. No stale propagation is implemented yet. When scoring arrives, an ICP revision change should mark that profile's `scored` rows `stale` and queue re-scoring.

**Normalization and deduplication.** The normalized columns are computed by `src/lib/lead-core/normalize.ts`, not by the database (the DB CHECKs their format). This keeps one implementation shared by the DAL and future ingestion. Matching hierarchy (`dedupe.ts`), always within one workspace:
- Companies: provider identity → domain → international phone (review) → name + same place (review) → new.
- Contacts: email → provider identity → name at the same company (review) → new. Phone never matches contacts.

**Suppression purpose.** This is an internal do-not-contact record per company or contact. Every future contact action must check active rows (and the planned value-based list).

**Access summary.** Members have full operational read/write on companies and contacts (including qualification and archival), add evidence and add restrictions. Owners and admins additionally lift or edit restrictions. Nobody deletes. Configuration permissions (icp_profiles, business profile) are unchanged.

**DAL** (`src/lib/dal/`): `listCompanies` (since P1-E2: one server-side page of 25 via `public.list_companies`, with filters, sort and the total; plus primary contact, evidence count, company restriction and the current default-profile grade), `getCompanyDetail`, `setCompanyQualification`, plus the read helpers `contactsForCompanies`, `evidenceFor`, `scoresForCompanies`, `activeSuppressions`. P1-E2 added `createCompanyManual`, `addContactManual`, `addSuppression`, `liftSuppression`, the matching helpers `companiesForMatching`, `companySummaries`, `companyForMerge`, `contactsForMerge`, `contactsByEmail`, and the import module (§3c). Planned: a `my_workspace_ids()` RLS helper (§2) once lists get large.

## 3c. Implemented (P1-E2): manual + CSV ingestion

Migration `20261010000000_manual_csv_ingestion.sql`. Product meaning, including the exact merge rules: `docs/product/vleeds-imports.md`.

**Pipeline.** `import_batches` ─< `import_rows` → mapping / normalization / validation / matching (`stage_import_rows`) → user decisions → commit, row by row (`ingest_lead`) → `companies` + `contacts` + `lead_sources`. An upload never writes directly to the lead core.

| Table | Key columns | Integrity |
| --- | --- | --- |
| `import_batches` | `filename` (1–255), `status` (mapping\|review\|processing\|completed\|cancelled), `headers` jsonb array (1–100, ≤ 16 KB), `mapping` jsonb (one field key or null per column, ≤ 16 KB), `total_rows` (0–5000), `valid_rows`, `invalid_rows`, `created_rows`, `merged_rows`, `skipped_rows`, `failed_rows`, `created_by`, `completed_at`, `archived_at` | `unique (workspace_id, id)`. completed ⇒ `completed_at`. Trigger `guard_import_batch`: completed/cancelled batches are frozen (only `archived_at` may change); `completed` only from `processing`. Immutable `workspace_id, created_by, filename, headers, total_rows`. Indexes `(workspace_id, created_at desc)`, `(workspace_id, status)`. |
| `import_rows` | `import_batch_id`, `row_number` (1–100000), `raw_data` jsonb array of cell strings (≤ 16 KB), `normalized_data` jsonb `{mapped, company, contact}` (≤ 16 KB), `validation_errors` jsonb `[{level, field, message}]` (≤ 8 KB), `match_state` (unprocessed\|new\|possible_duplicate\|matched\|invalid), `match_reason` (external_id\|domain\|phone\|name_location\|email\|name_company), `matched_company_id`, `matched_contact_id`, `matched_import_row_id` (earlier row of the same file), `decision` (create\|merge\|skip), `commit_result` (created\|merged\|skipped\|failed), `commit_notes` jsonb array (≤ 8 KB), `committed_company_id`, `committed_contact_id` | `unique (import_batch_id, row_number)`. Every reference is a composite same-workspace FK (batch, matched/committed company and contact, matched row), so a row can't point into another workspace. CHECKs: an invalid row can only be skipped; created/merged ⇒ committed company. Trigger `guard_import_row`: a row with a `commit_result` is frozen, as is every row of a completed/cancelled batch. Immutable `workspace_id, import_batch_id, row_number, raw_data`. Indexes `(import_batch_id, match_state)`, `(import_batch_id, row_number) where commit_result is null` (next chunk). |
| `lead_sources` (+2 columns) | `import_batch_id`, `import_row_id` (nullable) | Composite FKs `(workspace_id, import_batch_id)` → import_batches and `(workspace_id, import_row_id)` → import_rows (ON DELETE SET NULL of that column only). A row id needs its batch id. Immutable. Partial index on `import_batch_id`. |

**Functions** (all `SECURITY INVOKER`, `search_path = ''`, so the caller's RLS and column grants apply unchanged; executable by `authenticated`, not `anon`):
- `ingest_lead(workspace, company, contact, evidence, import_row_id)` writes **one** company (insert, or a merge patch of only the given columns, active companies only), an optional contact (insert or patch; `primary_if_none` makes it primary only if the company has none), and the evidence (append-only, stamped with the batch/row), and records the row outcome. It is **one transaction**. With an import row it locks the row (`for update`). If the row already has a result, it returns that result and writes nothing. It refuses to run unless the batch is `processing`. Shared by manual entry (`source_kind = manual`) and CSV commits (`csv`).
- `stage_import_rows(workspace, batch, rows)` is a bulk update of the mapping/validation/match/decision columns of uncommitted rows of one batch. Re-staging after "Back to mapping" overwrites earlier suggestions.
- `list_companies(workspace, qualification, grade, restricted, has_contact, country, sort, limit ≤ 100, offset)` returns one Leads page plus `total_count`. The grade is read, never derived: a scored result of the active default profile at its current revision.

**Commit behaviour.** The application commits the next 100 uncommitted rows of a `processing` batch per request, in row order, **one transaction per row**. A failing row is marked `failed` with a fixed message and doesn't affect others. When no rows remain, the batch becomes `completed` with its counts. Idempotency is enforced in four layers: the planner skips rows that have a result; `ingest_lead` re-checks under a row lock; the row trigger freezes results; and the only `review → processing` update that can succeed is the first one.

**Deduplication decisions.** Classification (`src/lib/imports/classify.ts`) reuses `matchCompany` against existing active companies and against earlier rows that will create a company. A strong identity (domain/provider) gives `matched` with suggested **merge**; create is not allowed, and the active-domain unique index stays the backstop. A weak identity (international phone, name + place) gives `possible_duplicate` with **no suggestion** (merge/skip/create). No match gives `new` (create). Errors give `invalid` (skip only). Contacts are matched at commit time against current data (`matchContact`). An email owned at another company blocks the contact, never the company.

**Merge behaviour.** Fill empty fields only; keep existing values on conflict and report them; never rename; qualification only while unreviewed (`src/lib/imports/merge.ts`, product doc §4). The imported values are always appended as evidence.

**CSV lifecycle and retention.** The uploaded bytes live only in the server action's memory: they are parsed with Papa Parse and discarded. `raw_data` and `normalized_data` remain on the rows (≤ 16 KB each) for review and audit, including for cancelled batches. **There is no clean-up job yet.** Operational follow-up: null those two columns for completed/cancelled batches older than a retention period, keeping outcomes, notes and counts. Nothing is hard-deleted through the API (no DELETE grants).

**Access.** SELECT/INSERT/UPDATE on both tables for any workspace member (`is_workspace_member`), with column-level grants: insert only the user-supplied columns; update only status/mapping/counts and staging/outcome columns. There is no DELETE. Lifting restrictions is still owner/admin (P1-E1 policy, unchanged).

## 3d. Implemented (P1-E3): company discovery

Migration `20261011000000_company_discovery_foundation.sql`. Product: `docs/product/vleeds-discovery.md`. Provider: `docs/providers/google-places.md`.

| Table | Key columns | Integrity |
| --- | --- | --- |
| `discovery_runs` | `icp_profile_id` + `icp_revision` (nullable; revision needs profile), `provider_key`, `query` (1–200), `geography` jsonb (≤ 2 KB, `{countryCode, countryName, region, city, label}`, Vleeds data), `language_code`, `region_code`, `status` (running\|review\|completed\|cancelled\|failed), `requested_result_count`, `pages_loaded`, `has_more`, `error_code` (category), `candidate_count`, `selected_count`, `dismissed_count` (trigger-maintained, no API grant), `created_by`, `completed_at`, `cancelled_at` | `unique (workspace_id, id)` and `(workspace_id, id, provider_key)`. Composite FK to `icp_profiles (workspace_id, id)`. failed ⇒ error_code; completed/cancelled ⇒ timestamp. Trigger: completed/cancelled runs are final. Query, geography, provider, ICP reference and page size are immutable. Indexes `(workspace_id, created_at desc)`, `(icp_profile_id)`. |
| `discovery_candidates` | `discovery_run_id`, `provider_key`, `external_record_id` (1–256, the **durable provider id**, e.g. Google Place ID), `position`, `match_state` (new\|seen_before\|existing_company), `match_company_id`, `decision` (unreviewed\|selected\|dismissed\|needs_enrichment), `decided_by`/`decided_at` (trigger) | `unique (discovery_run_id, provider_key, external_record_id)`; the same id may appear in other runs. Composite FK `(workspace_id, discovery_run_id, provider_key)` → the run, so a candidate uses its run's provider and workspace. Composite FK to companies. existing_company ⇒ company; selected ⇒ company. Candidates of final runs are frozen. Id, run and provider are immutable. Indexes `(discovery_run_id, position)`, `(workspace_id, provider_key, external_record_id)` for "seen before". **No provider display columns** (name, address, phone, website, rating, reviews) and no payloads, by design. |
| `provider_usage_events` | `discovery_run_id?`, `provider_key`, `operation`, `requested_fields text[]` (≤ 50), `request_count`, `result_count`, `status` (ok\|empty\|timeout\|rate_limited\|setup\|invalid_request\|unavailable\|malformed), `sku_hint`, `estimated_cost_micros` (null unless a price snapshot exists), `pricing_reference`, `occurred_at`, `created_by` | Append-only (select + insert grants, no update/delete). Composite FK to the run. Indexes `(workspace_id, occurred_at desc)`, `(discovery_run_id)`. Never keys, tokens or payloads. |

**Provider capability model** (`src/lib/providers/company-discovery/types.ts`). Each provider declares `companyDiscovery`, `durableExternalId`, `durableCompanyFields`, `supportsPagination`, `supportsTextQuery`, `supportsGeographyText`, `maxPageSize`, and a per-field **retention** map (`durable` | `transient`). Google Places: only `externalId` is durable; name, address and category are transient. Code must not persist a field unless its retention is durable.

**Durable vs transient.** Durable means the Place ID, the user's query and geography, run metadata, decisions, usage counts and timestamps. Transient means Google names, addresses and types (in server memory and the browser's state for the open search only) and the continuation token (round-tripped through the browser, never stored).

**Google Place ID identity.** `google_places` + Place ID is the strongest identity in this phase. "Existing company" is determined only from durable evidence: `lead_sources (provider_key, external_record_id)` → an active company. That evidence row is written by a later, approved enrichment/ingestion step. "Seen before" is determined from other runs' candidates. Transient fields are never used for matching.

**Future ingestion relationship.** Google Places stops at references (`needs_enrichment`). A provider with durable company fields, or the future enrichment step, feeds the **P1-E2 pipeline** (lead-core normalization → `classify`/`dedupe` → create/merge/skip → `ingest_lead` → evidence with `provider_key`/`external_record_id`). None of the tables above need to change for that.

**Access.** Members SELECT/INSERT/UPDATE runs and candidates in their workspaces and SELECT/INSERT usage, with column-level grants. Nothing is deletable through the API. Configuration permissions are unchanged.

## 3e. Implemented (P1-E4): company enrichment

Migration `20261012000000_company_enrichment_hunter.sql`. Product: `docs/product/vleeds-company-enrichment.md`. Provider: `docs/providers/hunter.md`.

| Table / change | Key columns | Integrity |
| --- | --- | --- |
| `companies` (+2) | `industry` (≤ 200), `description` (≤ 2000) | Provider-neutral; insert/update grants for members; no provider-specific columns (a provider's company id lives in `lead_sources`). |
| `company_enrichment_runs` | `provider_key`, `input_kind` (discovery_reference|manual_name|domain|existing_company), `discovery_candidate_id`, `target_company_id`, `manual_company_name` (≤ 200, Vleeds data only), `requested_domain`, `resolved_domain` (normalized hosts), `status` (draft|resolving_domain|domain_review|enriching|review|processing|completed|cancelled|failed), `error_code`, `match_state` (new|existing_company|possible_duplicate), `match_reason`, `matched_company_id`, `decision` (create|merge|skip), `committed_company_id`, `commit_result` (created|merged|skipped|failed), `commit_notes` (≤ 8 KB), `created_by`, timestamps | `unique (workspace_id, id)`. Composite same-workspace FKs to the discovery candidate and to companies (target, matched, committed). **CHECK: a discovery_reference run has a candidate and NO stored name** (transient provider content can't be persisted). Per-kind input CHECKs; failed ⇒ error_code; completed ⇒ completed_at + commit_result; created/merged ⇒ committed company. Trigger `guard_enrichment_run`: completed/cancelled are final; completed only from review (skip) or processing (commit). Immutable: workspace, creator, provider, input kind, origin candidate, target, stored name. Indexes `(workspace_id, created_at desc)`, `(workspace_id, status)`, `(discovery_candidate_id)`. |
| `company_enrichment_results` | `enrichment_run_id`, `provider_key`, `external_record_id`, `canonical_name`, `primary_domain`, `website_url`, `primary_phone`, `location` (≤ 2 KB), `employee_count_min/max`, `industry`, `description`, `tags` (≤ 20, ≤ 2 KB), `match_state`, `matched_company_id` | **One per run** (unique). Composite FK to the run and to the matched company. Insert-only (no update grant). Trigger `guard_enrichment_result`: only while the run is `enriching`, and with the run's provider. Indexes `(workspace_id, primary_domain)`, `(workspace_id, external_record_id)`. No raw payload, key, transient discovery content or personal data. |
| `provider_usage_events` (+2) | `enrichment_run_id`, `estimated_credit_millis` (0–1,000,000; 1000 = 1 credit; NULL = unknown) | Composite FK to the enrichment run; status list adds `quota_exhausted` and `restricted`. Still append-only. A generic column (no provider-named credit column). |

**Provider-credit accounting.** Each enrichment request writes one usage row with the provider's documented charge rule applied by the adapter (Hunter: Domain Finder 0; Company Enrichment 200 when company data is returned, 0 for 404/errors, NULL for an unreadable success) and the rule text in `pricing_reference`. Totals are labelled *estimated*; the provider account is authoritative.

**ingest_lead v2.** Same contract for manual/CSV callers, plus `industry`/`description`, evidence items with `provider_key` + `external_record_id` (an identical identity row is kept, `on conflict do nothing`), and `p_enrichment_run_id` + `p_notes`: the run is locked, must be `processing`, returns its recorded result if already committed (idempotent), and is completed with its outcome in the same transaction.

**Google → enrichment identity hand-off.** When the run came from a discovery reference that still waits (`needs_enrichment`), `ingest_lead` adds `lead_sources (google_places, <Place ID>, company.provider_reference, no value)` to the **committed** company and sets the reference to `selected` / `existing_company`. `guard_discovery_candidate` was replaced to allow exactly this change on a completed/cancelled run (nothing else); `refresh_discovery_counts` now updates the run only when its counts change. A second run for the same reference can't link it again.

**Ingestion relationship.** Enrichment is the third caller of the P1-E2 pipeline: provider fields → lead-core `companyInputSchema` → `dedupe.matchCompany` (provider identity → domain → phone review → name+place review → new) → `planRowCommit`/`planCompanyMerge` (fill empty, keep conflicts, never rename) → `ingest_lead`.

**Access.** Members SELECT/INSERT/UPDATE runs and SELECT/INSERT results in their workspaces, with column-level grants; nothing is deletable. Provider configuration is server environment only.

## 3f. Implemented (P1-E5): decision-maker / contact discovery

Migration `20261013000000_contact_discovery_hunter.sql`. Product: `docs/product/vleeds-contact-discovery.md`. Provider: `docs/providers/hunter.md` §8.

**Company → contact discovery.** A contact search belongs to one company and uses that company's stored domain. It is a staging/review step: candidates are not contacts and not outreach records. Selected candidates become contacts only through `commit_contact_candidate` → `ingest_lead`.

| Table / change | Key columns | Integrity |
| --- | --- | --- |
| `contact_discovery_runs` | `company_id`, `icp_profile_id` + `icp_revision`, `provider_key`, `domain` (normalized, as searched), `status` (draft\|searching\|review\|completed\|cancelled\|failed), `selected_titles` jsonb `[{title, priority}]` (≤ 10, ≤ 4 KB; search-only criteria, never written back to the ICP), `decision_maker_only`, `requested_limit` (1–10), `result_count`/`selected_count`/`dismissed_count`/`saved_count` (trigger-maintained, no grant), `error_code`, `created_by`, timestamps | `unique (workspace_id, id)` and `(workspace_id, id, company_id)`. Composite FKs to companies (cascade) and icp_profiles (set null). Revision needs a profile; criteria needed (titles or decision-makers-only); failed ⇒ code; completed/cancelled ⇒ time. Trigger: completed/cancelled are final. Criteria, company, domain, ICP reference and provider are immutable. Indexes `(company_id, created_at desc)` (the drawer's last search), `(workspace_id, created_at desc)`. |
| `contact_discovery_candidates` | `provider_external_id` (NULL unless a real stable id exists; Domain Search has none), `position`, `full_name`, `first/last_name`, `job_title`, `email` + `normalized_email` (lower-case, address-shaped), `phone`, `linkedin_url` (https), `provider_seniority`, `provider_department`, `provider_decision_maker`, `verification_status` (valid\|accept_all\|unknown\|invalid), `confidence` 0–100, `source_count`, `last_seen_on`, `role_match` (primary\|secondary\|fallback\|search_title\|decision_maker\|other), `match_state` (new\|existing_contact\|possible_duplicate\|conflict), `matched_contact_id`, `decision` (unreviewed\|selected\|dismissed), `selected_action` (create\|merge), `commit_result`, `committed_contact_id`, `decided_by/at` | Composite FK `(workspace_id, run, company_id)` → the run, so a candidate is the run's company's. Unique `(run, normalized_email)`. Matched contact: FK in the workspace, and a trigger requires existing/duplicate matches to be at this company. **Conflicts can't be selected** (CHECK); selected ⇔ action; the action must fit the match. Committed contact: FK `(workspace_id, company_id, contact)`. Trigger `guard_contact_discovery_candidate`: inserted only while the run is `searching`, changed only while `review`, frozen once saved; decisions stamped. Identity/match columns are immutable. **No payload columns** (no sources, twitter, organization). |
| `provider_usage_events` (+2) | `contact_discovery_run_id`, `company_id` | Composite FKs (set null). Operation `domain_search`. Still append-only. |
| `company_enrichment_runs` (index) | `company_enrichment_runs_one_open_per_candidate` | **P1-E4 F1 correction:** a partial unique index allows at most one OPEN run (status not completed/cancelled; a failed run counts as open because it can be retried) per discovery candidate. The start action returns the open run instead of creating one. |

**ICP revision relationship.** Each run records the profile id and the revision it was built from. The titles used are copied into the run, so later ICP edits don't change what a past search meant.

**Contact matching.** Within the workspace, in this order (`dedupe.matchContact` + an email lookup):
1. Email at this company → `existing_contact`.
2. Email at another company → `conflict` (never selected, moved or duplicated).
3. Same name at this company → `possible_duplicate` (the user chooses merge or new).
4. Otherwise `new`.

Phone is never an identity.

**Candidate lifecycle.** `searching` (candidates inserted) → `review`:
- Select / Dismiss / Undo → `commit_contact_candidate` per selected candidate → `completed` when all selected candidates are saved.
- No results → `completed` directly.
- Provider errors → `failed` → explicit retry → `searching`.
- Closing → `cancelled`.

**`commit_contact_candidate(workspace, candidate, contact, evidence)`** (SECURITY INVOKER, `search_path = ''`):
- Locks the candidate; an already-saved one returns its outcome (idempotent).
- Requires `selected`, not `conflict`, and a run in `review`.
- A merge must target the matched contact; a new contact is refused if its email exists anywhere in the workspace.
- Calls `ingest_lead` with the company id (no company changes) and records `commit_result` + `committed_contact_id`.

**Provider evidence.** Contact evidence (`subject = contact`, `api`, `hunter`, no record id) per non-empty value: name, title, email, phone, linkedin, seniority (provider's), department, verification_status, provider_decision_maker. No company evidence is written by contact discovery.

**Credit accounting.** One `domain_search` usage row per search, with `estimated_credit_millis`: 1000 when 1–10 emails were returned, 0 when none or on error, NULL when unreadable. The Discover panel sums company-enrichment and decision-maker-search credits separately and in total (estimates; the provider account is authoritative).

**Access.** Members SELECT/INSERT/UPDATE runs and candidates with column-level grants; nothing is deletable. Suppression permissions are unchanged; the server refuses searches and saves for a do-not-contact company.

## 3g. Implemented (P1-E6): ICP evaluation and lead scoring

Migration `20261014000000_icp_lead_scoring.sql`. Product: `docs/product/vleeds-lead-scoring.md`. Engine: `src/lib/scoring/*` (pure TypeScript, no I/O).

| Table / change | Key columns | Integrity |
| --- | --- | --- |
| `company_signal_observations` | `company_id`, `icp_profile_id`, `icp_revision`, `signal_kind` (buying\|exclusion), `signal_id`, `state` (present\|absent; **unknown = no row**), `note` (≤ 500), `source_evidence_id` (optional), `created_by`, `observed_at` | Composite FKs to the company and the profile (same workspace). Unique `(company, profile, revision, kind, signal)`. Trigger `guard_signal_observation`: the revision must be the profile's current one, and the signal id must exist in that kind's list; linked evidence must be this company's. Keys immutable. Members select/insert/update **and delete** (clearing to unknown). Rows of older revisions stay as history; nothing is copied to a new revision. |
| `lead_scores` (+5) | `input_fingerprint` (64 hex), `coverage_percent` 0–100, `explanation` (object ≤ 16 KB), `effective_weights` (object ≤ 1 KB), `exclusion_reasons` (array ≤ 50); status adds `excluded` | `scored` ⇒ score + grade + scored_at + fingerprint + coverage. `excluded` ⇒ NO score/grade + scored_at + fingerprint + coverage + ≥ 1 reason. `pending` unchanged. Pre-engine `scored` rows (no fingerprint) became `stale`. Still no direct write grants. |

**Functions** (`search_path = ''`):
- **`scoring_input(workspace, company, profile)`** (SECURITY INVOKER, STABLE): the canonical scoring input document and `sha256` fingerprint. It contains:
  - company name/industry/description/employee range/country/region/city
  - sorted distinct `company.tags` evidence values
  - sorted titles of active contacts (not archived, not left_company)
  - sorted observations for the profile's current revision
  - the ICP id, revision and scoring-relevant configuration

  jsonb text is canonical (sorted keys), so equal inputs hash equally. It is NULL when the company or profile isn't visible/active.
- **`save_lead_score(...)`** (SECURITY DEFINER, with an explicit membership check): the **only** write path. It refuses:
  - a foreign or archived company/profile
  - a revision that isn't current, or a fingerprint that differs from `scoring_input` now (`55000`)
  - an outcome other than scored/excluded
  - a grade that doesn't follow the profile's thresholds (`23514`)

  It upserts on `(company, profile, revision)`: re-evaluating the same revision updates the row; a new revision adds a row.
- **`list_companies`** (recreated; same arguments) adds `score_state` (current\|excluded\|outdated\|none) and `coverage_percent`, and returns grade/score **only when current** for the default profile. `p_grade` accepts A\|B\|C\|excluded\|outdated\|none; grade sorting puts current grades first.

**Currentness.** A result is current only when its revision equals the profile's current revision **and** its `input_fingerprint` equals `scoring_input()`'s fingerprint now. This is computed on read (drawer and Leads). No mutation triggers maintain stale state.

**Score revision behaviour.** One row per company × profile × revision. Recalculating the same revision overwrites that row (no event history; a scoring-run history table can come later). Older revisions remain readable.

**Multiple ICP scores.** A company may have results for several profiles. Leads shows the default profile's current result; the drawer lists the others.

**Browser boundary.** The server action accepts only ids and signal choices (strict schemas), reads `scoring_input` and runs the engine. *P1-E6 then called `save_lead_score` as the user, so a member with direct API access could submit values they fabricated to match a current fingerprint. P1-E7 closed this: see §3h, "Score-write boundary".*

## 3h. Implemented (P1-E7): Today queue + manual contact workflow

Migration `20261015000000_today_contact_workflow.sql`. Product: `docs/product/vleeds-contact-workflow.md`, `docs/product/vleeds-today.md`. Rules: `src/lib/contact-workflow/*` (pure).

| Table / change | Key columns | Integrity |
| --- | --- | --- |
| `workspaces.timezone` | text, NOT NULL, default `'UTC'` | Shape check (≤ 64 chars, IANA-like). A trigger accepts only names in `pg_timezone_names`; the app also validates against the runtime's IANA list. Owners and admins update it through the existing workspace update policy (`grant update (timezone)`); members read it. |
| `lead_scores.scored_by` | uuid → auth.users | The authenticated user whose request produced the result (passed by the trusted writer). |
| `contact_attempts` | `company_id`, `contact_id`, `source_task_id?`, `request_id`, `channel` (phone), `disposition` (9 values), `note` (≤ 1000; required for *other*), `attempted_at` (server `now()`), `created_by` | Composite FK `(workspace_id, company_id, contact_id)` → contacts. The source task must be the same contact's (composite FK). Unique `(workspace_id, request_id)` makes resubmission idempotent. **History:** API roles may only read it, and an update trigger refuses edits from any role. |
| `follow_up_tasks` | `company_id`, `contact_id`, `source_attempt_id?`, `kind` (callback\|follow_up\|retry_call), `due_at`, `status` (open\|completed\|cancelled), `note` (≤ 1000), created/completed/cancelled by + at | Composite FKs to the contact and to the source attempt (same contact). A status/timestamp consistency CHECK. **Partial unique `(contact_id) WHERE status = 'open'`: one next action per contact.** Keys, kind and creator are immutable. API roles may only read it. |

Indexes: attempts `(company_id, attempted_at desc)`, `(contact_id, attempted_at desc)`, `(workspace_id, attempted_at desc)`; tasks `(workspace_id, due_at) WHERE open`, `(company_id, created_at desc)`, plus the partial unique index.

**Workflow functions** (SECURITY DEFINER, `search_path = ''`; they act as `auth.uid()` and check membership explicitly):
- **`record_contact_attempt(workspace, company, contact, request_id, disposition, note, source_task?, next_kind?, next_due_at?, next_note?, suppression_scope?, suppression_reason?)`** runs in one transaction. It:
  1. serializes on the contact row
  2. replays a known `request_id`
  3. checks the relationship, and refuses restricted, left or phone-less contacts (except *do not contact* on a contactable record, and on a contact without a phone)
  4. enforces each outcome's rules (required due time, allowed next kinds, future time, note for *other*, scope for *do not contact*)
  5. appends the attempt and completes the source task (which must be open and this contact's)
  6. replaces any other open task with the new next task
  7. for *do not contact*: inserts the `suppression_records` row and cancels open tasks in that scope
- **`schedule_follow_up`** refuses when the contact already has an open task (`VL004`).
- **`reschedule_follow_up`** changes `due_at` only.
- **`complete_follow_up`** / **`cancel_follow_up`** close an open task. They are allowed on blocked tasks, so restricted work can be cleared.
- Error codes:
  - `42501` not a member / not available
  - `VL001` restricted
  - `VL002` not contactable
  - `VL003` task not open
  - `VL004` open task exists
  - `22023` invalid request

**Today reads** (SECURITY INVOKER, RLS applies):
- `today_ready_candidates(workspace)` returns companies whose default-ICP result is current (revision + `scoring_input` fingerprint, as in `list_companies`) with grade A/B. Each row carries qualification, company restriction and a per-contact facts array:
  - phone, status, contact restriction, open-task due time, latest attempt
- `today_due_tasks(workspace, until)` returns open tasks due before `until`, with company and contact facts (archived, restricted, status, phone).

The pure workflow module decides Ready eligibility, the recommended contact, ordering, due classification and blocked tasks. "Today" bounds come from the workspace time zone (`@date-fns/tz`) and are passed as UTC instants.

**Score-write boundary (closes the P1-E6 follow-up).**
- `save_lead_score` is **dropped**. It is replaced by `save_lead_score_trusted(actor_user_id, …)`, which is executable **only by `service_role`** (revoked from `authenticated` and `anon`).
- The function still verifies:
  - the explicit actor is a member of the (non-archived) workspace
  - the company and profile belong to the workspace
  - the current revision and the current `scoring_input` fingerprint
  - the score/coverage ranges and that the grade follows the thresholds
  - that an exclusion has named reasons and no score
- Only `src/lib/supabase/trusted-score-writer.ts` (`server-only`) holds `SUPABASE_SERVICE_ROLE_KEY`. Its private client calls exactly this function.
- Server actions authenticate the user first, re-read the inputs, run the pure evaluator and pass the session's user id as the actor.

**Not scoring input.** Attempts, tasks and dispositions are not part of `scoring_input()`, so logging calls never changes a fingerprint or makes a score outdated.

## 4. Planned entities

### campaigns: a focused prospecting effort
`workspace_id, icp_profile_id (composite FK), name, status (draft|active|paused|completed|archived), starts_on, ends_on, goal text`.
`campaign_leads (workspace_id, campaign_id, company_id, added_at, added_by)` with composite FKs and a unique `(campaign_id, company_id)`.

> P1-E7 implemented the phone part of these two plans as `contact_attempts` and `follow_up_tasks` (§3h). The plans below remain for other channels, assignment and campaigns.

### activities: what happened
`workspace_id, company_id, contact_id?, campaign_id?, type (call|email|meeting|note|status_change), direction (outbound|inbound)?, outcome_key text, notes, occurred_at, duration_seconds?, actor_user_id, provider_connection_id?, external_ref`.
Outcomes are workspace-configurable (`workspaces.settings.activity_outcomes` or an `activity_outcomes` lookup table). `outcome_key` references them, so "no answer", "interested" etc. are data, not enums. Append-only for members; corrections are new rows.

### follow_ups: what happens next
`workspace_id, company_id, contact_id?, activity_id? (origin), assigned_to, due_at, status (open|done|cancelled), completed_at, note`.
Index `(workspace_id, assigned_to, status, due_at)` powers **Today**.

### provider_connections: per-workspace integrations
`workspace_id, provider_key text, capabilities text[] (discovery|enrichment|calling), display_name, config jsonb (non-secret), secret_id uuid (→ vault.secrets), status (active|disabled|error), last_verified_at, is_default_for text[]`.
- `provider_key` selects a generic adapter from a code registry (`src/server/providers/*`). Workflows call capabilities (`discover()`, `enrich()`, `call()`), never provider names.
- Secrets live in **Supabase Vault**. `authenticated` gets no access to `secret_id` (no column grant) and no access to `vault`. Server-only code reads secrets through a `SECURITY DEFINER` function executable by `service_role` only.
- Calling defaults to `is_default_for @> '{calling}'`. Exactly one per workspace, enforced by a partial unique index.

### suppression_list (org-wide / value-based)
The per-record restrictions are implemented as `suppression_records` (§3b). Org-wide, value-based entries (email, phone or domain lists, unsubscribes) remain a plan for when contact actions exist; they must be checked together with `suppression_records`.

## 5. Future platform tables (not product features)

| Table | Purpose | When |
| --- | --- | --- |
| `invitations` | Email invites into an organization with a role | With member management |
| `workspace_memberships` | Optional per-workspace restriction inside an org | Only if needed (see AD-2) |
| `audit_log` | Append-only record of admin/security events | Before external tenants |

## 6. Delivery order (proposal)

1. ~~`icp_profiles` + Settings editing of the business profile and ICP.~~ Done in P0-E1-S2.
2. `provider_connections` (+ Vault), with no live provider calls yet.
3. ~~`companies`, `contacts`, `lead_sources`, `lead_scores` (storage), `suppression_records`.~~ Done in P1-E1. ~~Manual entry and CSV import~~ done in P1-E2. ~~Interactive discovery (Google Places references)~~ done in P1-E3. ~~Durable company enrichment (Hunter) through the same ingest pipeline~~ done in P1-E4. ~~Decision-maker / contact discovery~~ done in P1-E5.
4. ~~Score calculation into `lead_scores` from `scoring_model`~~ done in P1-E6.
5. ~~`activities`, `follow_ups`, then **Today**~~: phone attempts, follow-up tasks and the real Today done in P1-E7.
6. `campaigns`, `campaign_leads`.
7. `suppression_list`, enforced across 3–6 as soon as contact actions exist (it must land no later than the first contact action).

Each step ships with its migration, RLS policies, adversarial tests in `tests/db`, and regenerated types.
