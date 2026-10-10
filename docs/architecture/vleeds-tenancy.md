# Vleeds — Tenancy & Authorization Architecture

Status: implemented in P0-E1-S1 · Migration: `supabase/migrations/20261007000000_tenancy_foundation.sql`

## 1. Model

```
auth.users ──< memberships >── organizations ──< workspaces ──< (future) workspace-owned records
                 role: owner | admin | member
```

| Concept | Meaning |
| --- | --- |
| **Organization** | The tenant boundary. Billing, ownership and people live here. Unrelated businesses are separate organizations. |
| **Membership** | `(organization_id, user_id, role)`. The *only* source of access. One row per user per organization. |
| **Workspace** | One business/brand being prospected for, owned by one organization. Its business profile (name, domain, logo, description, settings) is data. |
| **Workspace-owned record** | Every future prospecting record (companies, contacts, campaigns, …) carries a non-null `workspace_id` and inherits access from it. |

Access rule: **a user can access a workspace iff they have a membership in the workspace's organization.** P0 has no per-workspace restriction inside an organization (see §9 for the planned extension).

## 2. Roles

| Capability | owner | admin | member | non-member |
| --- | :-: | :-: | :-: | :-: |
| Read organization, its workspaces, its memberships | ✓ | ✓ | ✓ | ✗ |
| Rename organization | ✓ | ✓ | ✗ | ✗ |
| Create / update / archive workspaces | ✓ | ✓ | ✗ | ✗ |
| Add / change / remove **non-owner** memberships | ✓ | ✓ | ✗ | ✗ |
| Add / change / remove **owner** memberships | ✓ | ✗ | ✗ | ✗ |
| Leave the organization | ✓¹ | ✓ | ✓ | — |
| Delete organization or workspace | ✗ (not in P0) | ✗ | ✗ | ✗ |

¹ The last owner cannot leave or demote themselves (`private.protect_last_owner` trigger).

Any authenticated user may create a new organization through `public.create_organization(name, slug)`, which atomically creates it and makes them its owner. Public sign-up is disabled, so authenticated users are invited users.

## 3. Defense in depth

Authorization is enforced in the database. Application layers add UX and earlier failure, never trust.

