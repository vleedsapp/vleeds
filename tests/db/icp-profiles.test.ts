import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createFixture, destroyFixture, openTestDb, type Db, type Fixture } from "./support/db";

/**
 * Adversarial tests for public.icp_profiles (P0-E1-S2).
 *
 * Same method as tenancy.test.ts: every attempt runs as the Data API would
 * (SET LOCAL ROLE + request.jwt.claims, always rolled back), and denied
 * writes are re-checked as the database owner.
 *
 * Fixture: Org A (ownerA, adminA, memberA, multi) with workspaces A1, A2;
 * Org B (ownerB, multi) with workspace B1; Org C (no fixture user except
 * ownerC) with workspace C1. A1, B1 and C1 each have a default profile;
 * A1 also has a non-default "secondary" profile. A2 has none.
 */

const DENIED = "42501";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

let db: Db;
let f: Fixture;
const orgC = randomUUID();
const ownerC = randomUUID();
const wsC1 = randomUUID();
const icp = { a1: randomUUID(), a1Secondary: randomUUID(), b1: randomUUID(), c1: randomUUID() };

const user = (id: string) => ({ kind: "user" as const, id });

const SCORING = JSON.stringify({
  thresholds: { a: 75, b: 50 },
  categoryWeights: { company_fit: 40, geography_fit: 20, decision_maker_fit: 20, buying_signal_fit: 20 },
});

beforeAll(async () => {
  db = await openTestDb();
  f = await createFixture(db);
  await db.query("insert into auth.users (id, email) values ($1, $2)", [ownerC, `ownerC.${f.tag}@example.test`]);
  await db.query("insert into public.organizations (id, name, slug, created_by) values ($1, 'Test Org C', $2, $3)", [
    orgC,
    `test-org-c-${f.tag}`,
    ownerC,
  ]);
  await db.query("insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [orgC, ownerC]);
  await db.query(
    "insert into public.workspaces (id, organization_id, name, slug, created_by) values ($1, $2, 'Workspace C1', 'c1', $3)",
    [wsC1, orgC, ownerC],
  );
  await db.query(
    `insert into public.icp_profiles (id, workspace_id, name, is_default, scoring_model, created_by) values
       ($1, $5, 'Profile A1', true, $8::jsonb, $9),
       ($2, $5, 'Secondary A1', false, null, $9),
       ($3, $6, 'Profile B1', true, null, $10),
       ($4, $7, 'Profile C1', true, null, $11)`,
    [icp.a1, icp.a1Secondary, icp.b1, icp.c1, f.workspaces.a1, f.workspaces.b1, wsC1, SCORING, f.users.ownerA, f.users.ownerB, ownerC],
  );
}, 180_000);

afterAll(async () => {
  if (db && f) {
    await db.query("delete from public.organizations where id = $1", [orgC]);
    await db.query("delete from auth.users where id = $1", [ownerC]);
    await destroyFixture(db, f);
  }
  await db?.close();
});

async function ownerView<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

const insertSql = (cols = "") =>
  `insert into public.icp_profiles (workspace_id, name, is_default${cols}) values ($1, $2, $3${cols ? ", $4" : ""}) returning id, created_by, revision`;

// -----------------------------------------------------------------------------
describe("icp_profiles: reads", () => {
  it.each(["ownerA", "adminA", "memberA"] as const)("%s can read their workspace's profiles", async (who) => {
    await as(db, user(f.users[who]), async (s) => {
      const rows = await s.query<{ id: string }>("select id from public.icp_profiles where workspace_id = $1 order by name", [
        f.workspaces.a1,
      ]);
      expect(rows.map((r) => r.id)).toEqual([icp.a1, icp.a1Secondary]);
    });
  });

  it("cannot read another organization's profile, by id or by workspace", async () => {
    await as(db, user(f.users.ownerB), async (s) => {
      expect(await s.query("select * from public.icp_profiles where id = $1", [icp.a1])).toEqual([]);
      expect(await s.query("select * from public.icp_profiles where workspace_id = $1", [f.workspaces.a1])).toEqual([]);
      const all = await s.query<{ id: string }>("select id from public.icp_profiles");
      expect(all.map((r) => r.id)).toEqual([icp.b1]);
    });
  });

  it("a user in Org A cannot read Org B's or Org C's profiles", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const rows = await s.query<{ id: string }>("select id from public.icp_profiles where id = any($1::uuid[])", [
        [icp.b1, icp.c1],
      ]);
      expect(rows).toEqual([]);
    });
  });

  it("a multi-org user sees exactly the profiles of workspaces they belong to", async () => {
    await as(db, user(f.users.multi), async (s) => {
      const rows = await s.query<{ id: string }>("select id from public.icp_profiles");
      expect(new Set(rows.map((r) => r.id))).toEqual(new Set([icp.a1, icp.a1Secondary, icp.b1]));
    });
  });

  it("an authenticated user with no memberships sees nothing", async () => {
    await as(db, user(f.users.outsider), async (s) => {
      expect(await s.query("select * from public.icp_profiles")).toEqual([]);
    });
  });

  it("anon can neither read nor insert", async () => {
    await as(db, { kind: "anon" }, async (s) => {
      const read = await s.attempt("select * from public.icp_profiles");
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.code).toBe(DENIED);
      const ins = await s.attempt(insertSql(), [f.workspaces.a2, "Anon", false]);
      expect(ins.ok).toBe(false);
    });
  });

  it("the role helper reports no write access for members or foreign workspaces", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const [r] = await s.query<{ own: boolean; foreign: boolean }>(
        `select private.has_workspace_role($1, array['owner','admin']::public.membership_role[]) as own,
                private.has_workspace_role($2, array['owner','admin','member']::public.membership_role[]) as foreign`,
        [f.workspaces.a1, f.workspaces.b1],
      );
      expect(r).toEqual({ own: false, foreign: false });
    });
  });
});

