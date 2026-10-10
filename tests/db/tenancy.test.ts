import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createFixture, destroyFixture, openTestDb, type Db, type Fixture } from "./support/db";

/**
 * Adversarial tenant-isolation tests for the P0-E1-S1 schema.
 *
 * Every test acts through the same database roles and JWT-claims mechanism
 * that the Supabase Data API uses, and every denied write is re-checked from
 * the database owner's point of view to prove nothing changed.
 */

const DENIED = "42501"; // insufficient_privilege (also raised for RLS WITH CHECK violations)

let db: Db;
let f: Fixture;

const user = (id: string) => ({ kind: "user" as const, id });

beforeAll(async () => {
  db = await openTestDb();
  f = await createFixture(db);
}, 120_000);

afterAll(async () => {
  if (db && f) await destroyFixture(db, f);
  await db?.close();
});

async function ownerView<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

// -----------------------------------------------------------------------------
describe("schema hardening", () => {
  it("has RLS enabled on every table in the public schema", async () => {
    const rows = await ownerView<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')`,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual(
      expect.arrayContaining(["memberships", "organizations", "workspaces"]),
    );
    const unprotected = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(unprotected).toEqual([]);
  });

  it("grants nothing on tenant tables to anon", async () => {
    const rows = await ownerView<{ relname: string }>(
      `select c.relname
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
          and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
               or has_any_column_privilege('anon', c.oid, 'select, insert, update, references'))`,
    );
    expect(rows).toEqual([]);
  });

  it("does not let anon or public execute the private authorization helpers", async () => {
    const rows = await ownerView<{ proname: string; anon: boolean }>(
      `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.anon)).toEqual([]);
  });

  it("pins search_path on every SECURITY DEFINER function", async () => {
    const rows = await ownerView<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosecdef`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.proconfig ?? [], r.proname).toContain('search_path=""');
    }
  });
});

