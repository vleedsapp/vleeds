-- =============================================================================
-- Vleeds P1-E3 — Company discovery foundation
--
-- workspaces ─< discovery_runs ─< discovery_candidates
--                    │
--                    └──< provider_usage_events
--
-- A discovery run is ONE user-initiated, interactive provider search (one
-- query + optional geography, paged on demand). Candidates are REFERENCES:
-- the provider's durable external id plus Vleeds-owned metadata (match state,
-- user decision). Provider display content (names, addresses, categories) is
-- deliberately NOT stored here: it is transient, shown only during the search
-- (docs/product/vleeds-discovery.md, docs/providers/google-places.md).
-- Continuation tokens are never stored either.
--
-- provider_usage_events records every provider request (counts, field mask,
-- status category); never API keys or raw payloads.
--
-- Access: any workspace member (collaborative model). Nothing is deletable
-- through the API.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- discovery_runs
-- -----------------------------------------------------------------------------
create table public.discovery_runs (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  icp_profile_id         uuid,
  icp_revision           integer check (icp_revision is null or icp_revision >= 1),
  provider_key           text not null check (provider_key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  query                  text not null check (char_length(query) between 1 and 200),
  -- The geography the user searched (Vleeds data): {countryCode, countryName, region, city, label}
  geography              jsonb check (geography is null or (jsonb_typeof(geography) = 'object' and octet_length(geography::text) <= 2048)),
  language_code          text check (language_code is null or language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  region_code            text check (region_code is null or region_code ~ '^[A-Z]{2}$'),
  status                 text not null default 'running'
                         check (status in ('running', 'review', 'completed', 'cancelled', 'failed')),
  requested_result_count integer check (requested_result_count is null or requested_result_count between 1 and 100),
  pages_loaded           integer not null default 0 check (pages_loaded >= 0),
  has_more               boolean not null default false,
  error_code             text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  candidate_count        integer not null default 0 check (candidate_count >= 0),
  selected_count         integer not null default 0 check (selected_count >= 0),
  dismissed_count        integer not null default 0 check (dismissed_count >= 0),
  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  completed_at           timestamptz,
  cancelled_at           timestamptz,
  constraint discovery_runs_workspace_id_id_key unique (workspace_id, id),
  -- lets candidates prove they use the run's provider
  constraint discovery_runs_workspace_id_id_provider_key unique (workspace_id, id, provider_key),
  constraint discovery_runs_icp_fk foreign key (workspace_id, icp_profile_id)
    references public.icp_profiles (workspace_id, id) on delete set null (icp_profile_id),
  constraint discovery_runs_revision_needs_profile check (icp_revision is null or icp_profile_id is not null),
  constraint discovery_runs_completed_has_time check (status <> 'completed' or completed_at is not null),
  constraint discovery_runs_cancelled_has_time check (status <> 'cancelled' or cancelled_at is not null),
  constraint discovery_runs_failed_has_code check (status <> 'failed' or error_code is not null)
);

comment on table public.discovery_runs is
  'One interactive, user-initiated provider search. Stores the Vleeds query/geography and counts; never provider content or continuation tokens.';

create index discovery_runs_workspace_created_idx on public.discovery_runs (workspace_id, created_at desc);
create index discovery_runs_icp_idx on public.discovery_runs (icp_profile_id) where icp_profile_id is not null;

-- -----------------------------------------------------------------------------
-- discovery_candidates: durable provider REFERENCES only
-- -----------------------------------------------------------------------------
create table public.discovery_candidates (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  discovery_run_id    uuid not null,
  provider_key        text not null,
  external_record_id  text not null check (char_length(external_record_id) between 1 and 256),
  -- order in which the provider returned it within this run (Vleeds metadata)
  position            integer not null default 0 check (position >= 0),
  match_state         text check (match_state is null or match_state in ('new', 'seen_before', 'existing_company')),
  match_company_id    uuid,
  decision            text not null default 'unreviewed'
                      check (decision in ('unreviewed', 'selected', 'dismissed', 'needs_enrichment')),
  decided_by          uuid references auth.users (id) on delete set null,
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint discovery_candidates_workspace_id_id_key unique (workspace_id, id),
  constraint discovery_candidates_one_per_run unique (discovery_run_id, provider_key, external_record_id),
  constraint discovery_candidates_run_fk foreign key (workspace_id, discovery_run_id, provider_key)
    references public.discovery_runs (workspace_id, id, provider_key) on delete cascade,
  constraint discovery_candidates_company_fk foreign key (workspace_id, match_company_id)
    references public.companies (workspace_id, id) on delete set null (match_company_id),
  constraint discovery_candidates_existing_has_company check (match_state is distinct from 'existing_company' or match_company_id is not null),
  -- "selected" means "this is that existing company"; references without a company await enrichment
  constraint discovery_candidates_selected_has_company check (decision <> 'selected' or match_company_id is not null)
);

comment on table public.discovery_candidates is
  'Provider references found by a discovery run (provider key + external id) and the user decision. No provider display content.';

create index discovery_candidates_run_idx on public.discovery_candidates (discovery_run_id, position);
create index discovery_candidates_identity_idx on public.discovery_candidates (workspace_id, provider_key, external_record_id);

-- -----------------------------------------------------------------------------
-- provider_usage_events: append-only request accounting
-- -----------------------------------------------------------------------------
create table public.provider_usage_events (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  discovery_run_id       uuid,
  provider_key           text not null check (provider_key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  operation              text not null check (operation ~ '^[a-z][a-z0-9_]{0,63}$'),
  requested_fields       text[] check (requested_fields is null or (cardinality(requested_fields) <= 50
                                       and octet_length(array_to_string(requested_fields, ',')) <= 2048)),
  request_count          integer not null check (request_count between 0 and 1000),
  result_count           integer not null default 0 check (result_count between 0 and 10000),
  status                 text not null check (status in ('ok', 'empty', 'timeout', 'rate_limited', 'setup', 'invalid_request', 'unavailable', 'malformed')),
  sku_hint               text check (sku_hint is null or char_length(sku_hint) <= 120),
  estimated_cost_micros  bigint check (estimated_cost_micros is null or estimated_cost_micros >= 0),
  pricing_reference      text check (pricing_reference is null or char_length(pricing_reference) <= 300),
  occurred_at            timestamptz not null default now(),
  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  constraint provider_usage_events_run_fk foreign key (workspace_id, discovery_run_id)
    references public.discovery_runs (workspace_id, id) on delete set null (discovery_run_id)
);

comment on table public.provider_usage_events is
  'One row per provider request batch: counts, requested fields and a status category. Never keys, tokens or payloads.';

create index provider_usage_events_workspace_time_idx on public.provider_usage_events (workspace_id, occurred_at desc);
create index provider_usage_events_run_idx on public.provider_usage_events (discovery_run_id) where discovery_run_id is not null;

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------
-- Completed and cancelled runs are final, and so are their candidates.
create or replace function private.guard_discovery_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('completed', 'cancelled') and new is distinct from old then
    raise exception 'discovery run % is %', old.id, old.status using errcode = '55000';
  end if;
  return new;
end;
$$;

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
    raise exception 'discovery run is %', v_status using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and new.decision is distinct from old.decision then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Keeps the run's counts equal to its candidates. SECURITY DEFINER so the
-- counts need no API update grant (they can't be set by hand); it only ever
-- recomputes from rows the caller could already write.
create or replace function private.refresh_discovery_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.discovery_runs r set
    candidate_count = (select count(*) from public.discovery_candidates c where c.discovery_run_id = r.id),
    selected_count  = (select count(*) from public.discovery_candidates c where c.discovery_run_id = r.id
                         and c.decision in ('selected', 'needs_enrichment')),
    dismissed_count = (select count(*) from public.discovery_candidates c where c.discovery_run_id = r.id
                         and c.decision = 'dismissed')
  where r.id = new.discovery_run_id;
  return null;
end;
$$;

revoke all on function private.guard_discovery_run() from public, anon;
revoke all on function private.guard_discovery_candidate() from public, anon;
revoke all on function private.refresh_discovery_counts() from public, anon, authenticated;

create trigger discovery_runs_guard before update on public.discovery_runs
  for each row execute function private.guard_discovery_run();
create trigger discovery_candidates_guard before insert or update on public.discovery_candidates
  for each row execute function private.guard_discovery_candidate();
create trigger discovery_candidates_counts after insert or update of decision on public.discovery_candidates
  for each row execute function private.refresh_discovery_counts();

create trigger discovery_runs_set_updated_at before update on public.discovery_runs
  for each row execute function private.set_updated_at();
create trigger discovery_candidates_set_updated_at before update on public.discovery_candidates
  for each row execute function private.set_updated_at();

create trigger discovery_runs_tenant_keys_immutable before update on public.discovery_runs
  for each row execute function private.prevent_tenant_key_change(
    'workspace_id', 'created_by', 'provider_key', 'query', 'geography', 'icp_profile_id', 'icp_revision',
    'language_code', 'region_code', 'requested_result_count');
create trigger discovery_candidates_tenant_keys_immutable before update on public.discovery_candidates
  for each row execute function private.prevent_tenant_key_change(
    'workspace_id', 'discovery_run_id', 'provider_key', 'external_record_id', 'position');
create trigger provider_usage_events_tenant_keys_immutable before update on public.provider_usage_events
  for each row execute function private.prevent_tenant_key_change('workspace_id', 'discovery_run_id');

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on table public.discovery_runs, public.discovery_candidates, public.provider_usage_events
  from public, anon, authenticated;
grant select on table public.discovery_runs, public.discovery_candidates, public.provider_usage_events to authenticated;

grant insert (workspace_id, icp_profile_id, icp_revision, provider_key, query, geography, language_code, region_code,
              requested_result_count, status)
  on table public.discovery_runs to authenticated;
grant update (status, pages_loaded, has_more, error_code, completed_at, cancelled_at)
  on table public.discovery_runs to authenticated;

grant insert (workspace_id, discovery_run_id, provider_key, external_record_id, position, match_state, match_company_id)
  on table public.discovery_candidates to authenticated;
grant update (decision, match_state, match_company_id)
  on table public.discovery_candidates to authenticated;

grant insert (workspace_id, discovery_run_id, provider_key, operation, requested_fields, request_count, result_count,
              status, sku_hint, estimated_cost_micros, pricing_reference)
  on table public.provider_usage_events to authenticated;

grant all on table public.discovery_runs, public.discovery_candidates, public.provider_usage_events to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security: collaborative workspace model (members)
-- -----------------------------------------------------------------------------
alter table public.discovery_runs        enable row level security;
alter table public.discovery_candidates  enable row level security;
alter table public.provider_usage_events enable row level security;

create policy discovery_runs_select_member on public.discovery_runs for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy discovery_runs_insert_member on public.discovery_runs for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy discovery_runs_update_member on public.discovery_runs for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));

create policy discovery_candidates_select_member on public.discovery_candidates for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy discovery_candidates_insert_member on public.discovery_candidates for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
create policy discovery_candidates_update_member on public.discovery_candidates for update to authenticated
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));

-- Usage is append-only: select + insert, no update or delete.
create policy provider_usage_events_select_member on public.provider_usage_events for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy provider_usage_events_insert_member on public.provider_usage_events for insert to authenticated
  with check (private.is_workspace_member(workspace_id));
