import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Test database drivers.
 *
 * - `postgres`: a real Supabase Postgres (local `supabase start` stack or a
 *   disposable dev project). Selected when SUPABASE_TEST_DB_URL is set.
 *   Migrations are expected to be applied already (`supabase db reset`).
 * - `pglite`: embedded Postgres. Applies tests/db/support/supabase-shim.sql and
 *   then every file in supabase/migrations in order, so the exact production
 *   migrations are exercised with no external services.
 */

export type QueryResult<T> = { rows: T[]; affectedRows: number };

export interface Db {
  kind: "pglite" | "postgres";
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const ROOT = path.resolve(__dirname, "../../..");

async function readMigrations(): Promise<string[]> {
  const dir = path.join(ROOT, "supabase", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(files.map((f) => readFile(path.join(dir, f), "utf8")));
}

async function openPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create();
  await pg.exec(await readFile(path.join(__dirname, "supabase-shim.sql"), "utf8"));
  for (const sql of await readMigrations()) {
    await pg.exec(sql);
  }
  return {
    kind: "pglite",
    async query<T>(sql: string, params?: unknown[]) {
      const res = await pg.query<T>(sql, params as unknown[] | undefined);
      return { rows: res.rows, affectedRows: res.affectedRows ?? 0 };
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async close() {
      await pg.close();
    },
  };
}

async function openPostgres(connectionString: string): Promise<Db> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString });
  await client.connect();
  return {
    kind: "postgres",
    async query<T>(sql: string, params?: unknown[]) {
      const res = await client.query(sql, params);
      return { rows: res.rows as T[], affectedRows: res.rowCount ?? 0 };
    },
    async exec(sql) {
      await client.query(sql);
    },
    async close() {
      await client.end();
    },
  };
}

export async function openTestDb(): Promise<Db> {
  const url = process.env.SUPABASE_TEST_DB_URL;
  return url ? openPostgres(url) : openPglite();
}

// -----------------------------------------------------------------------------
// Acting as an API role
// -----------------------------------------------------------------------------

export type Actor = { kind: "anon" } | { kind: "user"; id: string } | { kind: "service" };

export type Attempt<T> = { ok: true; rows: T[]; affectedRows: number } | { ok: false; code: string; message: string };

export interface Session {
  /** Runs a statement inside a savepoint; failures are captured, not thrown. */
  attempt<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Attempt<T>>;
  /** Runs a statement and throws on failure. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Executes `fn` exactly as PostgREST would for the given actor: inside a
 * transaction, with `SET LOCAL ROLE` and the request JWT claims GUC. The
 * transaction is ALWAYS rolled back, so every block starts from the same
 * fixture state and permitted writes never leak between tests.
 */
export async function as<T>(db: Db, actor: Actor, fn: (s: Session) => Promise<T>): Promise<T> {
  const role = actor.kind === "anon" ? "anon" : actor.kind === "service" ? "service_role" : "authenticated";
  const claims =
    actor.kind === "user" ? { sub: actor.id, role: "authenticated", aud: "authenticated" } : { role };

  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(`set local role ${role}`);

    let n = 0;
    const session: Session = {
      async attempt<R>(sql: string, params?: unknown[]): Promise<Attempt<R>> {
        const sp = `sp_${++n}`;
        await db.exec(`savepoint ${sp}`);
        try {
          const res = await db.query<R>(sql, params);
          await db.exec(`release savepoint ${sp}`);
          return { ok: true, rows: res.rows, affectedRows: res.affectedRows };
        } catch (err) {
          await db.exec(`rollback to savepoint ${sp}`);
          const e = err as { code?: string; message?: string };
          return { ok: false, code: e.code ?? "unknown", message: e.message ?? String(err) };
        }
      },
      async query<R>(sql: string, params?: unknown[]) {
        return (await db.query<R>(sql, params)).rows;
      },
    };

    return await fn(session);
  } finally {
    await db.exec("rollback");
  }
}

// -----------------------------------------------------------------------------
// Fixtures (created as the database owner, i.e. outside RLS)
// -----------------------------------------------------------------------------

export type Fixture = ReturnType<typeof makeFixtureIds>;

function makeFixtureIds() {
  const tag = randomUUID().slice(0, 8);
  return {
    tag,
    users: {
      ownerA: randomUUID(),
      adminA: randomUUID(),
      memberA: randomUUID(),
      ownerB: randomUUID(),
      multi: randomUUID(), // member of A and B
      outsider: randomUUID(), // authenticated, no memberships
    },
    orgs: { a: randomUUID(), b: randomUUID() },
    workspaces: { a1: randomUUID(), a2: randomUUID(), b1: randomUUID() },
  };
}

export async function createFixture(db: Db): Promise<Fixture> {
  const f = makeFixtureIds();
  const u = f.users;

  for (const [name, id] of Object.entries(u)) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${name}.${f.tag}@example.test`]);
  }

  await db.query(
    `insert into public.organizations (id, name, slug, created_by) values
       ($1, 'Test Org A', $3, $4),
       ($2, 'Test Org B', $5, $6)`,
    [f.orgs.a, f.orgs.b, `test-org-a-${f.tag}`, u.ownerA, `test-org-b-${f.tag}`, u.ownerB],
  );

  await db.query(
    `insert into public.memberships (organization_id, user_id, role) values
       ($1, $3, 'owner'), ($1, $4, 'admin'), ($1, $5, 'member'), ($1, $7, 'member'),
       ($2, $6, 'owner'), ($2, $7, 'member')`,
    [f.orgs.a, f.orgs.b, u.ownerA, u.adminA, u.memberA, u.ownerB, u.multi],
  );

  await db.query(
    `insert into public.workspaces (id, organization_id, name, slug, created_by) values
       ($1, $4, 'Workspace A1', 'a1', $6),
       ($2, $4, 'Workspace A2', 'a2', $6),
       ($3, $5, 'Workspace B1', 'b1', $7)`,
    [f.workspaces.a1, f.workspaces.a2, f.workspaces.b1, f.orgs.a, f.orgs.b, u.ownerA, u.ownerB],
  );

  return f;
}

export async function destroyFixture(db: Db, f: Fixture): Promise<void> {
  await db.query("delete from public.organizations where id = any($1::uuid[])", [Object.values(f.orgs)]);
  await db.query("delete from auth.users where id = any($1::uuid[])", [Object.values(f.users)]);
}
