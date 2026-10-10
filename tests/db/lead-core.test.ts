import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createFixture, destroyFixture, openTestDb, type Db, type Fixture } from "./support/db";

/**
 * Adversarial data-boundary tests for the lead core (P1-E1): companies,
 * contacts, lead_sources, lead_scores, suppression_records.
 *
 * Same method as tenancy.test.ts: attempts run as the Data API would
 * (SET LOCAL ROLE + JWT claims, always rolled back); denied writes are
 * re-checked as the database owner.
 *
 * Fixture (created as DB owner): Org A (ownerA, adminA, memberA, multi) with
 * workspaces A1, A2; Org B (ownerB, multi as member) with B1.
 *   A1: companies cA (domain shared.example.test, contacts pA1 primary + pA2),
 *       cA2 (no domain, contact pA3); evidence on cA and pA1; an ICP profile
 *       with a scored result for cA; a company suppression on cA2.
 *   B1: company cB with the SAME domain as cA, contact pB with the SAME email
 *       as pA1, its own ICP profile.
 */

const DENIED = "42501";
const CHECK = "23514";
const UNIQUE = "23505";
const FK = "23503";

let db: Db;
let f: Fixture;
const id = {
  cA: randomUUID(),
  cA2: randomUUID(),
  cB: randomUUID(),
  pA1: randomUUID(),
  pA2: randomUUID(),
  pA3: randomUUID(),
  pB: randomUUID(),
  icpA: randomUUID(),
  icpB: randomUUID(),
  scoreA: randomUUID(),
  srcA: randomUUID(),
  srcPA1: randomUUID(),
  supA2: randomUUID(),
};
const user = (uid: string) => ({ kind: "user" as const, id: uid });

beforeAll(async () => {
  db = await openTestDb();
  f = await createFixture(db);
  const w = f.workspaces;
  await db.query(
    `insert into public.companies (id, workspace_id, canonical_name, normalized_name, primary_domain, created_by) values
       ($1, $4, 'Shared Example Co', 'shared example co', 'shared.example.test', $6),
       ($2, $4, 'Second Example Co', 'second example co', null, $6),
       ($3, $5, 'Shared Example Co', 'shared example co', 'shared.example.test', $7)`,
    [id.cA, id.cA2, id.cB, w.a1, w.b1, f.users.ownerA, f.users.ownerB],
  );
  await db.query(
    `insert into public.contacts (id, workspace_id, company_id, full_name, email, normalized_email, is_primary) values
       ($1, $5, $7, 'Person One', 'person.one@shared.example.test', 'person.one@shared.example.test', true),
       ($2, $5, $7, 'Person Two', null, null, false),
       ($3, $5, $8, 'Person Three', null, null, false),
       ($4, $6, $9, 'Person One', 'Person.One@shared.example.test', 'person.one@shared.example.test', true)`,
    [id.pA1, id.pA2, id.pA3, id.pB, w.a1, w.b1, id.cA, id.cA2, id.cB],
  );
  await db.query(
    `insert into public.lead_sources (id, workspace_id, company_id, contact_id, source_kind, field_key, observed_value, confidence) values
       ($1, $3, $4, null, 'manual', 'company.website', '"https://shared.example.test"', 90),
       ($2, $3, $4, $5, 'csv', 'contact.email', '"person.one@shared.example.test"', 80)`,
    [id.srcA, id.srcPA1, w.a1, id.cA, id.pA1],
  );
  await db.query(
    `insert into public.icp_profiles (id, workspace_id, name, is_default) values ($1, $3, 'Profile A', true), ($2, $4, 'Profile B', true)`,
    [id.icpA, id.icpB, w.a1, w.b1],
  );
  await db.query(
    `insert into public.lead_scores (id, workspace_id, company_id, icp_profile_id, icp_revision, score, grade, status, scored_at, input_fingerprint, coverage_percent)
     values ($1, $2, $3, $4, 1, 82, 'A', 'scored', now(), repeat('a', 64), 80)`,
    [id.scoreA, w.a1, id.cA, id.icpA],
  );
  await db.query(
    `insert into public.suppression_records (id, workspace_id, company_id, scope, reason) values ($1, $2, $3, 'company', 'Asked not to be contacted')`,
    [id.supA2, w.a1, id.cA2],
  );
}, 180_000);

