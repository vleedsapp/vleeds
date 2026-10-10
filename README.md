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
| `npm run db:types` | Regenerates `src/lib/supabase/database.types.ts` from the local DB |

### Design system

The canonical UI references in `docs/design/canonical/` are authoritative. Tokens are documented in `docs/design/vleeds-design-tokens.md`.

### Development-only UI fixtures

`/ui-fixtures/today` renders the populated lead table and detail drawer from invented data so the canonical design can be reviewed before the lead domain exists. The route exists only in builds made with `VLEEDS_UI_FIXTURES=1` (it uses the `page.fixture.tsx` extension). It is refused for Vercel production, and `npm run check:bundle` fails if fixture code appears in a normal build.

### UI review without Docker

`scripts/ui-review/mock-supabase.mjs` imitates the few Auth/REST endpoints the shell calls, so screens can be reviewed on machines that can't run Docker. It is **not** a security boundary and is never used by the RLS tests. See the header of `scripts/ui-review/review.mjs`. Since P0-E1-S2 it also accepts the Settings writes in memory; `scripts/ui-review/review-settings.mjs` walks a fresh workspace through business-profile and ICP configuration (restart the mock first so the workspace starts unconfigured).

## Rules that matter

- No business, industry, geography, title, scoring rule, lead source or provider may be hard-coded. Businesses are workspaces (data).
- Every tenant-owned table: `workspace_id`, RLS on, explicit grants, immutable tenant key, adversarial tests. See the checklist in the tenancy doc.
- Secrets never use the `NEXT_PUBLIC_` prefix and are only read from modules that `import "server-only"`.