// -----------------------------------------------------------------------------
describe("anonymous access", () => {
  it.each(["organizations", "memberships", "workspaces"])("cannot read %s", async (table) => {
    await as(db, { kind: "anon" }, async (s) => {
      const r = await s.attempt(`select * from public.${table}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(DENIED);
    });
  });

  it("cannot create an organization", async () => {
    await as(db, { kind: "anon" }, async (s) => {
      const r = await s.attempt("select public.create_organization('Anon Org', 'anon-org')");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(DENIED);
    });
  });

  it("cannot insert into workspaces", async () => {
    await as(db, { kind: "anon" }, async (s) => {
      const r = await s.attempt(
        "insert into public.workspaces (organization_id, name, slug) values ($1, 'x', 'xx')",
        [f.orgs.a],
      );
      expect(r.ok).toBe(false);
    });
  });
});

// -----------------------------------------------------------------------------
describe("cross-organization reads", () => {
  it("a member sees only their own organization", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const rows = await s.query<{ id: string }>("select id from public.organizations");
      expect(rows.map((r) => r.id)).toEqual([f.orgs.a]);
    });
  });

  it("returns zero rows when selecting another organization by id", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      expect(await s.query("select * from public.organizations where id = $1", [f.orgs.b])).toEqual([]);
      expect(await s.query("select * from public.workspaces where organization_id = $1", [f.orgs.b])).toEqual([]);
      expect(await s.query("select * from public.workspaces where id = $1", [f.workspaces.b1])).toEqual([]);
      expect(await s.query("select * from public.memberships where organization_id = $1", [f.orgs.b])).toEqual([]);
    });
  });

  it("only lists workspaces of the caller's organizations", async () => {
    await as(db, user(f.users.ownerB), async (s) => {
      const rows = await s.query<{ id: string }>("select id from public.workspaces");
      expect(rows.map((r) => r.id)).toEqual([f.workspaces.b1]);
    });
  });

  it("only lists memberships of the caller's organizations", async () => {
    await as(db, user(f.users.ownerB), async (s) => {
      const rows = await s.query<{ organization_id: string }>("select organization_id from public.memberships");
      expect(new Set(rows.map((r) => r.organization_id))).toEqual(new Set([f.orgs.b]));
    });
  });

  it("an authenticated user with no memberships sees nothing", async () => {
    await as(db, user(f.users.outsider), async (s) => {
      expect(await s.query("select * from public.organizations")).toEqual([]);
      expect(await s.query("select * from public.workspaces")).toEqual([]);
      expect(await s.query("select * from public.memberships")).toEqual([]);
    });
  });

  it("a multi-org user sees exactly the union of their organizations (switcher source)", async () => {
    await as(db, user(f.users.multi), async (s) => {
      const ws = await s.query<{ id: string }>("select id from public.workspaces order by name");
      expect(ws.map((r) => r.id)).toEqual([f.workspaces.a1, f.workspaces.a2, f.workspaces.b1]);
    });
  });

  it("the embedded workspace→organization join cannot leak a foreign organization", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const rows = await s.query(
        `select w.id, o.name from public.workspaces w
           left join public.organizations o on o.id = w.organization_id
          where w.organization_id = $1 or o.id = $1`,
        [f.orgs.b],
      );
      expect(rows).toEqual([]);
    });
  });

  it("private helpers report no access to a foreign organization or workspace", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const [r] = await s.query<{ org: boolean; ws: boolean; role: boolean }>(
        `select private.is_org_member($1) as org,
                private.is_workspace_member($2) as ws,
                private.has_org_role($1, array['owner','admin','member']::public.membership_role[]) as role`,
        [f.orgs.b, f.workspaces.b1],
      );
      expect(r).toEqual({ org: false, ws: false, role: false });
    });
  });
});

// -----------------------------------------------------------------------------
describe("cross-organization writes", () => {
  it("cannot create a workspace in another organization", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt(
        "insert into public.workspaces (organization_id, name, slug) values ($1, 'Injected', 'injected')",
        [f.orgs.b],
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(DENIED);
    });
    expect(await ownerView("select 1 from public.workspaces where slug = 'injected'")).toEqual([]);
  });

  it("cannot update another organization's workspace", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt("update public.workspaces set name = 'pwned' where id = $1", [f.workspaces.b1]);
      expect(r.ok && r.affectedRows).toBe(0);
    });
    const [ws] = await ownerView<{ name: string }>("select name from public.workspaces where id = $1", [
      f.workspaces.b1,
    ]);
    expect(ws.name).toBe("Workspace B1");
  });

  it("cannot update another organization", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt("update public.organizations set name = 'pwned' where id = $1", [f.orgs.b]);
      expect(r.ok && r.affectedRows).toBe(0);
    });
    const [org] = await ownerView<{ name: string }>("select name from public.organizations where id = $1", [f.orgs.b]);
    expect(org.name).toBe("Test Org B");
  });

  it("cannot add themselves to another organization", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      for (const role of ["member", "admin", "owner"]) {
        const r = await s.attempt(
          "insert into public.memberships (organization_id, user_id, role) values ($1, $2, $3)",
          [f.orgs.b, f.users.ownerA, role],
        );
        expect(r.ok, role).toBe(false);
      }
    });
    expect(
      await ownerView("select 1 from public.memberships where organization_id = $1 and user_id = $2", [
        f.orgs.b,
        f.users.ownerA,
      ]),
    ).toEqual([]);
  });

  it("an outsider cannot add themselves to any organization", async () => {
    await as(db, user(f.users.outsider), async (s) => {
      const r = await s.attempt(
        "insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'owner')",
        [f.orgs.a, f.users.outsider],
      );
      expect(r.ok).toBe(false);
    });
  });

  it("cannot delete or change memberships in another organization", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const del = await s.attempt("delete from public.memberships where organization_id = $1", [f.orgs.b]);
      expect(del.ok && del.affectedRows).toBe(0);
      const upd = await s.attempt("update public.memberships set role = 'member' where organization_id = $1", [
        f.orgs.b,
      ]);
      expect(upd.ok && upd.affectedRows).toBe(0);
    });
    const rows = await ownerView("select 1 from public.memberships where organization_id = $1", [f.orgs.b]);
    expect(rows).toHaveLength(2);
  });

  it("cannot move a workspace into another organization, even as owner of both", async () => {
    // multi is admin of nothing in B, so first prove the plain case for ownerA…
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt("update public.workspaces set organization_id = $1 where id = $2", [
        f.orgs.b,
        f.workspaces.a1,
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(DENIED);
    });
    // …then promote ownerA to owner of B (as db owner) and retry: still denied,
    // because tenant keys are immutable rather than merely policy-checked.
    await db.query("insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
      f.orgs.b,
      f.users.ownerA,
    ]);
    try {
      await as(db, user(f.users.ownerA), async (s) => {
        const r = await s.attempt("update public.workspaces set organization_id = $1 where id = $2", [
          f.orgs.b,
          f.workspaces.a1,
        ]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe(DENIED);
      });
    } finally {
      await db.query("delete from public.memberships where organization_id = $1 and user_id = $2", [
        f.orgs.b,
        f.users.ownerA,
      ]);
    }
    const [ws] = await ownerView<{ organization_id: string }>(
      "select organization_id from public.workspaces where id = $1",
      [f.workspaces.a1],
    );
    expect(ws.organization_id).toBe(f.orgs.a);
  });

  it("cannot re-point a membership to another organization or user", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const toOrg = await s.attempt("update public.memberships set organization_id = $1 where user_id = $2", [
        f.orgs.b,
        f.users.memberA,
      ]);
      expect(toOrg.ok).toBe(false);
      const toUser = await s.attempt(
        "update public.memberships set user_id = $1 where user_id = $2 and organization_id = $3",
        [f.users.ownerB, f.users.memberA, f.orgs.a],
      );
      expect(toUser.ok).toBe(false);
    });
  });

  it("cannot spoof created_by when creating a workspace", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt(
        "insert into public.workspaces (organization_id, name, slug, created_by) values ($1, 'Spoof', 'spoof', $2)",
        [f.orgs.a, f.users.ownerB],
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(DENIED);
    });
  });

  it("cannot insert organizations directly (only via create_organization)", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt("insert into public.organizations (name, slug) values ('Direct', 'direct-insert')");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(DENIED);
    });
  });

  it("cannot delete organizations or workspaces in P0", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const org = await s.attempt("delete from public.organizations where id = $1", [f.orgs.a]);
      expect(org.ok).toBe(false);
      const ws = await s.attempt("delete from public.workspaces where id = $1", [f.workspaces.a1]);
      expect(ws.ok).toBe(false);
    });
  });
});

// -----------------------------------------------------------------------------
describe("roles within an organization", () => {
  it("a plain member cannot create workspaces, rename the org, or manage members", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const ws = await s.attempt(
        "insert into public.workspaces (organization_id, name, slug) values ($1, 'Nope', 'nope')",
        [f.orgs.a],
      );
      expect(ws.ok).toBe(false);

      const org = await s.attempt("update public.organizations set name = 'nope' where id = $1", [f.orgs.a]);
      expect(org.ok && org.affectedRows).toBe(0);

      const wsUpd = await s.attempt("update public.workspaces set name = 'nope' where id = $1", [f.workspaces.a1]);
      expect(wsUpd.ok && wsUpd.affectedRows).toBe(0);

      const add = await s.attempt(
        "insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'member')",
        [f.orgs.a, f.users.outsider],
      );
      expect(add.ok).toBe(false);

      const promote = await s.attempt("update public.memberships set role = 'owner' where user_id = $1", [
        f.users.memberA,
      ]);
      expect(promote.ok && promote.affectedRows).toBe(0);
    });
  });

  it("an admin can manage workspaces and non-owner members", async () => {
    await as(db, user(f.users.adminA), async (s) => {
      const ws = await s.attempt<{ id: string; created_by: string }>(
        "insert into public.workspaces (organization_id, name, slug) values ($1, 'New', 'new-ws') returning id, created_by",
        [f.orgs.a],
      );
      expect(ws.ok).toBe(true);
      if (ws.ok) expect(ws.rows[0].created_by).toBe(f.users.adminA);

      const add = await s.attempt(
        "insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'member')",
        [f.orgs.a, f.users.outsider],
      );
      expect(add.ok).toBe(true);
    });
  });

  it("an admin cannot create, modify or remove owners", async () => {
    await as(db, user(f.users.adminA), async (s) => {
      const mkOwner = await s.attempt(
        "insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'owner')",
        [f.orgs.a, f.users.outsider],
      );
      expect(mkOwner.ok).toBe(false);

      const selfPromote = await s.attempt(
        "update public.memberships set role = 'owner' where user_id = $1 and organization_id = $2",
        [f.users.adminA, f.orgs.a],
      );
      expect(selfPromote.ok).toBe(false);

      const demoteOwner = await s.attempt(
        "update public.memberships set role = 'member' where user_id = $1 and organization_id = $2",
        [f.users.ownerA, f.orgs.a],
      );
      expect(demoteOwner.ok && demoteOwner.affectedRows).toBe(0);

      const removeOwner = await s.attempt(
        "delete from public.memberships where user_id = $1 and organization_id = $2",
        [f.users.ownerA, f.orgs.a],
      );
      expect(removeOwner.ok && removeOwner.affectedRows).toBe(0);
    });
  });

  it("the last owner cannot leave or demote themselves", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const leave = await s.attempt("delete from public.memberships where user_id = $1 and organization_id = $2", [
        f.users.ownerA,
        f.orgs.a,
      ]);
      expect(leave.ok).toBe(false);
      const demote = await s.attempt(
        "update public.memberships set role = 'admin' where user_id = $1 and organization_id = $2",
        [f.users.ownerA, f.orgs.a],
      );
      expect(demote.ok).toBe(false);
    });
  });

  it("a member can leave an organization", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt("delete from public.memberships where user_id = $1 and organization_id = $2", [
        f.users.memberA,
        f.orgs.a,
      ]);
      expect(r.ok && r.affectedRows).toBe(1);
      expect(await s.query("select * from public.workspaces")).toEqual([]);
    });
  });
});

// -----------------------------------------------------------------------------
describe("organization creation", () => {
  it("create_organization makes the caller the sole owner and grants access", async () => {
    await as(db, user(f.users.outsider), async (s) => {
      const [{ id }] = await s.query<{ id: string }>("select public.create_organization($1, $2) as id", [
        "Outsider Org",
        `outsider-org-${f.tag}`,
      ]);
      const members = await s.query<{ user_id: string; role: string }>(
        "select user_id, role from public.memberships where organization_id = $1",
        [id],
      );
      expect(members).toEqual([{ user_id: f.users.outsider, role: "owner" }]);
      expect(await s.query("select id from public.organizations")).toEqual([{ id }]);
    });
  });

  it("rejects invalid slugs", async () => {
    await as(db, user(f.users.outsider), async (s) => {
      const r = await s.attempt("select public.create_organization('Bad', 'Bad Slug!')");
      expect(r.ok).toBe(false);
    });
  });
});

// -----------------------------------------------------------------------------
describe("service role", () => {
  it("bypasses RLS (server-only; must never reach the browser)", async () => {
    await as(db, { kind: "service" }, async (s) => {
      const rows = await s.query<{ id: string }>("select id from public.organizations where id = any($1::uuid[])", [
        [f.orgs.a, f.orgs.b],
      ]);
      expect(rows).toHaveLength(2);
    });
  });
});
