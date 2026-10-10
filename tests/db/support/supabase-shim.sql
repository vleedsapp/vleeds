-- Minimal, faithful stand-in for the parts of the Supabase platform that the
-- Vleeds migrations depend on. Used ONLY by the embedded-Postgres (PGlite)
-- test driver; against a real Supabase stack this file is never applied.
--
-- Mirrors Supabase behaviour that matters for authorization:
--   * API roles anon / authenticated / service_role (service_role bypasses RLS)
--   * auth.uid() / auth.role() / auth.jwt() read the request JWT claims GUC
--   * Supabase's default privileges: new public tables & functions are
--     granted to anon/authenticated/service_role, so migrations MUST revoke
--     explicitly (this is what makes the deny-by-default tests meaningful).

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id         uuid primary key,
  email      text unique,
  created_at timestamptz not null default now()
);

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb;
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text;
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
