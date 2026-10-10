-- =============================================================================
-- Vleeds P0-E1-S2 — ICP configuration foundation
--
-- workspaces ──< icp_profiles
--
-- An ICP (ideal customer profile) describes who a workspace wants to sell to:
-- company criteria, target geographies, decision-maker titles, buying and
-- exclusion signals, and a scoring model. All of it is workspace DATA held in
-- validated, versioned jsonb. Nothing business-specific is encoded here.
--
-- Security model (see docs/architecture/vleeds-tenancy.md §8):
--   * RLS enabled; anon has no grants; authenticated has column-level grants.
--   * Read: any member of the workspace's organization.
--   * Create / update / archive: organization owner or admin only.
--   * No DELETE (archive via archived_at).
--   * workspace_id and created_by are immutable; revision is server-managed.
--
-- jsonb shape is defined by Zod in src/lib/config/icp.ts (schema_version 1).
-- The CHECK constraints below enforce top-level types, size limits and the
-- core numeric bounds, so even a client that bypasses the application cannot
-- store an impossible scoring model or company-size range.
--
-- A NULL section means "never saved" (not configured). An empty array that
-- was saved explicitly is meaningful (e.g. "no exclusions").
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Authorization helper: role in the organization that owns a workspace
-- -----------------------------------------------------------------------------
create or replace function private.has_workspace_role(p_workspace_id uuid, p_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.memberships m on m.organization_id = w.organization_id
    where w.id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

revoke all on function private.has_workspace_role(uuid, public.membership_role[]) from public, anon;
grant execute on function private.has_workspace_role(uuid, public.membership_role[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------
create table public.icp_profiles (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  name                   text not null check (char_length(btrim(name)) between 1 and 120),
  description            text check (description is null or char_length(description) <= 2000),
  is_default             boolean not null default false,
  archived_at            timestamptz,

  schema_version         integer not null default 1,
  revision               integer not null default 1 check (revision >= 1),

  ideal_customer         jsonb,
  target_geographies     jsonb,
  decision_maker_titles  jsonb,
  buying_signals         jsonb,
  exclusion_signals      jsonb,
  scoring_model          jsonb,

  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Future children (campaigns, lead_scores) reference (workspace_id, id) so
  -- they can never point at another workspace's profile.
  constraint icp_profiles_workspace_id_id_key unique (workspace_id, id),

  -- Supported jsonb shapes. A future shape change adds a version here and a
  -- data migration that upgrades existing rows.
  constraint icp_profiles_schema_version_supported check (schema_version in (1)),

  -- An archived profile can never be the default.
  constraint icp_profiles_default_not_archived check (not (is_default and archived_at is not null)),

  constraint icp_profiles_ideal_customer_shape check (
    ideal_customer is null or (
      jsonb_typeof(ideal_customer) = 'object'
      and octet_length(ideal_customer::text) <= 32768
      and case
            when jsonb_typeof(ideal_customer #> '{companySize,minEmployees}') = 'number'
             and jsonb_typeof(ideal_customer #> '{companySize,maxEmployees}') = 'number'
            then (ideal_customer #>> '{companySize,minEmployees}')::numeric
                 <= (ideal_customer #>> '{companySize,maxEmployees}')::numeric
            else true
          end
      and case
            when jsonb_typeof(ideal_customer #> '{companySize,minEmployees}') = 'number'
            then (ideal_customer #>> '{companySize,minEmployees}')::numeric >= 0
            else true
          end
    )
  ),
  constraint icp_profiles_target_geographies_shape check (
    target_geographies is null or (
      jsonb_typeof(target_geographies) = 'array'
      and jsonb_array_length(target_geographies) <= 100
      and octet_length(target_geographies::text) <= 65536
    )
  ),
  constraint icp_profiles_decision_maker_titles_shape check (
    decision_maker_titles is null or (
      jsonb_typeof(decision_maker_titles) = 'array'
      and jsonb_array_length(decision_maker_titles) <= 50
      and octet_length(decision_maker_titles::text) <= 32768
    )
  ),
  constraint icp_profiles_buying_signals_shape check (
    buying_signals is null or (
      jsonb_typeof(buying_signals) = 'array'
      and jsonb_array_length(buying_signals) <= 50
      and octet_length(buying_signals::text) <= 65536
    )
  ),
  constraint icp_profiles_exclusion_signals_shape check (
    exclusion_signals is null or (
      jsonb_typeof(exclusion_signals) = 'array'
      and jsonb_array_length(exclusion_signals) <= 50
      and octet_length(exclusion_signals::text) <= 65536
    )
  ),
  -- Grades: A >= thresholds.a, B >= thresholds.b, C below. 1 <= b < a <= 100,
  -- so every grade has a non-empty range and no two ranges overlap.
  constraint icp_profiles_scoring_model_shape check (
    scoring_model is null or (
      jsonb_typeof(scoring_model) = 'object'
      and octet_length(scoring_model::text) <= 8192
      and case
            when jsonb_typeof(scoring_model #> '{thresholds,a}') = 'number'
             and jsonb_typeof(scoring_model #> '{thresholds,b}') = 'number'
            then (scoring_model #>> '{thresholds,b}')::numeric >= 1
             and (scoring_model #>> '{thresholds,a}')::numeric <= 100
             and (scoring_model #>> '{thresholds,a}')::numeric > (scoring_model #>> '{thresholds,b}')::numeric
            else false
          end
    )
  )
);

comment on table public.icp_profiles is
  'Who a workspace wants to sell to. Several per workspace are allowed (e.g. per segment); at most one '
  'non-archived default. Criteria are versioned jsonb validated by src/lib/config/icp.ts; never code.';
comment on column public.icp_profiles.revision is
  'Incremented by trigger whenever the configuration changes. Used for optimistic concurrency. '
  'Campaign-time immutable snapshots will be added with campaigns.';

-- Active profiles of a workspace (also serves the workspace_id foreign key).
create index icp_profiles_workspace_id_archived_at_idx on public.icp_profiles (workspace_id, archived_at);

-- At most one active default profile per workspace (and the default lookup).
create unique index icp_profiles_one_default_per_workspace
  on public.icp_profiles (workspace_id)
  where is_default and archived_at is null;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
-- revision is server-managed: +1 when any configuration column changes,
-- otherwise unchanged (it is also not granted to API roles).
create or replace function private.bump_icp_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.name, new.description, new.schema_version, new.ideal_customer, new.target_geographies,
      new.decision_maker_titles, new.buying_signals, new.exclusion_signals, new.scoring_model)
     is distinct from
     (old.name, old.description, old.schema_version, old.ideal_customer, old.target_geographies,
      old.decision_maker_titles, old.buying_signals, old.exclusion_signals, old.scoring_model)
  then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

revoke all on function private.bump_icp_revision() from public, anon;

create trigger icp_profiles_bump_revision
  before update on public.icp_profiles
  for each row execute function private.bump_icp_revision();

create trigger icp_profiles_set_updated_at
  before update on public.icp_profiles
  for each row execute function private.set_updated_at();

create trigger icp_profiles_tenant_keys_immutable
  before update on public.icp_profiles
  for each row execute function private.prevent_tenant_key_change('workspace_id', 'created_by');

-- -----------------------------------------------------------------------------
-- Privileges (deny by default; column-level writes)
-- -----------------------------------------------------------------------------
revoke all on table public.icp_profiles from public, anon, authenticated;

grant select on table public.icp_profiles to authenticated;
grant insert (workspace_id, name, description, is_default, schema_version, ideal_customer, target_geographies,
              decision_maker_titles, buying_signals, exclusion_signals, scoring_model)
  on table public.icp_profiles to authenticated;
grant update (name, description, is_default, archived_at, schema_version, ideal_customer, target_geographies,
              decision_maker_titles, buying_signals, exclusion_signals, scoring_model)
  on table public.icp_profiles to authenticated;

grant all on table public.icp_profiles to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.icp_profiles enable row level security;

create policy icp_profiles_select_member
  on public.icp_profiles for select to authenticated
  using (private.is_workspace_member(workspace_id));

create policy icp_profiles_insert_admin
  on public.icp_profiles for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.membership_role[]));

create policy icp_profiles_update_admin
  on public.icp_profiles for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.membership_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.membership_role[]));

-- No DELETE policy or grant: profiles are archived (archived_at), not deleted.
