-- =============================================================================
-- Vleeds P0-E1-S1 — Tenancy foundation
--
-- organizations → memberships → workspaces
--
-- Security model (see docs/architecture/vleeds-tenancy.md):
--   * Deny by default: RLS enabled on every table, anon has no grants,
--     authenticated has only the column-level grants listed below.
--   * Access is derived from memberships(organization_id, user_id).
--   * Authorization helpers live in the `private` schema, which is NOT exposed
--     through the Data API, and are SECURITY DEFINER so policies on
--     `memberships` do not recurse.
--   * Tenant keys (organization_id, user_id) are immutable after insert.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schemas & types
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated, service_role;

create type public.membership_role as enum ('owner', 'admin', 'member');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  slug        text not null unique
              check (char_length(slug) between 2 and 64 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.organizations is
  'Tenant root. Every tenant-owned record ultimately belongs to exactly one organization.';

create table public.memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             public.membership_role not null default 'member',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

comment on table public.memberships is
  'Grants a user access to an organization and all of its workspaces. Role controls administration rights.';

create table public.workspaces (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  slug             text not null
                   check (char_length(slug) between 2 and 64 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description      text check (description is null or char_length(description) <= 2000),
  website_url      text check (website_url is null or (char_length(website_url) <= 2048 and website_url ~* '^https?://')),
  primary_domain   text check (primary_domain is null or (char_length(primary_domain) <= 253
                                 and primary_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')),
  logo_url         text check (logo_url is null or (char_length(logo_url) <= 2048 and logo_url ~* '^https://')),
  settings         jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  archived_at      timestamptz,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, slug)
);

create index workspaces_organization_id_idx on public.workspaces (organization_id);

comment on table public.workspaces is
  'A business/brand being prospected for. Business profile is data, never code. '
  'All future prospecting records (companies, contacts, campaigns, ...) carry workspace_id.';

-- -----------------------------------------------------------------------------
-- Authorization helpers (private schema, not exposed via the Data API)
-- -----------------------------------------------------------------------------
create or replace function private.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_org_role(p_organization_id uuid, p_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

-- Used by every future workspace-owned table's policies.
create or replace function private.is_workspace_member(p_workspace_id uuid)
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
  );
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, public.membership_role[]) from public, anon;
revoke all on function private.is_workspace_member(uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.membership_role[]) to authenticated, service_role;
grant execute on function private.is_workspace_member(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Tenant keys never change after insert: moving a row between tenants is
-- always a delete + insert under the destination tenant's policies.
create or replace function private.prevent_tenant_key_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_col text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  foreach v_col in array tg_argv loop
    if v_old -> v_col is distinct from v_new -> v_col then
      raise exception 'column %.% is immutable', tg_table_name, v_col
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

-- An organization must always keep at least one owner. Enforced for
-- end-user (JWT-authenticated) requests; privileged maintenance contexts
-- (no auth.uid(), e.g. cascading deletes of an organization or auth user)
-- are allowed through.
create or replace function private.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return coalesce(new, old);
  end if;

  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (
      select 1 from public.memberships m
      where m.organization_id = old.organization_id
        and m.role = 'owner'
        and m.id <> old.id
    ) then
      raise exception 'an organization must keep at least one owner'
        using errcode = '23514';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function private.set_updated_at() from public, anon;
revoke all on function private.prevent_tenant_key_change() from public, anon;
revoke all on function private.protect_last_owner() from public, anon;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function private.set_updated_at();

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function private.set_updated_at();

create trigger memberships_tenant_keys_immutable
  before update on public.memberships
  for each row execute function private.prevent_tenant_key_change('organization_id', 'user_id');

create trigger workspaces_tenant_keys_immutable
  before update on public.workspaces
  for each row execute function private.prevent_tenant_key_change('organization_id', 'created_by');

create trigger memberships_protect_last_owner
  before update or delete on public.memberships
  for each row execute function private.protect_last_owner();

-- -----------------------------------------------------------------------------
-- Organization creation (atomic org + owner membership)
-- Direct INSERT on organizations is not granted to API roles.
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_org_id  uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (btrim(p_name), p_slug, v_user_id)
  returning id into v_org_id;

  insert into public.memberships (organization_id, user_id, role)
  values (v_org_id, v_user_id, 'owner');

  return v_org_id;
end;
$$;

revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Privileges (deny by default; column-level where writes are allowed)
-- -----------------------------------------------------------------------------
revoke all on table public.organizations, public.memberships, public.workspaces from public, anon, authenticated;

grant select on table public.organizations to authenticated;
grant update (name, slug) on table public.organizations to authenticated;

grant select, delete on table public.memberships to authenticated;
grant insert (organization_id, user_id, role) on table public.memberships to authenticated;
grant update (role) on table public.memberships to authenticated;

grant select on table public.workspaces to authenticated;
grant insert (organization_id, name, slug, description, website_url, primary_domain, logo_url, settings)
  on table public.workspaces to authenticated;
grant update (name, slug, description, website_url, primary_domain, logo_url, settings, archived_at)
  on table public.workspaces to authenticated;

grant all on table public.organizations, public.memberships, public.workspaces to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.workspaces    enable row level security;

-- organizations ---------------------------------------------------------------
create policy organizations_select_member
  on public.organizations for select to authenticated
  using (private.is_org_member(id));

create policy organizations_update_admin
  on public.organizations for update to authenticated
  using (private.has_org_role(id, array['owner', 'admin']::public.membership_role[]))
  with check (private.has_org_role(id, array['owner', 'admin']::public.membership_role[]));

-- No INSERT policy (use public.create_organization). No DELETE policy in P0.

-- memberships -----------------------------------------------------------------
create policy memberships_select_same_org
  on public.memberships for select to authenticated
  using (private.is_org_member(organization_id));

-- Owners manage any membership; admins manage non-owner memberships only.
create policy memberships_insert_admin
  on public.memberships for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner']::public.membership_role[])
    or (private.has_org_role(organization_id, array['admin']::public.membership_role[]) and role <> 'owner')
  );

create policy memberships_update_admin
  on public.memberships for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner']::public.membership_role[])
    or (private.has_org_role(organization_id, array['admin']::public.membership_role[]) and role <> 'owner')
  )
  with check (
    private.has_org_role(organization_id, array['owner']::public.membership_role[])
    or (private.has_org_role(organization_id, array['admin']::public.membership_role[]) and role <> 'owner')
  );

-- Admin-managed removal, or a user leaving an organization themselves.
create policy memberships_delete_admin_or_self
  on public.memberships for delete to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_org_role(organization_id, array['owner']::public.membership_role[])
    or (private.has_org_role(organization_id, array['admin']::public.membership_role[]) and role <> 'owner')
  );

-- workspaces ------------------------------------------------------------------
create policy workspaces_select_member
  on public.workspaces for select to authenticated
  using (private.is_org_member(organization_id));

create policy workspaces_insert_admin
  on public.workspaces for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner', 'admin']::public.membership_role[]));

create policy workspaces_update_admin
  on public.workspaces for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.membership_role[]))
  with check (private.has_org_role(organization_id, array['owner', 'admin']::public.membership_role[]));

-- No DELETE policy in P0: workspaces are archived (archived_at), not deleted.