| Layer | Mechanism | Purpose |
| --- | --- | --- |
| 1. Postgres privileges | `anon` has **no** grants. `authenticated` has only column-level grants (e.g. `UPDATE (name, slug)` on organizations; no `UPDATE` on `organization_id`/`user_id`/`created_by`). Local `auto_expose_new_tables = false`. | Deny by default; tenant keys and audit columns are unwritable through the API. |
| 2. Row Level Security | Enabled on every public table. Policies call `private.is_org_member`, `private.has_org_role`, `private.is_workspace_member`. | Row-level tenant isolation, including for reads that "guess" ids. |
| 3. Private helpers | `SECURITY DEFINER`, `search_path = ''`, in schema `private` (not exposed by the Data API), `EXECUTE` revoked from `public`/`anon`. | Avoids recursive RLS on `memberships`; not callable as RPC. |
| 4. Integrity triggers | `prevent_tenant_key_change` makes `organization_id`, `user_id`, `created_by` immutable; `protect_last_owner`. | A row can never be moved between tenants, even by a user who administers both. |
| 5. Data Access Layer | `src/lib/dal/` (`core`, `workspaces`, `icp-profiles`; import from `@/lib/dal` only): verifies the user with `auth.getUser()`, queries with the user-scoped client, returns narrow DTOs, React-`cache`d reads, typed failure reasons from mutations. | One choke point for reads and writes; no raw rows, sessions or DB error messages reach Client Components. |
| 6. Route/page checks | Workspace layout **and** every section page call `getWorkspace(id)`. Not found and forbidden both render 404. | Pages self-authorize (layouts don't re-render on navigation); no workspace-id probing. |
| 7. Proxy (`src/proxy.ts`) | Refreshes the session cookie; redirects unauthenticated requests to `/login`. | UX only. Explicitly *not* relied on for authorization. |

## 4. Credentials & secrets

- The browser receives **no Supabase credentials at all** in P0: there is no browser Supabase client. All reads and writes run in Server Components, Server Actions and Route Handlers. (Verified: zero browser requests to Supabase; see the report.)
- The app uses only the **publishable/anon key** plus the user's session cookie, so every query runs as `authenticated` under RLS.
- There is exactly **one service-role code path** (P1-E7): `src/lib/supabase/trusted-score-writer.ts`.
  - It starts with `import "server-only"`, reads `SUPABASE_SERVICE_ROLE_KEY` (never `NEXT_PUBLIC_`), keeps its client private, and calls only `public.save_lead_score_trusted`.
  - That function is executable by `service_role` alone and still verifies the acting user's membership, passed by the server action from the verified session.
  - Unit tests assert that this module is the only reader of the key, and that only the scoring DAL and the Today actions import it.
  - The bundle check fails if the key name or the writer reaches the browser.
  - Any further service-role path (e.g. a provider webhook) must follow the same rules and needs its own approval.
- `src/lib/env.ts` refuses to start if a secret or service-role key is put in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `npm run check:bundle` scans `.next/static` for secret keys, service-role JWTs, connection strings, server-only env var names and the literal values of every non-public variable in `.env*`.
- Future provider credentials go in Supabase Vault, referenced from `provider_connections`; end-user roles cannot read them (see the data-model doc).

## 5. Workspace routing & the switcher

- Every workspace URL is `/w/{workspaceId}/{section}`. The active workspace is explicit in the URL, so it is shareable, bookmarkable, and re-authorized on each request. No "current workspace" is stored in server state.
- The id in the URL is a **lookup key, not a permission**: `getWorkspace(id)` returns the row only if RLS does. Unknown, malformed and foreign ids all produce the same 404.
- The switcher lists `listWorkspaces()`, which is the RLS-filtered set, grouped by organization, so a user in several organizations sees each one's workspaces and nothing else. Switching preserves the current section (`/w/A/leads` → `/w/B/leads`).
- The `vleeds_last_workspace` cookie (httpOnly, SameSite=Lax) only chooses where `/` lands; it is checked against the RLS-filtered list and ignored if stale.
- Data for a workspace is fetched per request, keyed by the workspace id, using the user's own session. No cross-request server cache holds tenant data in P0. If caching is added, cache keys must include the user id and workspace id, and the authorizing lookup must run outside the cache.

## 6. Authentication

- Supabase Auth, email + password. `enable_signup = false` (invitation only); minimum password length 12; secure password change on.
- Sign-in and sign-out are Server Actions, which get Next.js origin checks. Sign-in errors are generic ("Incorrect email or password") to avoid account enumeration. Post-login redirects accept only same-origin relative paths (`safeNextPath`).
- Server code always uses `auth.getUser()` (validated with the Auth server), never the unverified `getSession()`.

## 7. Testing strategy

`tests/db/tenancy.test.ts` (36 tests) runs every attempt **as the API would**: inside a transaction, with `SET LOCAL ROLE anon|authenticated|service_role` and `request.jwt.claims` set. It then re-checks the outcome as the database owner. Coverage:

- catalog: RLS enabled on every public table; no `anon` privileges; private helpers not executable by `anon`; every `SECURITY DEFINER` function pins `search_path`
- anon: cannot read any table, call `create_organization`, or insert
- cross-org reads: by id, by foreign key, via joins, via helper functions; outsider sees nothing; multi-org user sees exactly the union
- cross-org writes: insert/update/delete across orgs; self-join foreign orgs; move a workspace or membership between orgs (even as owner of both); spoof `created_by`; direct org insert; deletes
- roles: member vs admin vs owner capabilities; admin cannot create/modify/remove owners; last-owner protection
- service role bypasses RLS (documented as server-only)

`tests/db/icp-profiles.test.ts` (41 tests, P0-E1-S2) applies the same method to `icp_profiles`: reads by role and across orgs/workspaces, creates/updates/archival by owner/admin/member/foreign/outsider/anon, immutable `workspace_id`/`created_by`/`revision`, no deletes, one active default per workspace, and the jsonb CHECK constraints.

`tests/db/lead-core.test.ts` (40 tests, P1-E1) covers companies, contacts, lead_sources, lead_scores and suppression_records. It checks:
- reads by role and across organizations; members' operational writes; foreign-workspace inserts refused
- composite-FK workspace consistency (even for a member of both workspaces)
- immutable keys; workspace-local domain uniqueness and email matching; archived-row behaviour
- append-only evidence, read-only scores, and owner/admin-only lifting of restrictions

A mutation run (8 deliberate breaks) made 8 tests fail.

Drivers: **PGlite** (embedded Postgres + `tests/db/support/supabase-shim.sql`, which mirrors Supabase's roles, `auth.uid()` and default grants) runs anywhere; setting `SUPABASE_TEST_DB_URL` runs the identical suite against a real Supabase Postgres. A mutation run (leaky policy + RLS disabled) made 12 tests fail, confirming that the suite detects regressions.

## 8. Checklist: adding a tenant-owned table

1. `workspace_id uuid not null references public.workspaces(id) on delete cascade` (or `organization_id` for org-scoped data). Index it.
2. `alter table … enable row level security;` with no exceptions.
3. Policies for `authenticated` only, using `private.is_workspace_member(workspace_id)` for reads and `private.has_workspace_role(workspace_id, roles)` where writes are role-restricted (or, for large tables, `workspace_id in (select private.my_workspace_ids())`; see the data-model doc).
4. Explicit column-level `grant`s; never `grant all` to `authenticated`; nothing to `anon`.
5. `prevent_tenant_key_change('workspace_id', …)` trigger.
6. Child rows reference parents with composite FKs `(workspace_id, parent_id) → parent(workspace_id, id)` so a row can never point into another workspace.
7. Extend `tests/db` with cross-workspace and cross-org read/write attempts for the table.
8. Regenerate `src/lib/supabase/database.types.ts`.

## 9. Architecture decisions

| # | Decision | Alternatives considered | Rationale |
| --- | --- | --- | --- |
| AD-1 | Organization is the tenant; workspace is a business inside it | Workspace-as-tenant | Lets one team run several businesses (internal use) while unrelated businesses stay isolated by organization. |
| AD-2 | Access via org membership; no per-workspace ACL in P0 | `workspace_memberships` now | Simpler and sufficient now. Can be added later as an *additional* restriction inside `private.is_workspace_member` without changing any table policy. |
| AD-3 | Authorization helpers are `SECURITY DEFINER` in an unexposed `private` schema | Inline subqueries on memberships | Avoids RLS recursion, keeps one definition of access, and is not callable via RPC. |
| AD-4 | Tenant keys immutable (trigger + no column grant) | Policy `WITH CHECK` only | `WITH CHECK` would allow moving rows between two orgs the caller administers. |
| AD-5 | No browser Supabase client; all data access on the server | Browser client with anon key | Smallest attack surface; no tokens/keys in client JS; one authorization path (DAL). Realtime can opt in later. |
| AD-6 | Workspace id in the URL (`/w/{id}/…`) | Session/cookie "current workspace" | Explicit, shareable, re-authorized per request; switching can't leave stale cross-tenant state. |
| AD-7 | 404 for both missing and forbidden workspaces | 403 for forbidden | Prevents enumeration of workspace ids. |
| AD-8 | Orgs/workspaces not deletable in P0 (`archived_at`) | Cascading delete | Irreversible tenant-wide deletes need a deliberate, audited flow. |
| AD-9 | DB tests run on PGlite *and* real Supabase | pgTAP only | Runs on machines without Docker and in plain CI; same SQL either way. |
| AD-10 | Keep Next.js 16 Cache Components + Partial Prefetching | Disable for simplicity | Framework default. Session reads sit behind `<Suspense>`, and `createSupabaseServerClient` calls `connection()` so Supabase never runs inside a prerender. |