// -----------------------------------------------------------------------------
describe("icp_profiles: creates", () => {
  it.each(["ownerA", "adminA"] as const)("%s can create a profile; created_by is the caller and revision starts at 1", async (who) => {
    await as(db, user(f.users[who]), async (s) => {
      const r = await s.attempt<{ created_by: string; revision: number }>(insertSql(), [f.workspaces.a2, "New", true]);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.rows[0]).toMatchObject({ created_by: f.users[who], revision: 1 });
    });
  });

  it("a member cannot create a profile", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt(insertSql(), [f.workspaces.a2, "Nope", false]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(DENIED);
    });
    expect(await ownerView("select 1 from public.icp_profiles where workspace_id = $1", [f.workspaces.a2])).toEqual([]);
  });

  it("cannot create a profile in another organization's workspace", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt(insertSql(), [f.workspaces.b1, "Injected", false]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(DENIED);
    });
    expect(await ownerView("select 1 from public.icp_profiles where name = 'Injected'")).toEqual([]);
  });

  it("a multi-org user cannot create where they are only a member", async () => {
    await as(db, user(f.users.multi), async (s) => {
      const r = await s.attempt(insertSql(), [f.workspaces.b1, "Multi", false]);
      expect(r.ok).toBe(false);
    });
  });

  it("an outsider cannot create a profile anywhere", async () => {
    await as(db, user(f.users.outsider), async (s) => {
      for (const ws of [f.workspaces.a1, f.workspaces.a2, f.workspaces.b1]) {
        const r = await s.attempt(insertSql(), [ws, "Outsider", false]);
        expect(r.ok).toBe(false);
      }
    });
  });

  it("cannot spoof created_by or set revision/id-independent audit columns on insert", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const spoof = await s.attempt(insertSql(", created_by"), [f.workspaces.a2, "Spoof", false, f.users.ownerB]);
      expect(spoof.ok).toBe(false);
      if (!spoof.ok) expect(spoof.code).toBe(DENIED);
      const rev = await s.attempt(insertSql(", revision"), [f.workspaces.a2, "Rev", false, 99]);
      expect(rev.ok).toBe(false);
      if (!rev.ok) expect(rev.code).toBe(DENIED);
    });
  });
});