afterAll(async () => {
  if (db && f) await destroyFixture(db, f);
  await db?.close();
});

async function ownerView<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function expectCode(who: string, sql: string, params: unknown[], code: string) {
  await as(db, user(who), async (s) => {
    const r = await s.attempt(sql, params);
    expect(r.ok, sql).toBe(false);
    if (!r.ok) expect(r.code, r.message).toBe(code);
  });
}

async function expectZeroRows(who: string, sql: string, params: unknown[]) {
  await as(db, user(who), async (s) => {
    const r = await s.attempt(sql, params);
    expect(r.ok && r.affectedRows, sql).toBe(0);
  });
}

const insertCompany = (cols = "") =>
  `insert into public.companies (workspace_id, canonical_name, normalized_name, primary_domain${cols}) values ($1, $2, $3, $4${cols ? ", $5" : ""}) returning id, created_by, qualification_state`;

// =============================================================================
describe("lead core: schema hardening", () => {
  it("every lead-core table has RLS and grants nothing to anon", async () => {
    const rows = await ownerView<{ relname: string; rls: boolean; anon: boolean }>(
      `select c.relname, c.relrowsecurity as rls,
              has_table_privilege('anon', c.oid, 'select, insert, update, delete') as anon
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1)`,
      [["companies", "contacts", "lead_sources", "lead_scores", "suppression_records"]],
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.rls && !r.anon)).toBe(true);
  });

  it("anon cannot read any lead-core table", async () => {
    for (const t of ["companies", "contacts", "lead_sources", "lead_scores", "suppression_records"]) {
      await as(db, { kind: "anon" }, async (s) => {
        const r = await s.attempt(`select * from public.${t}`);
        expect(r.ok, t).toBe(false);
      });
    }
  });

  it("nobody can hard-delete lead-core rows through the API", async () => {
    for (const [t, rid] of [
      ["companies", id.cA],
      ["contacts", id.pA2],
      ["lead_sources", id.srcA],
      ["lead_scores", id.scoreA],
      ["suppression_records", id.supA2],
    ] as const) {
      await expectCode(f.users.ownerA, `delete from public.${t} where id = $1`, [rid], DENIED);
    }
  });
});

