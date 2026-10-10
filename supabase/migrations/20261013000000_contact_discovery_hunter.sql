-- =============================================================================
-- Vleeds P1-E5 — Decision-maker / professional contact discovery (first
-- provider: Hunter Domain Search)
--
-- companies ─< contact_discovery_runs ─< contact_discovery_candidates
--                    │                          ╎ matched_contact_id / committed_contact_id → contacts
--                    └──< provider_usage_events (domain_search, estimated credits)
--
-- A contact-discovery run = ONE explicit, user-initiated search for
-- professional people at ONE company (its stored domain), using roles from an
-- ICP profile (recorded with its revision) or titles typed for that search.
-- Candidates are STAGING/REVIEW records (not outreach records): minimal
-- professional fields for review, deduplication and contact creation. No raw
-- provider payloads. Selected candidates become contacts through
-- public.commit_contact_candidate(), which uses public.ingest_lead().
--
-- Also (P1-E4 follow-up F1): at most one OPEN company-enrichment run per
-- discovery reference.
--
-- Access: any workspace member (collaborative model). Nothing is deletable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- P1-E4 F1: one open enrichment run per discovery candidate
-- -----------------------------------------------------------------------------
create unique index company_enrichment_runs_one_open_per_candidate
  on public.company_enrichment_runs (discovery_candidate_id)
  where discovery_candidate_id is not null and status not in ('completed', 'cancelled');