// -----------------------------------------------------------------------------
describe("icp_profiles: updates", () => {
  it.each(["ownerA", "adminA"] as const)("%s can update; revision increments", async (who) => {
    await as(db, user(f.users[who]), async (s) => {
      const r = await s.attempt<{ revision: number }>(
        "update public.icp_profiles set target_geographies = '[]'::jsonb where id = $1 returning revision",
        [icp.a1],
      );
      expect(r.ok && r.rows[0].revision).toBe(2);
    });
  });

  it("an update that changes nothing does not bump the revision", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const [r] = await s.query<{ revision: number }>(
        "update public.icp_profiles set name = name where id = $1 returning revision",
        [icp.a1],
      );
      expect(r.revision).toBe(1);
    });
  });

  it("a member cannot update (zero rows) and nothing changes", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt("update public.icp_profiles set name = 'pwned' where id = $1", [icp.a1]);
      expect(r.ok && r.affectedRows).toBe(0);
    });
    const [row] = await ownerView<{ name: string; revision: number }>("select name, revision from public.icp_profiles where id = $1", [icp.a1]);
    expect(row).toEqual({ name: "Profile A1", revision: 1 });
  });

  it("a foreign user cannot update (zero rows), even with the exact id", async () => {
    await as(db, user(f.users.ownerB), async (s) => {
      const r = await s.attempt("update public.icp_profiles set name = 'pwned' where id = $1", [icp.a1]);
      expect(r.ok && r.affectedRows).toBe(0);
    });
    const [row] = await ownerView<{ name: string }>("select name from public.icp_profiles where id = $1", [icp.a1]);
    expect(row.name).toBe("Profile A1");
  });

  it("workspace_id cannot be changed, not even within the same organization or by an owner of both", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      for (const target of [f.workspaces.a2, f.workspaces.b1]) {
        const r = await s.attempt("update public.icp_profiles set workspace_id = $1 where id = $2", [target, icp.a1]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe(DENIED);
      }
    });
    // Even the table owner (no column-grant restriction) hits the immutability trigger.
    await expect(db.query("update public.icp_profiles set workspace_id = $1 where id = $2", [f.workspaces.a2, icp.a1])).rejects.toThrow(/immutable/);
    const [row] = await ownerView<{ workspace_id: string }>("select workspace_id from public.icp_profiles where id = $1", [icp.a1]);
    expect(row.workspace_id).toBe(f.workspaces.a1);
  });

  it("created_by and revision cannot be repointed or forged", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const by = await s.attempt("update public.icp_profiles set created_by = $1 where id = $2", [f.users.ownerB, icp.a1]);
      expect(by.ok).toBe(false);
      if (!by.ok) expect(by.code).toBe(DENIED);
      const rev = await s.attempt("update public.icp_profiles set revision = 1000 where id = $1", [icp.a1]);
      expect(rev.ok).toBe(false);
      if (!rev.ok) expect(rev.code).toBe(DENIED);
    });
    await expect(db.query("update public.icp_profiles set created_by = $1 where id = $2", [f.users.ownerB, icp.a1])).rejects.toThrow(/immutable/);
  });

  it("an optimistic-concurrency update with a stale revision changes nothing", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      await s.query("update public.icp_profiles set name = 'First' where id = $1 and revision = 1", [icp.a1]);
      const stale = await s.attempt("update public.icp_profiles set name = 'Second' where id = $1 and revision = 1", [icp.a1]);
      expect(stale.ok && stale.affectedRows).toBe(0);
      const [row] = await s.query<{ name: string; revision: number }>("select name, revision from public.icp_profiles where id = $1", [icp.a1]);
      expect(row).toEqual({ name: "First", revision: 2 });
    });
  });
});

// -----------------------------------------------------------------------------
describe("icp_profiles: archival", () => {
  it.each(["ownerA", "adminA"] as const)("%s can archive a non-default profile", async (who) => {
    await as(db, user(f.users[who]), async (s) => {
      const r = await s.attempt("update public.icp_profiles set archived_at = now() where id = $1", [icp.a1Secondary]);
      expect(r.ok && r.affectedRows).toBe(1);
    });
  });

  it("the default profile cannot be archived while it is still the default", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt("update public.icp_profiles set archived_at = now() where id = $1", [icp.a1]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(CHECK_VIOLATION);
      const ok = await s.attempt("update public.icp_profiles set archived_at = now(), is_default = false where id = $1", [icp.a1]);
      expect(ok.ok && ok.affectedRows).toBe(1);
    });
  });

  it("a member cannot archive", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt("update public.icp_profiles set archived_at = now() where id = $1", [icp.a1Secondary]);
      expect(r.ok && r.affectedRows).toBe(0);
    });
    const [row] = await ownerView<{ archived_at: string | null }>("select archived_at from public.icp_profiles where id = $1", [icp.a1Secondary]);
    expect(row.archived_at).toBeNull();
  });

  it("a foreign user cannot archive", async () => {
    await as(db, user(f.users.ownerB), async (s) => {
      const r = await s.attempt("update public.icp_profiles set archived_at = now() where id = $1", [icp.a1Secondary]);
      expect(r.ok && r.affectedRows).toBe(0);
    });
  });

  it("profiles cannot be hard-deleted by anyone through the API", async () => {
    for (const who of [f.users.ownerA, f.users.adminA, f.users.memberA]) {
      await as(db, user(who), async (s) => {
        const r = await s.attempt("delete from public.icp_profiles where id = $1", [icp.a1Secondary]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe(DENIED);
      });
    }
  });
});

