# Vleeds

A lightweight, business-agnostic lead-discovery and prospecting workspace.
Discover companies → identify decision-makers → qualify → contact → record the outcome → follow up.

- Product principles: [docs/product/vleeds-product-principles.md](docs/product/vleeds-product-principles.md)
- Tenancy & security: [docs/architecture/vleeds-tenancy.md](docs/architecture/vleeds-tenancy.md)
- Data model & plan: [docs/architecture/vleeds-data-model.md](docs/architecture/vleeds-data-model.md)
- Latest story report: [docs/reports/P0-E1-S1-vleeds-foundation.txt](docs/reports/P0-E1-S1-vleeds-foundation.txt)

Stack: Next.js 16 (App Router, Cache Components) · TypeScript · Supabase (Postgres, Auth, RLS) · Tailwind CSS 4 · Vitest. Vercel-compatible.

## Prerequisites

- Node.js ≥ 22 (developed on 24 LTS)
- Docker Desktop, for the local Supabase stack. On Windows this needs WSL2 **and hardware virtualization enabled in the BIOS/UEFI** (AMD-V/SVM or Intel VT-x). Check *Task Manager → Performance → CPU → Virtualization: Enabled*.

## Local setup

```bash
npm install
npx supabase start          # first run downloads images; prints API URL + keys
npx supabase db reset       # applies migrations + supabase/seed.sql
cp .env.example .env.local  # then paste the "Publishable key" from `npx supabase status`
npm run dev                 # http://localhost:3000
```

Email/password sign-in works for existing users while public signup stays disabled. In `supabase/config.toml`, `[auth] enable_signup = false` blocks self-service signup. `[auth.email] enable_signup` must stay `true`: despite its name, it switches the email provider itself on or off (`GOTRUE_EXTERNAL_EMAIL_ENABLED`).

Local development login (not seeded, starts with no workspace, so it goes through onboarding): add `SUPABASE_SERVICE_ROLE_KEY` (from `npx supabase status`), `VLEEDS_LOCAL_TEST_EMAIL` and `VLEEDS_LOCAL_TEST_PASSWORD` (≥ 12 chars) to `.env.local`, then:

```bash
node --env-file=.env.local scripts/dev/create-local-test-user.mjs
```

The script uses the Auth Admin API, is idempotent, refuses any non-loopback Supabase URL, and finishes by signing in with the publishable key.

Seeded users (password `vleeds-dev-password`, local only):

| Email | Access |
| --- | --- |
| `owner.a@example.test` | owner of Example Org A (Alpha, Beta) |
| `member.a@example.test` | member of Example Org A |
| `owner.b@example.test` | owner of Example Org B (Gamma) |
| `multi@example.test` | admin of A + member of B (switcher across orgs) |
| `new@example.test` | no memberships (onboarding) |

Public sign-up is disabled. Create users in Supabase Studio (http://127.0.0.1:54323).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run verify` | lint → typecheck → all tests → build → client-bundle secret scan (the quality gate) |
| `npm run test:db` | Tenant-isolation suite. Uses embedded Postgres (PGlite) by default; set `SUPABASE_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` to run it against the local Supabase stack. |
| `npm run test:unit` | Unit tests, including the business-agnostic guard |
| `npm run check:bundle` | Fails if secrets / service-role keys / server env names appear in `.next/static` |
| `npm run db:types` | Regenerates `src/lib/supabase/database.types.ts` from the local DB (stack must be running) |

### Database types

`src/lib/supabase/database.types.ts` is **generated** by `npm run db:types` (`supabase gen types typescript --local --schema public`). Never edit it by hand: after a migration, run `npm run db:reset` then `npm run db:types`, commit the result, and `npm run typecheck` must pass with no touch-up.

Application-facing aliases live outside the generated file, derived from `Database`, in `src/lib/supabase/app-types.ts` (e.g. `MembershipRole`, and result-row types for SQL functions). The generator cannot see SQL function nullability, so it reports every function argument and `RETURNS TABLE` column as non-null:

- Optional arguments are `DEFAULT NULL` in SQL; callers omit them (`?? undefined`) instead of sending `null`.
- Result columns that can be NULL are widened back with `WithNullable` in `app-types.ts`; DAL code annotates RPC results with those row types.
- The single RPC whose *required* arguments accept NULL (`save_lead_score_trusted`: `p_score`/`p_grade` for excluded results) gets a narrow schema overlay on its private client in `src/lib/supabase/trusted-score-writer.ts`.

Real-stack verification: on 2026-10-11 `supabase start`, `supabase db reset` (all migrations through P1-E7) and the full DB suite against real Supabase Postgres (219/219) passed.

### Design system

The canonical UI references in `docs/design/canonical/` are authoritative. Tokens are documented in `docs/design/vleeds-design-tokens.md`.

### Development-only UI fixtures

`/ui-fixtures/today` renders the populated lead table and detail drawer from invented data so the canonical design can be reviewed before the lead domain exists. The route exists only in builds made with `VLEEDS_UI_FIXTURES=1` (it uses the `page.fixture.tsx` extension). It is refused for Vercel production, and `npm run check:bundle` fails if fixture code appears in a normal build.

### Real-stack dev navigation check

`scripts/ui-review/review-dev-navigation.mjs` runs against `npm run dev` and the real local stack (credentials from `.env.local`). It checks client-side navigation through every workspace section with no Next.js instant-navigation errors, checks that every Settings sheet opens and stays open, and covers refresh, the workspace switcher, the company drawer, sign-out and the signed-out redirect. Every page segment under `src/app/w/[workspaceId]` needs its own `loading.tsx`; `tests/unit/navigation-boundaries.test.ts` enforces this.

### UI review without Docker

`scripts/ui-review/mock-supabase.mjs` imitates the few Auth/REST endpoints the shell calls, so screens can be reviewed on machines that can't run Docker. It is **not** a security boundary and is never used by the RLS tests. See the header of `scripts/ui-review/review.mjs`. Since P0-E1-S2 it also accepts the Settings writes in memory; `scripts/ui-review/review-settings.mjs` walks a fresh workspace through business-profile and ICP configuration (restart the mock first so the workspace starts unconfigured).

## Rules that matter

- No business, industry, geography, title, scoring rule, lead source or provider may be hard-coded. Businesses are workspaces (data).
- Every tenant-owned table: `workspace_id`, RLS on, explicit grants, immutable tenant key, adversarial tests. See the checklist in the tenancy doc.
- Secrets never use the `NEXT_PUBLIC_` prefix and are only read from modules that `import "server-only"`.