-- -----------------------------------------------------------------------------
-- contact_discovery_runs
-- -----------------------------------------------------------------------------
create table public.contact_discovery_runs (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  company_id          uuid not null,
  icp_profile_id      uuid,
  icp_revision        integer check (icp_revision is null or icp_revision >= 1),
  provider_key        text not null check (provider_key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  -- The domain searched (the company's stored, normalized domain at search time).
  domain              text not null check (char_length(domain) <= 253
                        and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  status              text not null default 'draft'
                      check (status in ('draft', 'searching', 'review', 'completed', 'cancelled', 'failed')),
  -- Search criteria for THIS run only: [{title, priority}] (≤ 10). Never written back to the ICP.
  selected_titles     jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(selected_titles) = 'array' and jsonb_array_length(selected_titles) <= 10
                             and octet_length(selected_titles::text) <= 4096),
  decision_maker_only boolean not null default false,
  requested_limit     integer not null default 10 check (requested_limit between 1 and 10),
  result_count        integer not null default 0 check (result_count between 0 and 100),
  selected_count      integer not null default 0 check (selected_count >= 0),
  dismissed_count     integer not null default 0 check (dismissed_count >= 0),
  saved_count         integer not null default 0 check (saved_count >= 0),
  error_code          text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  constraint contact_discovery_runs_workspace_id_id_key unique (workspace_id, id),
  -- lets candidates prove they belong to the run's company
  constraint contact_discovery_runs_workspace_id_id_company_key unique (workspace_id, id, company_id),
  constraint contact_discovery_runs_company_fk foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete cascade,
  constraint contact_discovery_runs_icp_fk foreign key (workspace_id, icp_profile_id)
    references public.icp_profiles (workspace_id, id) on delete set null (icp_profile_id),
  constraint contact_discovery_runs_revision_needs_profile check (icp_revision is null or icp_profile_id is not null),
  constraint contact_discovery_runs_needs_criteria check (jsonb_array_length(selected_titles) > 0 or decision_maker_only),
  constraint contact_discovery_runs_failed_has_code check (status <> 'failed' or error_code is not null),
  constraint contact_discovery_runs_completed_has_time check (status <> 'completed' or completed_at is not null),
  constraint contact_discovery_runs_cancelled_has_time check (status <> 'cancelled' or cancelled_at is not null)
);

comment on table public.contact_discovery_runs is
  'One explicit professional-contact search for one company (its domain), with the ICP profile/revision or titles used. '
  'Never stores provider payloads.';

create index contact_discovery_runs_company_created_idx on public.contact_discovery_runs (company_id, created_at desc);
create index contact_discovery_runs_workspace_created_idx on public.contact_discovery_runs (workspace_id, created_at desc);

-- -----------------------------------------------------------------------------
-- contact_discovery_candidates: minimal professional fields for review
-- -----------------------------------------------------------------------------
create table public.contact_discovery_candidates (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete cascade,
  contact_discovery_run_id  uuid not null,
  company_id                uuid not null,
  provider_key              text not null check (provider_key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  -- Only a real, stable provider record id. Hunter Domain Search has none: NULL.
  provider_external_id      text check (provider_external_id is null or char_length(provider_external_id) between 1 and 256),
  position                  integer not null default 0 check (position between 0 and 100),
  full_name                 text not null check (char_length(btrim(full_name)) between 1 and 200),
  first_name                text check (first_name is null or char_length(first_name) <= 100),
  last_name                 text check (last_name is null or char_length(last_name) <= 100),
  job_title                 text check (job_title is null or char_length(job_title) <= 200),
  email                     text not null check (char_length(email) <= 320),
  normalized_email          text not null check (normalized_email = lower(btrim(normalized_email))
                                                 and normalized_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                                                 and char_length(normalized_email) <= 320),
  phone                     text check (phone is null or char_length(phone) between 3 and 40),
  linkedin_url              text check (linkedin_url is null or (char_length(linkedin_url) <= 2048 and linkedin_url ~* '^https://')),
  provider_seniority        text check (provider_seniority is null or provider_seniority ~ '^[a-z_]{1,40}$'),
  provider_department       text check (provider_department is null or provider_department ~ '^[a-z_]{1,60}$'),
  provider_decision_maker   boolean,
  verification_status       text check (verification_status is null or verification_status in ('valid', 'accept_all', 'unknown', 'invalid')),
  confidence                integer check (confidence is null or confidence between 0 and 100),
  -- Small normalized summary of the provider's public sources (no URLs, no pages).
  source_count              integer check (source_count is null or source_count between 0 and 10000),
  last_seen_on              date,
  role_match                text not null default 'other'
                            check (role_match in ('primary', 'secondary', 'fallback', 'search_title', 'decision_maker', 'other')),
  match_state               text not null check (match_state in ('new', 'existing_contact', 'possible_duplicate', 'conflict')),
  matched_contact_id        uuid,
  decision                  text not null default 'unreviewed' check (decision in ('unreviewed', 'selected', 'dismissed')),
  -- How a selected candidate is written: a new contact, or merged into the matched one.
  selected_action           text check (selected_action is null or selected_action in ('create', 'merge')),
  commit_result             text check (commit_result is null or commit_result in ('created', 'merged')),
  committed_contact_id      uuid,
  decided_by                uuid references auth.users (id) on delete set null,
  decided_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint contact_discovery_candidates_workspace_id_id_key unique (workspace_id, id),
  constraint contact_discovery_candidates_one_email_per_run unique (contact_discovery_run_id, normalized_email),
  constraint contact_discovery_candidates_run_fk foreign key (workspace_id, contact_discovery_run_id, company_id)
    references public.contact_discovery_runs (workspace_id, id, company_id) on delete cascade,
  constraint contact_discovery_candidates_matched_fk foreign key (workspace_id, matched_contact_id)
    references public.contacts (workspace_id, id) on delete set null (matched_contact_id),
  constraint contact_discovery_candidates_committed_fk foreign key (workspace_id, company_id, committed_contact_id)
    references public.contacts (workspace_id, company_id, id) on delete set null (committed_contact_id),
  constraint contact_discovery_candidates_match_has_contact check (match_state = 'new' or matched_contact_id is not null),
  -- A contact whose email belongs to another company is never selected (not moved, not duplicated).
  constraint contact_discovery_candidates_conflict_not_selected check (match_state <> 'conflict' or decision <> 'selected'),
  constraint contact_discovery_candidates_selected_has_action check ((decision = 'selected') = (selected_action is not null)),
  constraint contact_discovery_candidates_action_fits check (
    selected_action is null
    or (match_state = 'new' and selected_action = 'create')
    or (match_state = 'existing_contact' and selected_action = 'merge')
    or (match_state = 'possible_duplicate')),
  constraint contact_discovery_candidates_committed_shape check ((commit_result is null) = (committed_contact_id is null))
);

comment on table public.contact_discovery_candidates is
  'Staging/review records of one contact search: minimal professional fields, match against existing contacts and '
  'the user decision. Not outreach records; no provider payloads.';

create index contact_discovery_candidates_run_idx on public.contact_discovery_candidates (contact_discovery_run_id, position);
create index contact_discovery_candidates_matched_idx on public.contact_discovery_candidates (matched_contact_id)
  where matched_contact_id is not null;

-- -----------------------------------------------------------------------------
-- provider_usage_events: link to contact searches
-- -----------------------------------------------------------------------------
alter table public.provider_usage_events
  add column contact_discovery_run_id uuid,
  add column company_id uuid,
  add constraint provider_usage_events_contact_run_fk foreign key (workspace_id, contact_discovery_run_id)
    references public.contact_discovery_runs (workspace_id, id) on delete set null (contact_discovery_run_id),
  add constraint provider_usage_events_company_fk foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete set null (company_id);

create index provider_usage_events_contact_run_idx on public.provider_usage_events (contact_discovery_run_id)
  where contact_discovery_run_id is not null;

drop trigger provider_usage_events_tenant_keys_immutable on public.provider_usage_events;
create trigger provider_usage_events_tenant_keys_immutable before update on public.provider_usage_events
  for each row execute function private.prevent_tenant_key_change(
    'workspace_id', 'discovery_run_id', 'enrichment_run_id', 'contact_discovery_run_id', 'company_id');

grant insert (contact_discovery_run_id, company_id) on table public.provider_usage_events to authenticated;

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------
create or replace function private.guard_contact_discovery_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('completed', 'cancelled') and new is distinct from old then
    raise exception 'contact discovery run % is %', old.id, old.status using errcode = '55000';
  end if;
  return new;
end;
$$;

-- Candidates: only while the run is in review; a committed candidate is frozen;
-- an existing/possible-duplicate match must be a contact of THIS company;
-- decisions are stamped.
create or replace function private.guard_contact_discovery_candidate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_contact_company uuid;
begin
  if tg_op = 'UPDATE' and old.commit_result is not null and new is distinct from old then
    raise exception 'candidate % is already saved', old.id using errcode = '55000';
  end if;
  select r.status into v_status from public.contact_discovery_runs r where r.id = new.contact_discovery_run_id;
  if v_status is distinct from (case when tg_op = 'INSERT' then 'searching' else 'review' end) then
    raise exception 'contact discovery run is %', v_status using errcode = '55000';
  end if;
  if new.match_state in ('existing_contact', 'possible_duplicate') then
    select c.company_id into v_contact_company from public.contacts c where c.id = new.matched_contact_id;
    if v_contact_company is distinct from new.company_id then
      raise exception 'matched contact is not at this company' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.decision is distinct from old.decision then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function private.refresh_contact_discovery_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_results integer; v_selected integer; v_dismissed integer; v_saved integer;
begin
  select count(*),
         count(*) filter (where c.decision = 'selected'),
         count(*) filter (where c.decision = 'dismissed'),
         count(*) filter (where c.commit_result is not null)
    into v_results, v_selected, v_dismissed, v_saved
    from public.contact_discovery_candidates c where c.contact_discovery_run_id = new.contact_discovery_run_id;
  update public.contact_discovery_runs r set
    result_count = v_results, selected_count = v_selected, dismissed_count = v_dismissed, saved_count = v_saved
  where r.id = new.contact_discovery_run_id
    and (r.result_count, r.selected_count, r.dismissed_count, r.saved_count) is distinct from (v_results, v_selected, v_dismissed, v_saved);
  return null;
end;
$$;

revoke all on function private.guard_contact_discovery_run() from public, anon;
revoke all on function private.guard_contact_discovery_candidate() from public, anon;
revoke all on function private.refresh_contact_discovery_counts() from public, anon, authenticated;

create trigger contact_discovery_runs_guard before update on public.contact_discovery_runs
  for each row execute function private.guard_contact_discovery_run();
create trigger contact_discovery_candidates_guard before insert or update on public.contact_discovery_candidates
  for each row execute function private.guard_contact_discovery_candidate();
create trigger contact_discovery_candidates_counts after insert or update of decision, commit_result on public.contact_discovery_candidates
  for each row execute function private.refresh_contact_discovery_counts();

create trigger contact_discovery_runs_set_updated_at before update on public.contact_discovery_runs
  for each row execute function private.set_updated_at();
create trigger contact_discovery_candidates_set_updated_at before update on public.contact_discovery_candidates
  for each row execute function private.set_updated_at();

create trigger contact_discovery_runs_tenant_keys_immutable before update on public.contact_discovery_runs
  for each row execute function private.prevent_tenant_key_change(
    'workspace_id', 'company_id', 'created_by', 'provider_key', 'domain', 'icp_profile_id', 'icp_revision',
    'selected_titles', 'decision_maker_only', 'requested_limit');
create trigger contact_discovery_candidates_tenant_keys_immutable before update on public.contact_discovery_candidates
  for each row execute function private.prevent_tenant_key_change(
    'workspace_id', 'contact_discovery_run_id', 'company_id', 'provider_key', 'provider_external_id', 'normalized_email',
    'email', 'full_name', 'match_state', 'matched_contact_id', 'role_match');

-- -----------------------------------------------------------------------------
-- commit_contact_candidate: write ONE selected candidate through ingest_lead
-- -----------------------------------------------------------------------------
-- p_contact   {"id"?: uuid, "fields": {...}, "primary_if_none"?: bool}; id is
--             only allowed for the candidate's matched contact (merge).
-- p_evidence  evidence items (see ingest_lead); written for the company's contact.
-- Locks the candidate. If it was already saved, returns that outcome and
-- writes nothing (idempotent). Refuses: unselected or conflict candidates,
-- runs not in review, and a new contact whose email already belongs to an
-- active contact anywhere in the workspace (never duplicated, never moved).
-- SECURITY INVOKER: the caller's RLS and grants apply.
create or replace function public.commit_contact_candidate(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_contact jsonb,
  p_evidence jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c       record;
  v_status  text;
  v_result  jsonb;
  v_contact uuid;
begin
  select c.id, c.company_id, c.contact_discovery_run_id, c.decision, c.selected_action, c.match_state,
         c.matched_contact_id, c.normalized_email, c.commit_result, c.committed_contact_id
    into v_c
    from public.contact_discovery_candidates c
   where c.id = p_candidate_id and c.workspace_id = p_workspace_id
     for update;
  if not found then
    raise exception 'candidate not found' using errcode = '42501';
  end if;
  if v_c.commit_result is not null then
    return jsonb_build_object('already_committed', true, 'commit_result', v_c.commit_result, 'contact_id', v_c.committed_contact_id);
  end if;
  select r.status into v_status from public.contact_discovery_runs r where r.id = v_c.contact_discovery_run_id;
  if v_status is distinct from 'review' then
    raise exception 'contact discovery run is not in review' using errcode = '55000';
  end if;
  if v_c.decision <> 'selected' or v_c.match_state = 'conflict' then
    raise exception 'candidate is not selected' using errcode = '55000';
  end if;
  if v_c.selected_action = 'merge' then
    if (p_contact ->> 'id') is distinct from v_c.matched_contact_id::text then
      raise exception 'merge target must be the matched contact' using errcode = '42501';
    end if;
  else
    if p_contact ? 'id' then
      raise exception 'a new contact has no id' using errcode = '22023';
    end if;
    if exists (select 1 from public.contacts k
                where k.workspace_id = p_workspace_id and k.normalized_email = v_c.normalized_email and k.archived_at is null) then
      raise exception 'email already belongs to a contact' using errcode = '23505';
    end if;
  end if;

  v_result := public.ingest_lead(p_workspace_id, jsonb_build_object('id', v_c.company_id, 'fields', '{}'::jsonb),
                                 p_contact, p_evidence, null);
  v_contact := (v_result ->> 'contact_id')::uuid;

  update public.contact_discovery_candidates set
    commit_result = case when v_c.selected_action = 'merge' then 'merged' else 'created' end,
    committed_contact_id = v_contact
  where id = v_c.id;

  return jsonb_build_object('already_committed', false,
                            'commit_result', case when v_c.selected_action = 'merge' then 'merged' else 'created' end,
                            'contact_id', v_contact);
end;
$$;

revoke all on function public.commit_contact_candidate(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.commit_contact_candidate(uuid, uuid, jsonb, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on table public.contact_discovery_runs, public.contact_discovery_candidates from public, anon, authenticated;
grant select on table public.contact_discovery_runs, public.contact_discovery_candidates to authenticated;

grant insert (workspace_id, company_id, icp_profile_id, icp_revision, provider_key, domain, status, selected_titles,
              decision_maker_only, requested_limit)
  on table public.contact_discovery_runs to authenticated;
grant update (status, error_code, completed_at, cancelled_at) on table public.contact_discovery_runs to authenticated;

grant insert (workspace_id, contact_discovery_run_id, company_id, provider_key, provider_external_id, position, full_name,
              first_name, last_name, job_title, email, normalized_email, phone, linkedin_url, provider_seniority,
              provider_department, provider_decision_maker, verification_status, confidence, source_count, last_seen_on,
              role_match, match_state, matched_contact_id)
  on table public.contact_discovery_candidates to authenticated;
grant update (decision, selected_action, commit_result, committed_contact_id)
  on table public.contact_discovery_candidates to authenticated;

grant all on table public.contact_discovery_runs, public.contact_discovery_candidates to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security: collaborative workspace model (members)
-- -----------------------------------------------------------------------------
alter table public.contact_discovery_runs       enable row level security;
alter table public.contact_discovery_candidates enable row level security;

create policy contact_discovery_runs_select_member on public.contact_discovery_runs for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy contact_discovery_runs_insert_member on public.contact_discovery_runs for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy contact_discovery_runs_update_member on public.contact_discovery_runs for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));

create policy contact_discovery_candidates_select_member on public.contact_discovery_candidates for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy contact_discovery_candidates_insert_member on public.contact_discovery_candidates for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy contact_discovery_candidates_update_member on public.contact_discovery_candidates for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