// -----------------------------------------------------------------------------
describe("icp_profiles: default profile", () => {
  it("only one active default per workspace", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const second = await s.attempt(insertSql(), [f.workspaces.a1, "Another default", true]);
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.code).toBe(UNIQUE_VIOLATION);
      const promote = await s.attempt("update public.icp_profiles set is_default = true where id = $1", [icp.a1Secondary]);
      expect(promote.ok).toBe(false);
      if (!promote.ok) expect(promote.code).toBe(UNIQUE_VIOLATION);
    });
  });

  it("switching the default works when the old default is cleared first (in one transaction)", async () => {
    await as(db, user(f.users.adminA), async (s) => {
      await s.query("update public.icp_profiles set is_default = false where id = $1", [icp.a1]);
      await s.query("update public.icp_profiles set is_default = true where id = $1", [icp.a1Secondary]);
      const rows = await s.query<{ id: string }>(
        "select id from public.icp_profiles where workspace_id = $1 and is_default and archived_at is null",
        [f.workspaces.a1],
      );
      expect(rows.map((r) => r.id)).toEqual([icp.a1Secondary]);
    });
  });

  it("an archived former default does not block a new default", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      await s.query("update public.icp_profiles set is_default = false, archived_at = now() where id = $1", [icp.a1]);
      const r = await s.attempt(insertSql(), [f.workspaces.a1, "Replacement", true]);
      expect(r.ok).toBe(true);
    });
  });

  it("a default in one workspace never affects another workspace", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      // A2 can get its own default although A1 (same org) and B1 (other org) have one.
      const r = await s.attempt(insertSql(), [f.workspaces.a2, "A2 default", true]);
      expect(r.ok).toBe(true);
      // Clearing A1's default cannot touch B1's.
      await s.query("update public.icp_profiles set is_default = false where is_default");
    });
    const [b1] = await ownerView<{ is_default: boolean }>("select is_default from public.icp_profiles where id = $1", [icp.b1]);
    expect(b1.is_default).toBe(true);
  });
});

// -----------------------------------------------------------------------------
describe("icp_profiles: database constraints", () => {
  const reject = async (sql: string, params: unknown[], code = CHECK_VIOLATION) => {
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt(sql, params);
      expect(r.ok, sql).toBe(false);
      if (!r.ok) expect(r.code, r.message).toBe(code);
    });
  };
  const setCol = (col: string) => `update public.icp_profiles set ${col} = $1::jsonb where id = $2`;

  it("rejects unsupported schema versions", async () => {
    await reject("update public.icp_profiles set schema_version = 2 where id = $1", [icp.a1]);
    await reject("update public.icp_profiles set schema_version = 0 where id = $1", [icp.a1]);
  });

  it("rejects wrong top-level JSON types", async () => {
    await reject(setCol("ideal_customer"), ["[]", icp.a1]);
    await reject(setCol("ideal_customer"), ['"text"', icp.a1]);
    await reject(setCol("target_geographies"), ["{}", icp.a1]);
    await reject(setCol("decision_maker_titles"), ["{}", icp.a1]);
    await reject(setCol("buying_signals"), ["42", icp.a1]);
    await reject(setCol("exclusion_signals"), ['{"a":1}', icp.a1]);
    await reject(setCol("scoring_model"), ["[]", icp.a1]);
  });

  it("rejects oversized lists", async () => {
    const many = JSON.stringify(Array.from({ length: 101 }, () => ({})));
    await reject(setCol("target_geographies"), [many, icp.a1]);
    await reject(setCol("decision_maker_titles"), [JSON.stringify(Array.from({ length: 51 }, () => ({}))), icp.a1]);
  });

  it("rejects impossible grade thresholds", async () => {
    const model = (a: unknown, b: unknown) => JSON.stringify({ thresholds: { a, b }, categoryWeights: {} });
    await reject(setCol("scoring_model"), [model(50, 50), icp.a1]); // A must exceed B
    await reject(setCol("scoring_model"), [model(40, 60), icp.a1]);
    await reject(setCol("scoring_model"), [model(101, 50), icp.a1]); // above 100
    await reject(setCol("scoring_model"), [model(75, 0), icp.a1]); // C would be empty
    await reject(setCol("scoring_model"), [model("75", "50"), icp.a1]); // not numbers
    await reject(setCol("scoring_model"), [JSON.stringify({ categoryWeights: {} }), icp.a1]); // missing
  });

  it("accepts a valid scoring model", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt(setCol("scoring_model"), [SCORING, icp.a1Secondary]);
      expect(r.ok).toBe(true);
    });
  });

  it("rejects an employee range whose minimum exceeds its maximum, or a negative minimum", async () => {
    const ic = (min: number, max: number | null) =>
      JSON.stringify({ industries: [], companySize: { minEmployees: min, maxEmployees: max }, characteristics: [], keywords: [], notes: null });
    await reject(setCol("ideal_customer"), [ic(500, 10), icp.a1]);
    await reject(setCol("ideal_customer"), [ic(-1, null), icp.a1]);
  });

  it("rejects blank names and oversized descriptions", async () => {
    await reject("update public.icp_profiles set name = '   ' where id = $1", [icp.a1]);
    await reject("update public.icp_profiles set description = $1 where id = $2", ["x".repeat(2001), icp.a1]);
  });
});
