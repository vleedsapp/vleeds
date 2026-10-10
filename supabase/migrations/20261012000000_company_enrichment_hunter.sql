-- =============================================================================
-- Vleeds P1-E4 — Durable company enrichment (first provider: Hunter)
--
-- workspaces ─< company_enrichment_runs ─── company_enrichment_results (1:1)
--                    │   │   └──> discovery_candidates (optional origin)
--                    │   └──────> companies (target / matched / committed)
--                    └──< provider_usage_events (+ estimated credits)
--
-- One enrichment run = ONE interactive, user-initiated lookup of ONE company:
-- (optional) domain resolution → company enrichment → review → create / merge
-- / skip through public.ingest_lead (the P1-E2 pipeline, extended here).
--
-- Retention rules (docs/product/vleeds-company-enrichment.md):
--   * Only DURABLE provider company fields are stored, normalized and bounded
--     (company_enrichment_results). Never raw payloads, keys or personal data.
--   * A run started from a discovery reference NEVER stores the transient
--     provider name that was used to look the domain up (CHECK below).
--   * Provider identity lives in lead_sources (provider_key, external_record_id),
--     never as provider-specific columns on companies.
--
-- Access: any workspace member (collaborative model). Nothing is deletable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- companies: two provider-neutral descriptive fields
-- -----------------------------------------------------------------------------
alter table public.companies
  add column industry    text check (industry is null or char_length(btrim(industry)) between 1 and 200),
  add column description text check (description is null or char_length(btrim(description)) between 1 and 2000);

grant insert (industry, description) on table public.companies to authenticated;
grant update (industry, description) on table public.companies to authenticated;

