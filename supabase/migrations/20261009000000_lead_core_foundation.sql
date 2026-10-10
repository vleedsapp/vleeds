-- =============================================================================
-- Vleeds P1-E1 — Lead core foundation
--
-- workspaces ─┬─< companies ─┬─< contacts
--             │              ├─< lead_sources        (evidence; company and/or contact)
--             │              ├─< lead_scores >── icp_profiles (profile + revision)
--             │              └─< suppression_records (company or contact)
--
-- A COMPANY is the primary prospect record ("lead"). There is no separate leads
-- table. Product meaning: docs/product/vleeds-lead-core.md.
--
-- Security model (docs/architecture/vleeds-tenancy.md §8):
--   * RLS on every table, nothing for anon, column-level grants.
--   * Workspace members read everything here and do the normal operational
--     work (companies, contacts, evidence, adding suppressions). Lifting or
--     editing a suppression is owner/admin. Score rows are read-only through
--     the API until a scoring engine exists. Evidence is append-only.
--   * Composite foreign keys (workspace_id, …) keep every child in its parent's
--     workspace; ownership keys are immutable (prevent_tenant_key_change).
--   * No DELETE through the API: archive (companies, contacts) or deactivate
--     (suppressions) instead.
--
-- Normalized columns (normalized_name, normalized_email, *_phone_normalized,
-- primary_domain) are computed by src/lib/lead-core/normalize.ts; the CHECKs
-- below guarantee their canonical form.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- companies
-- -----------------------------------------------------------------------------
create table public.companies (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete cascade,
  canonical_name            text not null check (char_length(btrim(canonical_name)) between 1 and 200),
  normalized_name           text not null check (char_length(normalized_name) between 1 and 200
                                                 and normalized_name = btrim(normalized_name)),
  website_url               text check (website_url is null or (char_length(website_url) <= 2048 and website_url ~* '^https?://')),
  primary_domain            text check (primary_domain is null or (char_length(primary_domain) <= 253
                              and primary_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')),
  primary_phone             text check (primary_phone is null or char_length(primary_phone) between 3 and 40),
  primary_phone_normalized  text check (primary_phone_normalized is null or primary_phone_normalized ~ '^\+[1-9][0-9]{6,14}$'),
  location                  jsonb check (location is null or (jsonb_typeof(location) = 'object' and octet_length(location::text) <= 2048)),
  employee_count_min        integer check (employee_count_min is null or employee_count_min >= 0),
  employee_count_max        integer check (employee_count_max is null or employee_count_max >= 0),
  qualification_state       text not null default 'unreviewed'
                            check (qualification_state in ('unreviewed', 'needs_review', 'qualified', 'unqualified')),
  qualification_reason      text check (qualification_reason is null or char_length(qualification_reason) <= 500),
  notes                     text check (notes is null or char_length(notes) <= 5000),
  archived_at               timestamptz,
  created_by                uuid default auth.uid() references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint companies_workspace_id_id_key unique (workspace_id, id),
  constraint companies_employee_range check (employee_count_min is null or employee_count_max is null
                                             or employee_count_min <= employee_count_max),
  constraint companies_phone_pair check (primary_phone_normalized is null or primary_phone is not null)
);

comment on table public.companies is
  'The primary prospect record. Qualification is an operational decision, independent of ICP scores (lead_scores).';

create index companies_workspace_id_archived_at_idx on public.companies (workspace_id, archived_at);
create index companies_workspace_id_qualification_idx on public.companies (workspace_id, qualification_state)
  where archived_at is null;
create index companies_workspace_id_normalized_name_idx on public.companies (workspace_id, normalized_name);
-- One active company per domain per workspace. Archived companies don't block
-- a new active record; other workspaces are unaffected.
create unique index companies_one_active_domain_per_workspace on public.companies (workspace_id, primary_domain)
  where primary_domain is not null and archived_at is null;

-- -----------------------------------------------------------------------------
-- contacts
-- -----------------------------------------------------------------------------
create table public.contacts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  company_id        uuid not null,
  first_name        text check (first_name is null or char_length(first_name) <= 100),
  last_name         text check (last_name is null or char_length(last_name) <= 100),
  full_name         text not null check (char_length(btrim(full_name)) between 1 and 200),
  job_title         text check (job_title is null or char_length(job_title) <= 200),
  seniority         text check (seniority is null or seniority in ('executive', 'director', 'manager', 'individual_contributor')),
  email             text check (email is null or char_length(email) <= 320),
  normalized_email  text check (normalized_email is null or (normalized_email = lower(btrim(normalized_email))
                                                               and normalized_email ~ '^[^@\s]+@[^@\s]+$')),
  phone             text check (phone is null or char_length(phone) between 3 and 40),
  phone_normalized  text check (phone_normalized is null or phone_normalized ~ '^\+[1-9][0-9]{6,14}$'),
  linkedin_url      text check (linkedin_url is null or (char_length(linkedin_url) <= 2048 and linkedin_url ~* '^https://')),
  is_primary        boolean not null default false,
  status            text not null default 'active' check (status in ('active', 'left_company', 'unknown')),
  notes             text check (notes is null or char_length(notes) <= 5000),
  archived_at       timestamptz,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint contacts_workspace_id_id_key unique (workspace_id, id),
  constraint contacts_workspace_company_id_key unique (workspace_id, company_id, id),
  constraint contacts_company_fk foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete cascade,
  constraint contacts_email_pair check ((email is null) = (normalized_email is null)),
  constraint contacts_phone_pair check (phone_normalized is null or phone is not null),
  constraint contacts_primary_not_archived check (not (is_primary and archived_at is not null))
);

comment on table public.contacts is
  'People at a company. Email is a strong identity signal within a workspace; phone never is (shared lines).';

create index contacts_workspace_company_idx on public.contacts (workspace_id, company_id);
-- Matching by email (not unique: shared inboxes exist; ingestion decides).
create index contacts_workspace_normalized_email_idx on public.contacts (workspace_id, normalized_email)
  where normalized_email is not null;
-- At most one active primary contact per company.
create unique index contacts_one_primary_per_company on public.contacts (company_id)
  where is_primary and archived_at is null;

-- -----------------------------------------------------------------------------
-- lead_sources (evidence)
-- -----------------------------------------------------------------------------
create table public.lead_sources (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  company_id          uuid,
  contact_id          uuid,
  source_kind         text not null check (source_kind in ('manual', 'csv', 'public_dataset', 'website', 'api', 'other')),
  provider_key        text check (provider_key is null or provider_key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  external_record_id  text check (external_record_id is null or char_length(external_record_id) between 1 and 256),
  source_url          text check (source_url is null or (char_length(source_url) <= 2048 and source_url ~* '^https?://')),
  field_key           text check (field_key is null or field_key ~ '^(company|contact)\.[a-z][a-z0-9_]{0,62}$'),
  observed_value      jsonb check (observed_value is null or octet_length(observed_value::text) <= 2048),
  confidence          integer check (confidence is null or confidence between 0 and 100),
  observed_at         timestamptz,
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint lead_sources_subject check (company_id is not null or contact_id is not null),
  constraint lead_sources_external_needs_provider check (external_record_id is null or provider_key is not null),
  constraint lead_sources_company_fk foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete cascade,
  constraint lead_sources_contact_fk foreign key (workspace_id, contact_id)
    references public.contacts (workspace_id, id) on delete cascade,
  -- When both are given, the contact must belong to that company.
  constraint lead_sources_contact_company_fk foreign key (workspace_id, company_id, contact_id)
    references public.contacts (workspace_id, company_id, id) on delete cascade
);

comment on table public.lead_sources is
  'Append-only evidence: where a fact about a company/contact came from. confidence is data confidence, not ICP fit.';

create index lead_sources_workspace_company_idx on public.lead_sources (workspace_id, company_id);
create index lead_sources_workspace_contact_idx on public.lead_sources (workspace_id, contact_id) where contact_id is not null;
-- The same provider record + field for the same subject is stored once per workspace.
create unique index lead_sources_external_identity on public.lead_sources
  (workspace_id, provider_key, external_record_id, field_key, company_id, contact_id) nulls not distinct
  where external_record_id is not null;

-- -----------------------------------------------------------------------------
-- lead_scores (results of future ICP scoring; not computed in P1-E1)
-- -----------------------------------------------------------------------------
create table public.lead_scores (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  company_id       uuid not null,
  icp_profile_id   uuid not null,
  icp_revision     integer not null check (icp_revision >= 1),
  score            integer check (score is null or score between 0 and 100),
  grade            text check (grade is null or grade in ('A', 'B', 'C')),
  breakdown        jsonb check (breakdown is null or (jsonb_typeof(breakdown) = 'object' and octet_length(breakdown::text) <= 4096)),
  status           text not null default 'pending' check (status in ('pending', 'scored', 'stale')),
  scored_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint lead_scores_company_fk foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete cascade,
  constraint lead_scores_icp_profile_fk foreign key (workspace_id, icp_profile_id)
    references public.icp_profiles (workspace_id, id) on delete cascade,
  constraint lead_scores_one_per_revision unique (company_id, icp_profile_id, icp_revision),
  constraint lead_scores_scored_complete check (status <> 'scored' or (score is not null and grade is not null and scored_at is not null)),
  constraint lead_scores_pending_empty check (status <> 'pending' or (score is null and grade is null))
);

comment on table public.lead_scores is
  'One result per company × ICP profile × profile revision. Grades come from the saved ICP thresholds in application '
  'code; the database never derives them.';

create index lead_scores_workspace_company_idx on public.lead_scores (workspace_id, company_id);
create index lead_scores_profile_revision_idx on public.lead_scores (icp_profile_id, icp_revision);

-- -----------------------------------------------------------------------------
-- suppression_records (do not contact)
-- -----------------------------------------------------------------------------
create table public.suppression_records (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  company_id    uuid not null,
  contact_id    uuid,
  scope         text not null check (scope in ('company', 'contact')),
  reason        text check (reason is null or char_length(reason) <= 500),
  active        boolean not null default true,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- company scope: the whole company; contact scope: one person at that company.
  constraint suppression_records_scope_shape check (
    (scope = 'company' and contact_id is null) or (scope = 'contact' and contact_id is not null)
  ),
  constraint suppression_records_company_fk foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete cascade,
  constraint suppression_records_contact_fk foreign key (workspace_id, company_id, contact_id)
    references public.contacts (workspace_id, company_id, id) on delete cascade
);

comment on table public.suppression_records is
  'Internal do-not-contact records. Every future contact action (call, email, campaign) must check active rows.';

create index suppression_records_workspace_company_idx on public.suppression_records (workspace_id, company_id);
create index suppression_records_contact_idx on public.suppression_records (workspace_id, company_id, contact_id)
  where contact_id is not null;
-- One active record per target (re-suppressing is idempotent).
create unique index suppression_records_one_active on public.suppression_records
  (workspace_id, scope, company_id, contact_id) nulls not distinct
  where active;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create trigger companies_set_updated_at before update on public.companies
  for each row execute function private.set_updated_at();
create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function private.set_updated_at();
create trigger lead_scores_set_updated_at before update on public.lead_scores
  for each row execute function private.set_updated_at();
create trigger suppression_records_set_updated_at before update on public.suppression_records
  for each row execute function private.set_updated_at();

create trigger companies_tenant_keys_immutable before update on public.companies
  for each row execute function private.prevent_tenant_key_change('workspace_id', 'created_by');
create trigger contacts_tenant_keys_immutable before update on public.contacts
  for each row execute function private.prevent_tenant_key_change('workspace_id', 'company_id', 'created_by');
create trigger lead_sources_tenant_keys_immutable before update on public.lead_sources
  for each row execute function private.prevent_tenant_key_change('workspace_id', 'company_id', 'contact_id', 'created_by');
create trigger lead_scores_tenant_keys_immutable before update on public.lead_scores
  for each row execute function private.prevent_tenant_key_change('workspace_id', 'company_id', 'icp_profile_id', 'icp_revision');
create trigger suppression_records_tenant_keys_immutable before update on public.suppression_records
  for each row execute function private.prevent_tenant_key_change('workspace_id', 'company_id', 'contact_id', 'scope', 'created_by');

-- -----------------------------------------------------------------------------
-- Privileges (deny by default; column-level writes)
-- -----------------------------------------------------------------------------
revoke all on table public.companies, public.contacts, public.lead_sources, public.lead_scores, public.suppression_records
  from public, anon, authenticated;

grant select on table public.companies, public.contacts, public.lead_sources, public.lead_scores, public.suppression_records
  to authenticated;

grant insert (workspace_id, canonical_name, normalized_name, website_url, primary_domain, primary_phone,
              primary_phone_normalized, location, employee_count_min, employee_count_max, qualification_state,
              qualification_reason, notes)
  on table public.companies to authenticated;
grant update (canonical_name, normalized_name, website_url, primary_domain, primary_phone, primary_phone_normalized,
              location, employee_count_min, employee_count_max, qualification_state, qualification_reason, notes,
              archived_at)
  on table public.companies to authenticated;

grant insert (workspace_id, company_id, first_name, last_name, full_name, job_title, seniority, email, normalized_email,
              phone, phone_normalized, linkedin_url, is_primary, status, notes)
  on table public.contacts to authenticated;
grant update (first_name, last_name, full_name, job_title, seniority, email, normalized_email, phone, phone_normalized,
              linkedin_url, is_primary, status, notes, archived_at)
  on table public.contacts to authenticated;

-- Evidence is append-only.
grant insert (workspace_id, company_id, contact_id, source_kind, provider_key, external_record_id, source_url,
              field_key, observed_value, confidence, observed_at)
  on table public.lead_sources to authenticated;

-- lead_scores: read-only for API roles (written by the future scoring engine).

grant insert (workspace_id, company_id, contact_id, scope, reason) on table public.suppression_records to authenticated;
grant update (reason, active) on table public.suppression_records to authenticated;

grant all on table public.companies, public.contacts, public.lead_sources, public.lead_scores, public.suppression_records
  to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.companies           enable row level security;
alter table public.contacts            enable row level security;
alter table public.lead_sources        enable row level security;
alter table public.lead_scores         enable row level security;
alter table public.suppression_records enable row level security;

-- companies / contacts: collaborative operational data for every workspace member.
create policy companies_select_member on public.companies for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy companies_insert_member on public.companies for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy companies_update_member on public.companies for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));

create policy contacts_select_member on public.contacts for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy contacts_insert_member on public.contacts for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy contacts_update_member on public.contacts for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));

create policy lead_sources_select_member on public.lead_sources for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy lead_sources_insert_member on public.lead_sources for insert to authenticated
  with check (private.is_workspace_member(workspace_id));

create policy lead_scores_select_member on public.lead_scores for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- Anyone in the workspace may add a do-not-contact record; only owners/admins may change or lift one.
create policy suppression_records_select_member on public.suppression_records for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy suppression_records_insert_member on public.suppression_records for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy suppression_records_update_admin on public.suppression_records for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.membership_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.membership_role[]));