// =============================================================================
describe("companies", () => {
  it.each(["ownerA", "adminA", "memberA"] as const)("%s reads the workspace's companies", async (who) => {
    await as(db, user(f.users[who]), async (s) => {
      const rows = await s.query<{ id: string }>("select id from public.companies where workspace_id = $1 order by canonical_name", [f.workspaces.a1]);
      expect(rows.map((r) => r.id)).toEqual([id.cA2, id.cA]);
    });
  });

  it("cannot read another organization's companies, by id or by workspace", async () => {
    await as(db, user(f.users.ownerB), async (s) => {
      expect(await s.query("select * from public.companies where id = any($1)", [[id.cA, id.cA2]])).toEqual([]);
      expect(await s.query("select * from public.companies where workspace_id = $1", [f.workspaces.a1])).toEqual([]);
    });
  });

  it("an outsider sees nothing; a multi-org user sees exactly their workspaces' companies", async () => {
    await as(db, user(f.users.outsider), async (s) => expect(await s.query("select * from public.companies")).toEqual([]));
    await as(db, user(f.users.multi), async (s) => {
      const rows = await s.query<{ id: string }>("select id from public.companies");
      expect(new Set(rows.map((r) => r.id))).toEqual(new Set([id.cA, id.cA2, id.cB]));
    });
  });

  it("a member can create a company in their workspace; created_by is the caller and state defaults to unreviewed", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt<{ created_by: string; qualification_state: string }>(insertCompany(), [f.workspaces.a1, "New Co", "new co", "new.example.test"]);
      expect(r.ok && r.rows[0]).toEqual(expect.objectContaining({ created_by: f.users.memberA, qualification_state: "unreviewed" }));
    });
  });

  it("cannot create a company in an unrelated workspace", async () => {
    await expectCode(f.users.memberA, insertCompany(), [f.workspaces.b1, "Injected", "injected", null], DENIED);
    await expectCode(f.users.outsider, insertCompany(), [f.workspaces.a1, "Injected", "injected", null], DENIED);
    expect(await ownerView("select 1 from public.companies where canonical_name = 'Injected'")).toEqual([]);
  });

  it("cannot spoof created_by", async () => {
    await expectCode(f.users.memberA, insertCompany(", created_by"), [f.workspaces.a1, "Spoof", "spoof", null, f.users.ownerB], DENIED);
  });

  it("a member can update qualification; a foreign user updates zero rows", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt("update public.companies set qualification_state = 'qualified', qualification_reason = 'Good fit' where id = $1", [id.cA]);
      expect(r.ok && r.affectedRows).toBe(1);
    });
    await expectZeroRows(f.users.ownerB, "update public.companies set qualification_state = 'unqualified' where id = $1", [id.cA]);
    const [row] = await ownerView<{ qualification_state: string }>("select qualification_state from public.companies where id = $1", [id.cA]);
    expect(row.qualification_state).toBe("unreviewed");
  });

  it("an update in one workspace never touches the same company in another workspace", async () => {
    await as(db, user(f.users.multi), async (s) => {
      // multi can write in A1 and B1 (member of both); a domain-wide update still only hits rows it targets.
      const r = await s.attempt("update public.companies set notes = 'touched' where workspace_id = $1 and primary_domain = 'shared.example.test'", [f.workspaces.a1]);
      expect(r.ok && r.affectedRows).toBe(1);
      const [b] = await s.query<{ notes: string | null }>("select notes from public.companies where id = $1", [id.cB]);
      expect(b.notes).toBeNull();
    });
  });

  it("workspace ownership cannot be reassigned (no grant, and the trigger blocks even the table owner)", async () => {
    await expectCode(f.users.ownerA, "update public.companies set workspace_id = $1 where id = $2", [f.workspaces.a2, id.cA], DENIED);
    await expect(db.query("update public.companies set workspace_id = $1 where id = $2", [f.workspaces.a2, id.cA])).rejects.toThrow(/immutable/);
  });

  it("primary domain is unique per workspace among active companies only", async () => {
    await expectCode(f.users.memberA, insertCompany(), [f.workspaces.a1, "Dup", "dup", "shared.example.test"], UNIQUE);
    await as(db, user(f.users.memberA), async (s) => {
      // Same domain in another workspace of the same org: allowed.
      expect((await s.attempt(insertCompany(), [f.workspaces.a2, "Shared Example Co", "shared example co", "shared.example.test"])).ok).toBe(true);
      // Archiving frees the domain for a new active record.
      await s.query("update public.companies set archived_at = now() where id = $1", [id.cA]);
      expect((await s.attempt(insertCompany(), [f.workspaces.a1, "Replacement", "replacement", "shared.example.test"])).ok).toBe(true);
      // Archived companies stay readable for history (the DAL hides them from lists).
      expect(await s.query("select 1 from public.companies where id = $1 and archived_at is not null", [id.cA])).toHaveLength(1);
    });
  });

  it("rejects non-normalized domains, bad ranges, unknown states and blank names", async () => {
    const m = f.users.memberA;
    const ws = f.workspaces.a1;
    await expectCode(m, insertCompany(), [ws, "X", "x", "https://x.example.test"], CHECK);
    await expectCode(m, insertCompany(), [ws, "X", "x", "X.Example.Test"], CHECK);
    await expectCode(m, insertCompany(), [ws, "   ", "x", null], CHECK);
    await expectCode(m, insertCompany(), [ws, "X", "", null], CHECK);
    await expectCode(m, insertCompany(", qualification_state"), [ws, "X", "x", null, "hot"], CHECK);
    await expectCode(m, "update public.companies set employee_count_min = 50, employee_count_max = 5 where id = $1", [id.cA2], CHECK);
    await expectCode(m, "update public.companies set employee_count_min = -1 where id = $1", [id.cA2], CHECK);
    await expectCode(m, "update public.companies set location = '[]'::jsonb where id = $1", [id.cA2], CHECK);
    await expectCode(m, "update public.companies set primary_phone = '+44 20 7946 0000', primary_phone_normalized = '442079460000' where id = $1", [id.cA2], CHECK);
  });
});