-- -----------------------------------------------------------------------------
-- company_enrichment_runs
-- -----------------------------------------------------------------------------
create table public.company_enrichment_runs (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  provider_key           text not null check (provider_key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  input_kind             text not null check (input_kind in ('discovery_reference', 'manual_name', 'domain', 'existing_company')),
  discovery_candidate_id uuid,
  target_company_id      uuid,
  -- Vleeds data typed by a user (manual_name / existing_company). Never provider content.
  manual_company_name    text check (manual_company_name is null or char_length(btrim(manual_company_name)) between 1 and 200),
  requested_domain       text check (requested_domain is null or (char_length(requested_domain) <= 253
                           and requested_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')),
  resolved_domain        text check (resolved_domain is null or (char_length(resolved_domain) <= 253
                           and resolved_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')),
  status                 text not null default 'draft'
                         check (status in ('draft', 'resolving_domain', 'domain_review', 'enriching', 'review',
                                           'processing', 'completed', 'cancelled', 'failed')),
  error_code             text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  match_state            text check (match_state is null or match_state in ('new', 'existing_company', 'possible_duplicate')),
  match_reason           text check (match_reason is null or match_reason in ('external_id', 'domain', 'phone', 'name_location')),
  matched_company_id     uuid,
  decision               text check (decision is null or decision in ('create', 'merge', 'skip')),
  committed_company_id   uuid,
  commit_result          text check (commit_result is null or commit_result in ('created', 'merged', 'skipped', 'failed')),
  commit_notes           jsonb check (commit_notes is null or (jsonb_typeof(commit_notes) = 'array' and octet_length(commit_notes::text) <= 8192)),
  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  completed_at           timestamptz,
  cancelled_at           timestamptz,
  constraint company_enrichment_runs_workspace_id_id_key unique (workspace_id, id),
  constraint company_enrichment_runs_candidate_fk foreign key (workspace_id, discovery_candidate_id)
    references public.discovery_candidates (workspace_id, id) on delete set null (discovery_candidate_id),
  constraint company_enrichment_runs_target_fk foreign key (workspace_id, target_company_id)
    references public.companies (workspace_id, id) on delete set null (target_company_id),
  constraint company_enrichment_runs_matched_fk foreign key (workspace_id, matched_company_id)
    references public.companies (workspace_id, id) on delete set null (matched_company_id),
  constraint company_enrichment_runs_committed_fk foreign key (workspace_id, committed_company_id)
    references public.companies (workspace_id, id) on delete set null (committed_company_id),
  -- Input shape per kind. A discovery reference never stores the (transient) provider name.
  constraint company_enrichment_runs_discovery_shape check (
    input_kind <> 'discovery_reference' or (discovery_candidate_id is not null and manual_company_name is null)),
  constraint company_enrichment_runs_manual_name_shape check (input_kind <> 'manual_name' or manual_company_name is not null),
  constraint company_enrichment_runs_domain_shape check (input_kind <> 'domain' or requested_domain is not null),
  constraint company_enrichment_runs_existing_shape check (input_kind <> 'existing_company' or target_company_id is not null),
  constraint company_enrichment_runs_failed_has_code check (status <> 'failed' or error_code is not null),
  constraint company_enrichment_runs_completed_shape check (status <> 'completed' or (completed_at is not null and commit_result is not null)),
  constraint company_enrichment_runs_cancelled_has_time check (status <> 'cancelled' or cancelled_at is not null),
  constraint company_enrichment_runs_written_has_company check (commit_result not in ('created', 'merged') or committed_company_id is not null),
  constraint company_enrichment_runs_existing_match_has_company check (match_state is distinct from 'existing_company' or matched_company_id is not null)
);

comment on table public.company_enrichment_runs is
  'One interactive enrichment of one company: domain resolution, provider lookup, review and decision. '
  'Never stores provider payloads or transient discovery content.';

create index company_enrichment_runs_workspace_created_idx on public.company_enrichment_runs (workspace_id, created_at desc);
create index company_enrichment_runs_workspace_status_idx on public.company_enrichment_runs (workspace_id, status);
create index company_enrichment_runs_candidate_idx on public.company_enrichment_runs (discovery_candidate_id)
  where discovery_candidate_id is not null;

-- -----------------------------------------------------------------------------
-- company_enrichment_results: ONE normalized durable result per run
-- -----------------------------------------------------------------------------
create table public.company_enrichment_results (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  enrichment_run_id   uuid not null,
  provider_key        text not null check (provider_key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  external_record_id  text check (external_record_id is null or char_length(external_record_id) between 1 and 256),
  canonical_name      text not null check (char_length(btrim(canonical_name)) between 1 and 200),
  primary_domain      text not null check (char_length(primary_domain) <= 253
                        and primary_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  website_url         text check (website_url is null or (char_length(website_url) <= 2048 and website_url ~* '^https?://')),
  primary_phone       text check (primary_phone is null or char_length(primary_phone) between 3 and 40),
  location            jsonb check (location is null or (jsonb_typeof(location) = 'object' and octet_length(location::text) <= 2048)),
  employee_count_min  integer check (employee_count_min is null or employee_count_min >= 0),
  employee_count_max  integer check (employee_count_max is null or employee_count_max >= 0),
  industry            text check (industry is null or char_length(btrim(industry)) between 1 and 200),
  description         text check (description is null or char_length(btrim(description)) between 1 and 2000),
  tags                jsonb check (tags is null or (jsonb_typeof(tags) = 'array' and jsonb_array_length(tags) <= 20
                                                    and octet_length(tags::text) <= 2048)),
  match_state         text not null check (match_state in ('new', 'existing_company', 'possible_duplicate')),
  matched_company_id  uuid,
  created_at          timestamptz not null default now(),
  constraint company_enrichment_results_one_per_run unique (enrichment_run_id),
  constraint company_enrichment_results_run_fk foreign key (workspace_id, enrichment_run_id)
    references public.company_enrichment_runs (workspace_id, id) on delete cascade,
  constraint company_enrichment_results_matched_fk foreign key (workspace_id, matched_company_id)
    references public.companies (workspace_id, id) on delete set null (matched_company_id),
  constraint company_enrichment_results_employee_range check (employee_count_min is null or employee_count_max is null
                                                              or employee_count_min <= employee_count_max),
  constraint company_enrichment_results_existing_has_company check (match_state <> 'existing_company' or matched_company_id is not null)
);

comment on table public.company_enrichment_results is
  'The durable, normalized company fields one enrichment returned (bounded; no raw payload, no personal data). '
  'Insert-only: a result never changes after it is recorded.';

create index company_enrichment_results_domain_idx on public.company_enrichment_results (workspace_id, primary_domain);
create index company_enrichment_results_external_idx on public.company_enrichment_results (workspace_id, external_record_id)
  where external_record_id is not null;

-- -----------------------------------------------------------------------------
-- provider_usage_events: link to enrichment runs + estimated provider credits
-- -----------------------------------------------------------------------------
-- estimated_credit_millis: 1000 = one provider credit, ESTIMATED by Vleeds from
-- the provider's documented charge rule (0 = not chargeable, NULL = unknown).
-- Never the authoritative account balance.
alter table public.provider_usage_events
  add column enrichment_run_id uuid,
  add column estimated_credit_millis integer check (estimated_credit_millis is null or estimated_credit_millis between 0 and 1000000),
  add constraint provider_usage_events_enrichment_run_fk foreign key (workspace_id, enrichment_run_id)
    references public.company_enrichment_runs (workspace_id, id) on delete set null (enrichment_run_id),
  drop constraint provider_usage_events_status_check,
  add constraint provider_usage_events_status_check check (status in (
    'ok', 'empty', 'timeout', 'rate_limited', 'quota_exhausted', 'setup', 'invalid_request', 'unavailable', 'malformed', 'restricted'));

create index provider_usage_events_enrichment_run_idx on public.provider_usage_events (enrichment_run_id)
  where enrichment_run_id is not null;

drop trigger provider_usage_events_tenant_keys_immutable on public.provider_usage_events;
create trigger provider_usage_events_tenant_keys_immutable before update on public.provider_usage_events
  for each row execute function private.prevent_tenant_key_change('workspace_id', 'discovery_run_id', 'enrichment_run_id');

grant insert (enrichment_run_id, estimated_credit_millis) on table public.provider_usage_events to authenticated;

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------
-- Completed and cancelled runs are final. A run reaches 'completed' only from
-- 'processing' (the commit) or from 'review' (a skip).
create or replace function private.guard_enrichment_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('completed', 'cancelled') and new is distinct from old then
    raise exception 'enrichment run % is %', old.id, old.status using errcode = '55000';
  end if;
  if new.status = 'completed' and old.status not in ('processing', 'review') then
    raise exception 'enrichment run can only complete from review or processing' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- A result may only be recorded while its run is enriching (and only once: unique run id).
create or replace function private.guard_enrichment_result()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_provider text;
begin
  select r.status, r.provider_key into v_status, v_provider
    from public.company_enrichment_runs r where r.id = new.enrichment_run_id;
  if v_status is distinct from 'enriching' then
    raise exception 'enrichment run is not enriching' using errcode = '55000';
  end if;
  if v_provider is distinct from new.provider_key then
    raise exception 'result provider differs from the run' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_enrichment_run() from public, anon;
revoke all on function private.guard_enrichment_result() from public, anon;

create trigger company_enrichment_runs_guard before update on public.company_enrichment_runs
  for each row execute function private.guard_enrichment_run();
create trigger company_enrichment_results_guard before insert on public.company_enrichment_results
  for each row execute function private.guard_enrichment_result();
create trigger company_enrichment_runs_set_updated_at before update on public.company_enrichment_runs
  for each row execute function private.set_updated_at();
create trigger company_enrichment_runs_tenant_keys_immutable before update on public.company_enrichment_runs
  for each row execute function private.prevent_tenant_key_change(
    'workspace_id', 'created_by', 'provider_key', 'input_kind', 'discovery_candidate_id', 'target_company_id', 'manual_company_name');

-- A discovery reference that waited for enrichment ('needs_enrichment') may be
-- linked to the company it became even after its search was completed: the
-- only change allowed on a candidate of a final run. Everything else about
-- final runs stays frozen (P1-E3 rule).
create or replace function private.guard_discovery_candidate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select r.status into v_status from public.discovery_runs r where r.id = new.discovery_run_id;
  if v_status in ('completed', 'cancelled') then
    if not (tg_op = 'UPDATE'
            and old.decision = 'needs_enrichment'
            and new.decision = 'selected'
            and new.match_state = 'existing_company'
            and new.match_company_id is not null
            and (to_jsonb(new) - 'decision' - 'match_state' - 'match_company_id' - 'decided_by' - 'decided_at' - 'updated_at')
                = (to_jsonb(old) - 'decision' - 'match_state' - 'match_company_id' - 'decided_by' - 'decided_at' - 'updated_at')) then
      raise exception 'discovery run is %', v_status using errcode = '55000';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.decision is distinct from old.decision then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Counts change only when they really change (so linking a reference of a
-- final run never touches the frozen run row).
create or replace function private.refresh_discovery_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidates integer;
  v_selected   integer;
  v_dismissed  integer;
begin
  select count(*),
         count(*) filter (where c.decision in ('selected', 'needs_enrichment')),
         count(*) filter (where c.decision = 'dismissed')
    into v_candidates, v_selected, v_dismissed
    from public.discovery_candidates c where c.discovery_run_id = new.discovery_run_id;
  update public.discovery_runs r set
    candidate_count = v_candidates, selected_count = v_selected, dismissed_count = v_dismissed
  where r.id = new.discovery_run_id
    and (r.candidate_count, r.selected_count, r.dismissed_count) is distinct from (v_candidates, v_selected, v_dismissed);
  return null;
end;
$$;

revoke all on function private.refresh_discovery_counts() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- ingest_lead v2: + industry/description, provider-keyed evidence, enrichment runs
-- -----------------------------------------------------------------------------
-- Same contract as P1-E2 (manual and CSV callers are unchanged), plus:
--   * company fields industry / description;
--   * evidence items may carry provider_key + external_record_id (provider
--     identity); an identical identity row that already exists is kept (append-
--     only, no duplicate);
--   * p_enrichment_run_id: the run is locked; if it already has a commit
--     result nothing is written and that result is returned; it must be
--     'processing'. On success the run is completed with its outcome, and when
--     the run came from a discovery reference the reference's provider id is
--     linked to the written company (identity evidence only, no content) and
--     the reference is marked selected/existing_company.
drop function public.ingest_lead(uuid, jsonb, jsonb, jsonb, uuid);

create function public.ingest_lead(
  p_workspace_id uuid,
  p_company jsonb,
  p_contact jsonb default null,
  p_evidence jsonb default '[]'::jsonb,
  p_import_row_id uuid default null,
  p_enrichment_run_id uuid default null,
  p_notes jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row            record;
  v_run            record;
  v_candidate      record;
  v_batch_status   text;
  v_batch_id       uuid;
  v_company_id     uuid;
  v_contact_id     uuid;
  v_company_action text;
  v_contact_action text;
  v_linked         boolean := false;
  f                jsonb := coalesce(p_company -> 'fields', '{}'::jsonb);
  c                jsonb := coalesce(p_contact -> 'fields', '{}'::jsonb);
begin
  if p_import_row_id is not null and p_enrichment_run_id is not null then
    raise exception 'one source per call' using errcode = '22023';
  end if;

  if p_import_row_id is not null then
    select r.id, r.import_batch_id, r.commit_result, r.committed_company_id, r.committed_contact_id
      into v_row
      from public.import_rows r
     where r.id = p_import_row_id and r.workspace_id = p_workspace_id
       for update;
    if not found then
      raise exception 'import row not found' using errcode = '42501';
    end if;
    if v_row.commit_result is not null then
      return jsonb_build_object('already_committed', true, 'commit_result', v_row.commit_result,
                                'company_id', v_row.committed_company_id, 'contact_id', v_row.committed_contact_id);
    end if;
    v_batch_id := v_row.import_batch_id;
    select b.status into v_batch_status from public.import_batches b where b.id = v_batch_id;
    if v_batch_status is distinct from 'processing' then
      raise exception 'import batch is not being committed' using errcode = '55000';
    end if;
  end if;

  if p_enrichment_run_id is not null then
    select r.id, r.status, r.commit_result, r.committed_company_id, r.discovery_candidate_id
      into v_run
      from public.company_enrichment_runs r
     where r.id = p_enrichment_run_id and r.workspace_id = p_workspace_id
       for update;
    if not found then
      raise exception 'enrichment run not found' using errcode = '42501';
    end if;
    if v_run.commit_result is not null then
      return jsonb_build_object('already_committed', true, 'commit_result', v_run.commit_result,
                                'company_id', v_run.committed_company_id, 'contact_id', null);
    end if;
    if v_run.status is distinct from 'processing' then
      raise exception 'enrichment run is not being committed' using errcode = '55000';
    end if;
  end if;

  -- company -------------------------------------------------------------------
  if p_company ? 'id' then
    update public.companies x set
      canonical_name           = case when f ? 'canonical_name' then f ->> 'canonical_name' else x.canonical_name end,
      normalized_name          = case when f ? 'normalized_name' then f ->> 'normalized_name' else x.normalized_name end,
      website_url              = case when f ? 'website_url' then f ->> 'website_url' else x.website_url end,
      primary_domain           = case when f ? 'primary_domain' then f ->> 'primary_domain' else x.primary_domain end,
      primary_phone            = case when f ? 'primary_phone' then f ->> 'primary_phone' else x.primary_phone end,
      primary_phone_normalized = case when f ? 'primary_phone_normalized' then f ->> 'primary_phone_normalized' else x.primary_phone_normalized end,
      location                 = case when f ? 'location' then f -> 'location' else x.location end,
      employee_count_min       = case when f ? 'employee_count_min' then (f ->> 'employee_count_min')::integer else x.employee_count_min end,
      employee_count_max       = case when f ? 'employee_count_max' then (f ->> 'employee_count_max')::integer else x.employee_count_max end,
      industry                 = case when f ? 'industry' then f ->> 'industry' else x.industry end,
      description              = case when f ? 'description' then f ->> 'description' else x.description end,
      qualification_state      = case when f ? 'qualification_state' then f ->> 'qualification_state' else x.qualification_state end,
      notes                    = case when f ? 'notes' then f ->> 'notes' else x.notes end
    where x.id = (p_company ->> 'id')::uuid and x.workspace_id = p_workspace_id and x.archived_at is null
    returning x.id into v_company_id;
    if v_company_id is null then
      raise exception 'company not found' using errcode = '42501';
    end if;
    v_company_action := 'merged';
  else
    insert into public.companies (workspace_id, canonical_name, normalized_name, website_url, primary_domain,
                                  primary_phone, primary_phone_normalized, location, employee_count_min,
                                  employee_count_max, industry, description, qualification_state, notes)
    values (p_workspace_id, f ->> 'canonical_name', f ->> 'normalized_name', f ->> 'website_url', f ->> 'primary_domain',
            f ->> 'primary_phone', f ->> 'primary_phone_normalized', f -> 'location',
            (f ->> 'employee_count_min')::integer, (f ->> 'employee_count_max')::integer,
            f ->> 'industry', f ->> 'description',
            coalesce(f ->> 'qualification_state', 'unreviewed'), f ->> 'notes')
    returning id into v_company_id;
    v_company_action := 'created';
  end if;

  -- contact -------------------------------------------------------------------
  if p_contact is not null and jsonb_typeof(p_contact) = 'object' then
    if p_contact ? 'id' then
      update public.contacts x set
        first_name       = case when c ? 'first_name' then c ->> 'first_name' else x.first_name end,
        last_name        = case when c ? 'last_name' then c ->> 'last_name' else x.last_name end,
        full_name        = case when c ? 'full_name' then c ->> 'full_name' else x.full_name end,
        job_title        = case when c ? 'job_title' then c ->> 'job_title' else x.job_title end,
        seniority        = case when c ? 'seniority' then c ->> 'seniority' else x.seniority end,
        email            = case when c ? 'email' then c ->> 'email' else x.email end,
        normalized_email = case when c ? 'normalized_email' then c ->> 'normalized_email' else x.normalized_email end,
        phone            = case when c ? 'phone' then c ->> 'phone' else x.phone end,
        phone_normalized = case when c ? 'phone_normalized' then c ->> 'phone_normalized' else x.phone_normalized end,
        linkedin_url     = case when c ? 'linkedin_url' then c ->> 'linkedin_url' else x.linkedin_url end,
        notes            = case when c ? 'notes' then c ->> 'notes' else x.notes end
      where x.id = (p_contact ->> 'id')::uuid and x.workspace_id = p_workspace_id
        and x.company_id = v_company_id and x.archived_at is null
      returning x.id into v_contact_id;
      if v_contact_id is null then
        raise exception 'contact not found at this company' using errcode = '42501';
      end if;
      v_contact_action := 'merged';
    else
      insert into public.contacts (workspace_id, company_id, first_name, last_name, full_name, job_title, seniority,
                                   email, normalized_email, phone, phone_normalized, linkedin_url, notes, is_primary)
      values (p_workspace_id, v_company_id, c ->> 'first_name', c ->> 'last_name', c ->> 'full_name', c ->> 'job_title',
              c ->> 'seniority', c ->> 'email', c ->> 'normalized_email', c ->> 'phone', c ->> 'phone_normalized',
              c ->> 'linkedin_url', c ->> 'notes',
              case
                when coalesce((p_contact ->> 'is_primary')::boolean, false) then true
                when coalesce((p_contact ->> 'primary_if_none')::boolean, false) then not exists (
                  select 1 from public.contacts p
                   where p.company_id = v_company_id and p.is_primary and p.archived_at is null)
                else false
              end)
      returning id into v_contact_id;
      v_contact_action := 'created';
    end if;
  end if;

  -- evidence (append-only; an identical provider-identity row is kept, not duplicated)
  insert into public.lead_sources (workspace_id, company_id, contact_id, source_kind, provider_key, external_record_id,
                                   field_key, observed_value, import_batch_id, import_row_id)
  select p_workspace_id,
         v_company_id,
         case when e ->> 'subject' = 'contact' then v_contact_id end,
         e ->> 'source_kind',
         e ->> 'provider_key',
         e ->> 'external_record_id',
         e ->> 'field_key',
         e -> 'observed_value',
         v_batch_id,
         p_import_row_id
    from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) e
   where e ->> 'subject' = 'company' or (e ->> 'subject' = 'contact' and v_contact_id is not null)
  on conflict do nothing;

  if p_import_row_id is not null then
    update public.import_rows set
      commit_result        = v_company_action,
      committed_company_id = v_company_id,
      committed_contact_id = v_contact_id
    where id = p_import_row_id;
  end if;

  if p_enrichment_run_id is not null then
    -- The discovery reference this run came from becomes a durable identity link
    -- of the written company: provider key + provider id only, never content.
    -- Only while the reference still waits (or already is this company): a second,
    -- concurrent run for the same reference can never link it to another company.
    if v_run.discovery_candidate_id is not null then
      select dc.id, dc.provider_key, dc.external_record_id, dc.decision, dc.match_company_id
        into v_candidate
        from public.discovery_candidates dc
       where dc.id = v_run.discovery_candidate_id and dc.workspace_id = p_workspace_id
         for update;
      if found and (v_candidate.decision = 'needs_enrichment' or v_candidate.match_company_id = v_company_id) then
        insert into public.lead_sources (workspace_id, company_id, source_kind, provider_key, external_record_id, field_key)
        values (p_workspace_id, v_company_id, 'api', v_candidate.provider_key, v_candidate.external_record_id,
                'company.provider_reference')
        on conflict do nothing;
        v_linked := true;
        -- Smallest P1-E3 state change: the waiting reference now IS that company.
        if v_candidate.decision = 'needs_enrichment' then
          update public.discovery_candidates set
            decision = 'selected', match_state = 'existing_company', match_company_id = v_company_id
          where id = v_candidate.id;
        end if;
      end if;
    end if;

    update public.company_enrichment_runs set
      status               = 'completed',
      completed_at         = now(),
      commit_result        = v_company_action,
      committed_company_id = v_company_id,
      commit_notes         = case when jsonb_typeof(p_notes) = 'array' then p_notes else commit_notes end
    where id = p_enrichment_run_id;
  end if;

  return jsonb_build_object('already_committed', false, 'commit_result', v_company_action,
                            'company_id', v_company_id, 'contact_id', v_contact_id,
                            'contact_result', v_contact_action, 'identity_linked', v_linked);
end;
$$;

revoke all on function public.ingest_lead(uuid, jsonb, jsonb, jsonb, uuid, uuid, jsonb) from public, anon;
grant execute on function public.ingest_lead(uuid, jsonb, jsonb, jsonb, uuid, uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on table public.company_enrichment_runs, public.company_enrichment_results from public, anon, authenticated;
grant select on table public.company_enrichment_runs, public.company_enrichment_results to authenticated;

grant insert (workspace_id, provider_key, input_kind, discovery_candidate_id, target_company_id, manual_company_name,
              requested_domain, status)
  on table public.company_enrichment_runs to authenticated;
grant update (requested_domain, resolved_domain, status, error_code, match_state, match_reason, matched_company_id,
              decision, committed_company_id, commit_result, commit_notes, completed_at, cancelled_at)
  on table public.company_enrichment_runs to authenticated;

-- Results are insert-only.
grant insert (workspace_id, enrichment_run_id, provider_key, external_record_id, canonical_name, primary_domain,
              website_url, primary_phone, location, employee_count_min, employee_count_max, industry, description,
              tags, match_state, matched_company_id)
  on table public.company_enrichment_results to authenticated;

grant all on table public.company_enrichment_runs, public.company_enrichment_results to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security: collaborative workspace model (members)
-- -----------------------------------------------------------------------------
alter table public.company_enrichment_runs    enable row level security;
alter table public.company_enrichment_results enable row level security;

create policy company_enrichment_runs_select_member on public.company_enrichment_runs for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy company_enrichment_runs_insert_member on public.company_enrichment_runs for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy company_enrichment_runs_update_member on public.company_enrichment_runs for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));

create policy company_enrichment_results_select_member on public.company_enrichment_results for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy company_enrichment_results_insert_member on public.company_enrichment_results for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
