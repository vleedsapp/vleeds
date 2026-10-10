-- =============================================================================
-- Vleeds local development seed — GENERIC TEST DATA ONLY.
-- Applied by `supabase db reset` against the local stack. Never run in prod.
--
-- Users (password for all: vleeds-dev-password)
--   owner.a@example.test   owner  of "Example Org A"
--   member.a@example.test  member of "Example Org A"
--   owner.b@example.test   owner  of "Example Org B"
--   multi@example.test     admin  of A, member of B  (exercises the switcher)
--   new@example.test       no memberships            (exercises onboarding)
-- =============================================================================

do $$
declare
  v_users constant jsonb := '[
    {"id": "00000000-0000-4000-a000-00000000000a", "email": "owner.a@example.test"},
    {"id": "00000000-0000-4000-a000-00000000000b", "email": "member.a@example.test"},
    {"id": "00000000-0000-4000-a000-00000000000c", "email": "owner.b@example.test"},
    {"id": "00000000-0000-4000-a000-00000000000d", "email": "multi@example.test"},
    {"id": "00000000-0000-4000-a000-00000000000e", "email": "new@example.test"}
  ]';
  v_user jsonb;
begin
  for v_user in select * from jsonb_array_elements(v_users) loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      (v_user ->> 'id')::uuid, 'authenticated', 'authenticated', v_user ->> 'email',
      extensions.crypt('vleeds-dev-password', extensions.gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), (v_user ->> 'id')::uuid, v_user ->> 'id',
      jsonb_build_object('sub', v_user ->> 'id', 'email', v_user ->> 'email', 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;
end;
$$;

insert into public.organizations (id, name, slug, created_by) values
  ('10000000-0000-4000-a000-00000000000a', 'Example Org A', 'example-org-a', '00000000-0000-4000-a000-00000000000a'),
  ('10000000-0000-4000-a000-00000000000b', 'Example Org B', 'example-org-b', '00000000-0000-4000-a000-00000000000c');

insert into public.memberships (organization_id, user_id, role) values
  ('10000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-00000000000a', 'owner'),
  ('10000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-00000000000b', 'member'),
  ('10000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-00000000000d', 'admin'),
  ('10000000-0000-4000-a000-00000000000b', '00000000-0000-4000-a000-00000000000c', 'owner'),
  ('10000000-0000-4000-a000-00000000000b', '00000000-0000-4000-a000-00000000000d', 'member');

insert into public.workspaces (id, organization_id, name, slug, description, website_url, primary_domain, created_by) values
  ('20000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-00000000000a', 'Alpha Workspace', 'alpha',
   'Generic development workspace.', 'https://alpha.example.test', 'alpha.example.test', '00000000-0000-4000-a000-00000000000a'),
  ('20000000-0000-4000-a000-00000000000b', '10000000-0000-4000-a000-00000000000a', 'Beta Workspace', 'beta',
   'Second workspace in the same organization.', null, null, '00000000-0000-4000-a000-00000000000a'),
  ('20000000-0000-4000-a000-00000000000c', '10000000-0000-4000-a000-00000000000b', 'Gamma Workspace', 'gamma',
   'Workspace in an unrelated organization.', 'https://gamma.example.test', 'gamma.example.test', '00000000-0000-4000-a000-00000000000c');