// =============================================================================
describe("contacts", () => {
  const insertContact = "insert into public.contacts (workspace_id, company_id, full_name) values ($1, $2, $3)";

  it("members read their workspace's contacts; unrelated workspace contacts are invisible", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const rows = await s.query<{ id: string }>("select id from public.contacts");
      expect(new Set(rows.map((r) => r.id))).toEqual(new Set([id.pA1, id.pA2, id.pA3]));
    });
    await as(db, user(f.users.ownerB), async (s) => {
      expect(await s.query("select * from public.contacts where company_id = $1", [id.cA])).toEqual([]);
    });
  });

  it("a contact must belong to a company in the same workspace", async () => {
    // multi is a member of both A1 and B1: the composite FK still refuses a cross-workspace link.
    await expectCode(f.users.multi, insertContact, [f.workspaces.a1, id.cB, "Cross Link"], FK);
    await expectCode(f.users.memberA, insertContact, [f.workspaces.b1, id.cB, "Cross Link"], DENIED);
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt(insertContact, [f.workspaces.a1, id.cA, "New Person"])).ok).toBe(true);
    });
  });

  it("a contact cannot be moved to another company or workspace", async () => {
    await expectCode(f.users.ownerA, "update public.contacts set company_id = $1 where id = $2", [id.cA2, id.pA2], DENIED);
    await expectCode(f.users.ownerA, "update public.contacts set workspace_id = $1 where id = $2", [f.workspaces.a2, id.pA2], DENIED);
    await expect(db.query("update public.contacts set company_id = $1 where id = $2", [id.cA2, id.pA2])).rejects.toThrow(/immutable/);
  });

  it("at most one active primary contact per company; an archived contact cannot be primary", async () => {
    await expectCode(f.users.memberA, "update public.contacts set is_primary = true where id = $1", [id.pA2], UNIQUE);
    await expectCode(f.users.memberA, "update public.contacts set archived_at = now() where id = $1", [id.pA1], CHECK);
    await as(db, user(f.users.memberA), async (s) => {
      await s.query("update public.contacts set is_primary = false where id = $1", [id.pA1]);
      expect((await s.attempt("update public.contacts set is_primary = true where id = $1", [id.pA2])).ok).toBe(true);
    });
  });

  it("email matching is workspace-local: the same address in another workspace is a separate contact", async () => {
    await as(db, user(f.users.multi), async (s) => {
      const rows = await s.query<{ id: string }>(
        "select id from public.contacts where workspace_id = $1 and normalized_email = 'person.one@shared.example.test'",
        [f.workspaces.a1],
      );
      expect(rows.map((r) => r.id)).toEqual([id.pA1]);
    });
  });

  it("email and normalized email must agree; normalized email must be lower-case", async () => {
    await expectCode(f.users.memberA, "update public.contacts set email = 'a@example.test' where id = $1", [id.pA2], CHECK);
    await expectCode(f.users.memberA, "update public.contacts set email = 'A@Example.test', normalized_email = 'A@Example.test' where id = $1", [id.pA2], CHECK);
  });

  it("rejects unknown status/seniority, blank names and non-https profile URLs", async () => {
    const m = f.users.memberA;
    await expectCode(m, "update public.contacts set status = 'customer' where id = $1", [id.pA2], CHECK);
    await expectCode(m, "update public.contacts set seniority = 'boss' where id = $1", [id.pA2], CHECK);
    await expectCode(m, "update public.contacts set full_name = ' ' where id = $1", [id.pA2], CHECK);
    await expectCode(m, "update public.contacts set linkedin_url = 'http://profile.example.test/x' where id = $1", [id.pA2], CHECK);
  });
});

// =============================================================================
describe("lead_sources (evidence)", () => {
  const insertSource =
    "insert into public.lead_sources (workspace_id, company_id, contact_id, source_kind, provider_key, external_record_id, field_key, observed_value, confidence) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)";
  const ok = async (who: string, params: unknown[]) =>
    as(db, user(who), async (s) => {
      const r = await s.attempt(insertSource, params);
      expect(r.ok, !r.ok ? r.message : "").toBe(true);
    });

  it("a member can record company evidence and contact evidence", async () => {
    const ws = f.workspaces.a1;
    await ok(f.users.memberA, [ws, id.cA, null, "manual", null, null, "company.phone", '"+44 20 7946 0000"', 70]);
    await ok(f.users.memberA, [ws, null, id.pA2, "website", null, null, "contact.title", '"Example title"', null]);
    await ok(f.users.memberA, [ws, id.cA, id.pA1, "api", "example-directory", "rec-1", "contact.name", '"Person One"', 100]);
  });

  it("evidence needs a company or a contact", async () => {
    await expectCode(f.users.memberA, insertSource, [f.workspaces.a1, null, null, "manual", null, null, null, null, null], CHECK);
  });

  it("evidence stays inside the right workspace and the contact must belong to the named company", async () => {
    await expectCode(f.users.multi, insertSource, [f.workspaces.a1, id.cB, null, "manual", null, null, null, null, null], FK);
    await expectCode(f.users.memberA, insertSource, [f.workspaces.a1, id.cA2, id.pA1, "manual", null, null, null, null, null], FK);
    await expectCode(f.users.memberA, insertSource, [f.workspaces.b1, id.cB, null, "manual", null, null, null, null, null], DENIED);
    await as(db, user(f.users.ownerB), async (s) => expect(await s.query("select * from public.lead_sources where company_id = $1", [id.cA])).toEqual([]));
  });

  it("validates kind, field key, provider key, confidence, size and external identity", async () => {
    const ws = f.workspaces.a1;
    const m = f.users.memberA;
    await expectCode(m, insertSource, [ws, id.cA, null, "scraper", null, null, null, null, null], CHECK);
    await expectCode(m, insertSource, [ws, id.cA, null, "manual", null, null, "Company.Phone", null, null], CHECK);
    await expectCode(m, insertSource, [ws, id.cA, null, "manual", null, null, "deal.value", null, null], CHECK);
    await expectCode(m, insertSource, [ws, id.cA, null, "api", "Bad Key!", null, null, null, null], CHECK);
    await expectCode(m, insertSource, [ws, id.cA, null, "manual", null, null, null, null, 101], CHECK);
    await expectCode(m, insertSource, [ws, id.cA, null, "manual", null, null, null, JSON.stringify("x".repeat(3000)), null], CHECK);
    await expectCode(m, insertSource, [ws, id.cA, null, "api", null, "rec-9", null, null, null], CHECK);
  });

  it("the same provider record + field + subject is stored once per workspace (but may exist in another workspace)", async () => {
    const params = (ws: string, company: string) => [ws, company, null, "api", "example-directory", "rec-7", "company.name", '"Shared"', null];
    await as(db, user(f.users.multi), async (s) => {
      expect((await s.attempt(insertSource, params(f.workspaces.a1, id.cA))).ok).toBe(true);
      const dup = await s.attempt(insertSource, params(f.workspaces.a1, id.cA));
      expect(!dup.ok && dup.code).toBe(UNIQUE);
      expect((await s.attempt(insertSource, params(f.workspaces.b1, id.cB))).ok).toBe(true);
    });
  });

  it("evidence is append-only for API users", async () => {
    await expectCode(f.users.ownerA, "update public.lead_sources set confidence = 1 where id = $1", [id.srcA], DENIED);
  });
});

// =============================================================================
describe("lead_scores (storage only)", () => {
  const insertScore =
    "insert into public.lead_scores (workspace_id, company_id, icp_profile_id, icp_revision, score, grade, status, scored_at, breakdown) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)";
  const asOwner = (params: unknown[]) => db.query(insertScore, params);

  it("members read score records of their workspace; others don't", async () => {
    await as(db, user(f.users.memberA), async (s) => expect(await s.query("select id from public.lead_scores")).toEqual([{ id: id.scoreA }]));
    await as(db, user(f.users.ownerB), async (s) => expect(await s.query("select * from public.lead_scores")).toEqual([]));
  });

  it("API users cannot write scores (reserved for the future scoring engine)", async () => {
    await expectCode(f.users.ownerA, insertScore, [f.workspaces.a1, id.cA2, id.icpA, 1, null, null, "pending", null, null], DENIED);
    await expectCode(f.users.ownerA, "update public.lead_scores set score = 100 where id = $1", [id.scoreA], DENIED);
  });

  it("company and ICP profile must belong to the score's workspace", async () => {
    await expect(asOwner([f.workspaces.a1, id.cA, id.icpB, 1, null, null, "pending", null, null])).rejects.toMatchObject({ code: FK });
    await expect(asOwner([f.workspaces.a1, id.cB, id.icpA, 1, null, null, "pending", null, null])).rejects.toMatchObject({ code: FK });
  });

  it("a pending result can exist without a score; a scored one needs score, grade and time", async () => {
    await db.exec("begin");
    try {
      await asOwner([f.workspaces.a1, id.cA2, id.icpA, 1, null, null, "pending", null, null]);
      await expect(db.query("savepoint s1").then(() => asOwner([f.workspaces.a1, id.cA2, id.icpA, 2, null, null, "scored", null, null]))).rejects.toMatchObject({ code: CHECK });
    } finally {
      await db.exec("rollback");
    }
  });

  it("enforces score 0–100, grade A/B/C, pending without values, small object breakdowns, one row per revision", async () => {
    const bad = async (p: unknown[], code = CHECK) => {
      await db.exec("begin");
      try {
        await expect(asOwner(p)).rejects.toMatchObject({ code });
      } finally {
        await db.exec("rollback");
      }
    };
    const ws = f.workspaces.a1;
    await bad([ws, id.cA2, id.icpA, 1, 101, "A", "scored", new Date().toISOString(), null]);
    await bad([ws, id.cA2, id.icpA, 1, -1, "A", "scored", new Date().toISOString(), null]);
    await bad([ws, id.cA2, id.icpA, 1, 50, "D", "scored", new Date().toISOString(), null]);
    await bad([ws, id.cA2, id.icpA, 1, 50, null, "pending", null, null]);
    await bad([ws, id.cA2, id.icpA, 1, null, null, "pending", null, "[]"]);
    await bad([ws, id.cA2, id.icpA, 1, null, null, "pending", null, JSON.stringify({ note: "x".repeat(5000) })]);
    await bad([ws, id.cA2, id.icpA, 0, null, null, "pending", null, null]);
    await bad([ws, id.cA, id.icpA, 1, null, null, "pending", null, null], UNIQUE);
  });

  it("keeps the profile id and revision it was produced from after the profile changes", async () => {
    await db.exec("begin");
    try {
      await db.query("update public.icp_profiles set name = 'Profile A (edited)' where id = $1", [id.icpA]);
      const [p] = (await db.query<{ revision: number }>("select revision from public.icp_profiles where id = $1", [id.icpA])).rows;
      const [s] = (await db.query<{ icp_profile_id: string; icp_revision: number }>("select icp_profile_id, icp_revision from public.lead_scores where id = $1", [id.scoreA])).rows;
      expect(p.revision).toBe(2);
      expect(s).toEqual({ icp_profile_id: id.icpA, icp_revision: 1 });
      await expect(db.query("update public.lead_scores set icp_revision = 2 where id = $1", [id.scoreA])).rejects.toThrow(/immutable/);
    } finally {
      await db.exec("rollback");
    }
  });
});

// =============================================================================
describe("suppression_records", () => {
  const insertSup = "insert into public.suppression_records (workspace_id, company_id, contact_id, scope, reason) values ($1, $2, $3, $4, $5)";

  it("any member can restrict a company or a contact", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt(insertSup, [f.workspaces.a1, id.cA, null, "company", "Existing relationship"])).ok).toBe(true);
      expect((await s.attempt(insertSup, [f.workspaces.a1, id.cA, id.pA2, "contact", null])).ok).toBe(true);
    });
  });

  it("scope must match the target, and a contact must belong to the named company and workspace", async () => {
    const m = f.users.memberA;
    await expectCode(m, insertSup, [f.workspaces.a1, id.cA, null, "contact", null], CHECK);
    await expectCode(m, insertSup, [f.workspaces.a1, id.cA, id.pA1, "company", null], CHECK);
    await expectCode(m, insertSup, [f.workspaces.a1, id.cA2, id.pA1, "contact", null], FK);
    await expectCode(f.users.multi, insertSup, [f.workspaces.a1, id.cB, null, "company", null], FK);
    await expectCode(m, insertSup, [f.workspaces.b1, id.cB, null, "company", null], DENIED);
    await expectCode(m, insertSup, [f.workspaces.a1, id.cA, null, "company", "x".repeat(501)], CHECK);
  });

  it("one active record per target; a lifted one can be re-added", async () => {
    await expectCode(f.users.memberA, insertSup, [f.workspaces.a1, id.cA2, null, "company", "again"], UNIQUE);
    await as(db, user(f.users.adminA), async (s) => {
      await s.query("update public.suppression_records set active = false where id = $1", [id.supA2]);
      expect((await s.attempt(insertSup, [f.workspaces.a1, id.cA2, null, "company", "again"])).ok).toBe(true);
    });
  });

  it("only owners/admins can lift or edit a restriction", async () => {
    await expectZeroRows(f.users.memberA, "update public.suppression_records set active = false where id = $1", [id.supA2]);
    const [row] = await ownerView<{ active: boolean }>("select active from public.suppression_records where id = $1", [id.supA2]);
    expect(row.active).toBe(true);
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await s.attempt("update public.suppression_records set active = false where id = $1", [id.supA2]);
      expect(r.ok && r.affectedRows).toBe(1);
    });
  });

  it("restrictions are workspace-scoped and cannot be retargeted", async () => {
    await as(db, user(f.users.ownerB), async (s) => expect(await s.query("select * from public.suppression_records")).toEqual([]));
    await expectZeroRows(f.users.ownerB, "update public.suppression_records set reason = 'x' where id = $1", [id.supA2]);
    await expectCode(f.users.ownerA, "update public.suppression_records set company_id = $1 where id = $2", [id.cA, id.supA2], DENIED);
    await expect(db.query("update public.suppression_records set scope = 'contact', contact_id = $1 where id = $2", [id.pA3, id.supA2])).rejects.toThrow(/immutable/);
  });
});
