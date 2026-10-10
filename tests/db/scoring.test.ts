import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createFixture, destroyFixture, openTestDb, type Db, type Fixture, type Session } from "./support/db";

/**
 * Data rules for P1-E6: company_signal_observations, scoring_input (canonical
 * input + fingerprint), score persistence (since P1-E7 only through
 * save_lead_score_trusted, executable by the trusted server role only), the
 * lead_scores outcome/fingerprint columns and list_companies currentness.
 * Every attempt is rolled back.
 */

const DENIED = "42501";
const CHECK = "23514";
const UNIQUE = "23505";
const FK = "23503";
const STATE = "55000";

let db: Db;
let f: Fixture;
const id = {
  icpA: randomUUID(), icpB: randomUUID(), coA: randomUUID(), coA2: randomUUID(), coB: randomUUID(), kA: randomUUID(),
  buy1: randomUUID(), buy2: randomUUID(), hard: randomUUID(), pen: randomUUID(),
};
const user = (uid: string) => ({ kind: "user" as const, id: uid });

const scoringModel = { thresholds: { a: 75, b: 50 }, categoryWeights: { company_fit: 40, geography_fit: 20, decision_maker_fit: 20, buying_signal_fit: 20 } };

beforeAll(async () => {
  db = await openTestDb();
  f = await createFixture(db);
  const w = f.workspaces;
  await db.query(
    `insert into public.icp_profiles (id, workspace_id, name, is_default, ideal_customer, decision_maker_titles, buying_signals, exclusion_signals, scoring_model)
     values ($1, $3, 'Profile A', true, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb),
            ($2, $4, 'Profile B', true, null, null, null, null, $9::jsonb)`,
    [
      id.icpA, id.icpB, w.a1, w.b1,
      JSON.stringify({ industries: ["Marine robotics"], companySize: { minEmployees: 10, maxEmployees: 100 }, characteristics: [], keywords: [], notes: null }),
      JSON.stringify([{ id: randomUUID(), title: "Fleet Director", priority: "primary", seniority: null }]),
      JSON.stringify([{ id: id.buy1, name: "Expanding", description: null, weight: 50, enabled: true }, { id: id.buy2, name: "Hiring", description: null, weight: 50, enabled: true }]),
      JSON.stringify([
        { id: id.hard, name: "Consumer-only", description: null, behavior: "hard_exclude", penalty: null, enabled: true },
        { id: id.pen, name: "Competitor", description: null, behavior: "penalty", penalty: 10, enabled: true },
      ]),
      JSON.stringify(scoringModel),
    ],
  );
  await db.query(
    `insert into public.companies (id, workspace_id, canonical_name, normalized_name, industry, employee_count_min, employee_count_max, location) values
       ($1, $4, 'Tidecraft', 'tidecraft', 'Marine robotics', 20, 50, '{"countryCode":"NO","city":"Bergen"}'),
       ($2, $4, 'Other', 'other', null, null, null, null),
       ($3, $5, 'B Co', 'b co', null, null, null, null)`,
    [id.coA, id.coA2, id.coB, w.a1, w.b1],
  );
  await db.query(`insert into public.contacts (id, workspace_id, company_id, full_name, job_title) values ($1, $2, $3, 'Ada', 'Fleet Director')`, [id.kA, w.a1, id.coA]);
}, 180_000);

afterAll(async () => {
  if (db && f) await destroyFixture(db, f);
  await db?.close();
});

/** Refused with one of the given codes (a guard trigger can refuse before RLS/FK checks report). */
async function expectRefused(who: string, sql: string, params: unknown[], codes: string[]) {
  await as(db, user(who), async (s) => {
    const r = await s.attempt(sql, params);
    expect(r.ok, sql).toBe(false);
    if (!r.ok) expect(codes, r.message).toContain(r.code);
  });
}

async function expectCode(who: string, sql: string, params: unknown[], code: string) {
  await as(db, user(who), async (s) => {
    const r = await s.attempt(sql, params);
    expect(r.ok, sql).toBe(false);
    if (!r.ok) expect(r.code, r.message).toBe(code);
  });
}

const observe =
  "insert into public.company_signal_observations (workspace_id, company_id, icp_profile_id, icp_revision, signal_kind, signal_id, state, note) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, created_by";
const fp = "select public.scoring_input($1, $2, $3) ->> 'fingerprint' as fp";
const TRUSTED_SIGNATURE = "public.save_lead_score_trusted(uuid, uuid, uuid, uuid, integer, text, text, integer, text, jsonb, integer, jsonb, jsonb, jsonb)";
const save =
  "select public.save_lead_score_trusted($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb, $14::jsonb) as id";
type SaveOpts = { fp: string; status?: string; score?: number | null; grade?: string | null; revision?: number; coverage?: number; reasons?: unknown; actor?: string | null; workspace?: string; company?: string };
const saveArgs = (o: SaveOpts) => [
  o.actor === undefined ? f.users.memberA : o.actor, o.workspace ?? f.workspaces.a1, o.company ?? id.coA, id.icpA, o.revision ?? 1, o.fp, o.status ?? "scored",
  o.score === undefined ? 80 : o.score, o.grade === undefined ? "A" : o.grade,
  JSON.stringify({ company_fit: 100 }), o.coverage ?? 70, JSON.stringify({ v: 1 }), JSON.stringify({ company_fit: { configured: 40, effective: 100 } }),
  o.reasons === undefined ? null : JSON.stringify(o.reasons),
];

/**
 * Persists as the server's trusted role (what src/lib/supabase/trusted-score-writer.ts
 * does), inside the caller's transaction, then returns to the user's role.
 */
async function trusted(s: Session, o: SaveOpts) {
  await s.query("set local role service_role");
  try {
    return await s.attempt<{ id: string }>(save, saveArgs(o));
  } finally {
    await s.query("set local role authenticated");
  }
}
async function trustedOk(s: Session, o: SaveOpts): Promise<string> {
  const r = await trusted(s, o);
  if (!r.ok) throw new Error(`trusted save failed: ${r.code} ${r.message}`);
  return r.rows[0].id;
}

// =============================================================================
describe("company signal observations", () => {
  it("RLS on, nothing for anon; members may delete (unknown = no row)", async () => {
    const r = await db.query<{ rls: boolean; anon: boolean; del: boolean }>(
      `select c.relrowsecurity as rls, has_table_privilege('anon', c.oid, 'select, insert, update, delete') as anon, has_table_privilege('authenticated', c.oid, 'delete') as del
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'company_signal_observations'`,
    );
    expect(r.rows[0]).toEqual({ rls: true, anon: false, del: true });
  });

  it("members record present/absent in their workspace; created_by is the caller; unknown removes the row", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt<{ created_by: string }>(observe, [f.workspaces.a1, id.coA, id.icpA, 1, "buying", id.buy1, "present", "Seen on their site"]);
      expect(r.ok && r.rows[0].created_by).toBe(f.users.memberA);
      const del = await s.attempt("delete from public.company_signal_observations where company_id = $1 and signal_id = $2", [id.coA, id.buy1]);
      expect(del.ok && del.affectedRows).toBe(1);
      expect(await s.query("select * from public.company_signal_observations where company_id = $1", [id.coA])).toEqual([]);
    });
    await expectRefused(f.users.memberA, observe, [f.workspaces.b1, id.coB, id.icpB, 1, "buying", id.buy1, "present", null], [DENIED, STATE]);
  });

  it("states are present/absent only; one observation per signal context", async () => {
    await expectCode(f.users.memberA, observe, [f.workspaces.a1, id.coA, id.icpA, 1, "buying", id.buy1, "unknown", null], CHECK);
    await as(db, user(f.users.memberA), async (s) => {
      await s.query(observe, [f.workspaces.a1, id.coA, id.icpA, 1, "buying", id.buy1, "present", null]);
      const again = await s.attempt(observe, [f.workspaces.a1, id.coA, id.icpA, 1, "buying", id.buy1, "absent", null]);
      expect(!again.ok && again.code).toBe(UNIQUE);
      expect((await s.attempt("update public.company_signal_observations set state = 'absent' where company_id = $1", [id.coA])).ok).toBe(true);
    });
  });

  it("the signal must exist in the profile, with that kind, at its current revision; company/profile in the same workspace", async () => {
    await expectCode(f.users.memberA, observe, [f.workspaces.a1, id.coA, id.icpA, 1, "buying", randomUUID(), "present", null], CHECK);
    await expectCode(f.users.memberA, observe, [f.workspaces.a1, id.coA, id.icpA, 1, "exclusion", id.buy1, "present", null], CHECK);
    await expectCode(f.users.memberA, observe, [f.workspaces.a1, id.coA, id.icpA, 2, "buying", id.buy1, "present", null], STATE);
    await expectCode(f.users.multi, observe, [f.workspaces.a1, id.coB, id.icpA, 1, "buying", id.buy1, "present", null], FK);
    await expectRefused(f.users.multi, observe, [f.workspaces.a1, id.coA, id.icpB, 1, "buying", id.buy1, "present", null], [FK, STATE]);
    await expectCode(f.users.memberA, observe, [f.workspaces.a1, id.coA, id.icpA, 1, "buying", id.buy1, "present", "x".repeat(501)], CHECK);
  });

  it("are visible only in their workspace; keys are immutable", async () => {
    await db.query(observe, [f.workspaces.b1, id.coB, id.icpB, 1, "buying", id.buy1, "present", null]).catch(() => undefined); // signal not in B's profile: rejected even for the owner
    await as(db, user(f.users.memberA), async (s) => {
      await s.query(observe, [f.workspaces.a1, id.coA, id.icpA, 1, "exclusion", id.pen, "present", null]);
      const moved = await s.attempt("update public.company_signal_observations set signal_kind = 'buying' where company_id = $1", [id.coA]);
      expect(!moved.ok && moved.code).toBe(DENIED);
    });
    await as(db, user(f.users.ownerB), async (s) => expect(await s.query("select * from public.company_signal_observations")).toEqual([]));
  });
});

// =============================================================================
describe("scoring_input fingerprint", () => {
  it("is a SHA-256 hex digest of the canonical input; null for another workspace's company", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const [{ fp: a }] = await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      const [doc] = await s.query<{ d: { input: { contacts: unknown[]; company: Record<string, unknown> } } }>("select public.scoring_input($1, $2, $3) as d", [f.workspaces.a1, id.coA, id.icpA]);
      expect(doc.d.input.contacts).toEqual([{ title: "Fleet Director" }]);
      expect(Object.keys(doc.d.input.company).sort()).toEqual(["city", "country", "description", "employee_count_max", "employee_count_min", "id", "industry", "name", "region"]);
      const [{ fp: none }] = await s.query<{ fp: string | null }>(fp, [f.workspaces.a1, id.coB, id.icpA]);
      expect(none).toBeNull();
    });
  });

  it("is stable for irrelevant changes (timestamps, notes, qualification, contact insert order, contact names)", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const before = (await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]))[0].fp;
      await s.query("update public.companies set notes = 'irrelevant', qualification_state = 'qualified' where id = $1", [id.coA]);
      await s.query("update public.contacts set full_name = 'Ada Renamed', email = 'ada@x.example.test', normalized_email = 'ada@x.example.test' where id = $1", [id.kA]);
      expect((await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]))[0].fp).toBe(before);
    });
    // same contacts inserted in different orders → same fingerprint
    const orderFp = async (titles: string[]) =>
      as(db, user(f.users.memberA), async (s) => {
        for (const t of titles) await s.query("insert into public.contacts (workspace_id, company_id, full_name, job_title) values ($1, $2, 'X', $3)", [f.workspaces.a1, id.coA2, t]);
        return (await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA2, id.icpA]))[0].fp;
      });
    expect(await orderFp(["B Title", "A Title", "C Title"])).toBe(await orderFp(["C Title", "A Title", "B Title"]));
  });

  it("changes for every scoring-relevant change", async () => {
    const changes: [string, string, unknown[]][] = [
      ["industry", "update public.companies set industry = 'Other' where id = $1", [id.coA]],
      ["description", "update public.companies set description = 'New text' where id = $1", [id.coA]],
      ["employee range", "update public.companies set employee_count_max = 60 where id = $1", [id.coA]],
      ["location", `update public.companies set location = '{"countryCode":"SE"}' where id = $1`, [id.coA]],
      ["contact added", "insert into public.contacts (workspace_id, company_id, full_name, job_title) select workspace_id, id, 'New', 'Analyst' from public.companies where id = $1", [id.coA]],
      ["contact title", "update public.contacts set job_title = 'Analyst' where id = $1", [id.kA]],
      ["contact left", "update public.contacts set status = 'left_company' where id = $1", [id.kA]],
      ["company tags", "insert into public.lead_sources (workspace_id, company_id, source_kind, field_key, observed_value) select workspace_id, id, 'api', 'company.tags', '\"Survey\"' from public.companies where id = $1", [id.coA]],
    ];
    for (const [what, sql, params] of changes) {
      await as(db, user(f.users.memberA), async (s) => {
        const before = (await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]))[0].fp;
        await s.query(sql, params);
        expect((await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]))[0].fp, what).not.toBe(before);
      });
    }
    await as(db, user(f.users.memberA), async (s) => {
      const before = (await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]))[0].fp;
      await s.query(observe, [f.workspaces.a1, id.coA, id.icpA, 1, "buying", id.buy2, "absent", null]);
      const afterObs = (await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]))[0].fp;
      expect(afterObs, "signal observation").not.toBe(before);
      await s.query("update public.company_signal_observations set note = 'only a note' where company_id = $1", [id.coA]);
      expect((await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]))[0].fp, "a note doesn't affect scoring").toBe(afterObs);
    });
    // ICP revision change (owner edits the profile)
    await as(db, user(f.users.ownerA), async (s) => {
      const before = (await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]))[0].fp;
      await s.query(`update public.icp_profiles set scoring_model = $2::jsonb where id = $1`, [id.icpA, JSON.stringify({ ...scoringModel, thresholds: { a: 80, b: 50 } })]);
      expect((await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]))[0].fp, "ICP revision").not.toBe(before);
    });
  });
});

// =============================================================================
describe("score persistence (trusted writer) and lead_scores", () => {
  it("the normal authenticated role can't execute the score writer; the trusted role can; the P1-E6 RPC is gone", async () => {
    const priv = await db.query<{ auth: boolean; anon: boolean; service: boolean; old: string | null }>(
      `select has_function_privilege('authenticated', '${TRUSTED_SIGNATURE}', 'execute') as auth,
              has_function_privilege('anon', '${TRUSTED_SIGNATURE}', 'execute') as anon,
              has_function_privilege('service_role', '${TRUSTED_SIGNATURE}', 'execute') as service,
              to_regprocedure('public.save_lead_score(uuid, uuid, uuid, integer, text, text, integer, text, jsonb, integer, jsonb, jsonb, jsonb)')::text as old`,
    );
    expect(priv.rows[0]).toEqual({ auth: false, anon: false, service: true, old: null });
    // A member calling it directly with fabricated values matching the current fingerprint is refused.
    await as(db, user(f.users.memberA), async (s) => {
      const [{ fp: now }] = await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]);
      const direct = await s.attempt(save, saveArgs({ fp: now, score: 100, grade: "A" }));
      expect(!direct.ok && direct.code).toBe(DENIED);
    });
  });

  it("the trusted role saves a server-computed result for a member, tied to the current revision and fingerprint", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const [{ fp: now }] = await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]);
      const sid = await trustedOk(s, { fp: now });
      const [row] = await s.query<{ status: string; score: number; grade: string; input_fingerprint: string; coverage_percent: number; icp_revision: number; scored_by: string }>(
        "select status, score, grade, input_fingerprint, coverage_percent, icp_revision, scored_by from public.lead_scores where id = $1",
        [sid],
      );
      expect(row).toEqual({ status: "scored", score: 80, grade: "A", input_fingerprint: now, coverage_percent: 70, icp_revision: 1, scored_by: f.users.memberA });
      // re-evaluating the same revision updates the same row (no duplicates)
      await trustedOk(s, { fp: now, score: 60, grade: "B" });
      expect(await s.query("select score, grade from public.lead_scores where company_id = $1 and icp_profile_id = $2", [id.coA, id.icpA])).toEqual([{ score: 60, grade: "B" }]);
    });
  });

  it("still requires a member actor, the same workspace, the current inputs and consistent values", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const [{ fp: now }] = await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]);
      const tries: [SaveOpts, string][] = [
        [{ fp: now, actor: f.users.ownerB }, DENIED], // not a member of A1
        [{ fp: now, actor: f.users.outsider }, DENIED],
        [{ fp: now, actor: null }, DENIED],
        [{ fp: now, workspace: f.workspaces.b1, company: id.coB, actor: f.users.ownerB }, DENIED], // profile A isn't in B1
        [{ fp: now, company: id.coB }, DENIED], // foreign company
        [{ fp: "0".repeat(64) }, STATE], // stale fingerprint
        [{ fp: now, revision: 2 }, STATE], // not the current revision
        [{ fp: now, score: 80, grade: "B" }, CHECK], // thresholds say A
        [{ fp: now, score: 101, grade: "A" }, CHECK],
        [{ fp: now, coverage: 101 }, CHECK],
        [{ fp: now, status: "pending", score: null, grade: null }, "22023"],
        [{ fp: now, status: "excluded", score: null, grade: null }, CHECK], // needs exclusion reasons
        [{ fp: now, status: "excluded", score: null, grade: null, reasons: [{ id: id.hard }] }, CHECK], // a reason needs a name
        [{ fp: now, status: "excluded", score: 40, grade: null, reasons: [{ id: id.hard, name: "Consumer-only" }] }, CHECK], // excluded has no score
      ];
      for (const [args, code] of tries) {
        const r = await trusted(s, args);
        expect(!r.ok && r.code, JSON.stringify({ ...args, fp: args.fp.slice(0, 4) })).toBe(code);
      }
      const ok = await trusted(s, { fp: now, status: "excluded", score: null, grade: null, reasons: [{ id: id.hard, name: "Consumer-only" }] });
      expect(ok.ok).toBe(true);
    });
    // Direct table writes stay unavailable to members.
    await expectCode(f.users.memberA, "insert into public.lead_scores (workspace_id, company_id, icp_profile_id, icp_revision, status) values ($1, $2, $3, 1, 'pending')", [f.workspaces.a1, id.coA, id.icpA], DENIED);
    await expectCode(f.users.ownerA, "update public.lead_scores set score = 99 where company_id = $1", [id.coA], DENIED);
  });

  it("a new revision gets its own row; the old one stays readable", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const [{ fp: r1 }] = await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]);
      await trustedOk(s, { fp: r1, actor: f.users.ownerA });
      await s.query(`update public.icp_profiles set scoring_model = $2::jsonb where id = $1`, [id.icpA, JSON.stringify({ ...scoringModel, thresholds: { a: 90, b: 50 } })]);
      const [{ fp: r2 }] = await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]);
      await trustedOk(s, { fp: r2, revision: 2, score: 80, grade: "B", actor: f.users.ownerA });
      expect(await s.query("select icp_revision, grade from public.lead_scores where company_id = $1 order by icp_revision", [id.coA])).toEqual([
        { icp_revision: 1, grade: "A" },
        { icp_revision: 2, grade: "B" },
      ]);
    });
  });

  it("fingerprint and outcome shapes are enforced on the table itself", async () => {
    const bad = async (sql: string) => {
      await db.exec("begin");
      try {
        await expect(db.query(sql, [f.workspaces.a1, id.coA2, id.icpA])).rejects.toMatchObject({ code: CHECK });
      } finally {
        await db.exec("rollback");
      }
    };
    await bad("insert into public.lead_scores (workspace_id, company_id, icp_profile_id, icp_revision, status, score, grade, scored_at, input_fingerprint, coverage_percent) values ($1, $2, $3, 1, 'scored', 50, 'B', now(), 'not-a-hash', 50)");
    await bad("insert into public.lead_scores (workspace_id, company_id, icp_profile_id, icp_revision, status, score, grade, scored_at, coverage_percent) values ($1, $2, $3, 1, 'scored', 50, 'B', now(), 50)");
    await bad("insert into public.lead_scores (workspace_id, company_id, icp_profile_id, icp_revision, status, scored_at, input_fingerprint, coverage_percent, exclusion_reasons) values ($1, $2, $3, 1, 'excluded', now(), repeat('a', 64), 50, '[]')");
    await bad("insert into public.lead_scores (workspace_id, company_id, icp_profile_id, icp_revision, status, scored_at, input_fingerprint, coverage_percent, exclusion_reasons, grade) values ($1, $2, $3, 1, 'excluded', now(), repeat('a', 64), 50, '[{\"name\":\"x\"}]', 'C')");
  });
});

// =============================================================================
describe("list_companies currentness (default profile)", () => {
  const list = (grade: string | null) => [f.workspaces.a1, null, grade, null, null, null, "name", 100, 0];
  const sql = "select canonical_name, grade, score, score_state, coverage_percent from public.list_companies($1, $2, $3, $4, $5, $6, $7, $8, $9)";

  it("current → grade + fit; data change → outdated; profile change → outdated; excluded; none", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const [{ fp: now }] = await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]);
      await trustedOk(s, { fp: now, actor: f.users.ownerA });
      const rows = await s.query<{ canonical_name: string; grade: string | null; score: number | null; score_state: string; coverage_percent: number | null }>(sql, list(null));
      expect(rows).toEqual([
        { canonical_name: "Other", grade: null, score: null, score_state: "none", coverage_percent: null },
        { canonical_name: "Tidecraft", grade: "A", score: 80, score_state: "current", coverage_percent: 70 },
      ]);
      expect((await s.query(sql, list("A"))).length).toBe(1);
      expect((await s.query(sql, list("none"))).length).toBe(1);

      await s.query("update public.contacts set job_title = 'Analyst' where id = $1", [id.kA]); // data changed
      const outdated = await s.query<{ grade: string | null; score_state: string }>(sql, list("outdated"));
      expect(outdated).toEqual([expect.objectContaining({ canonical_name: "Tidecraft", grade: null, score: null, score_state: "outdated" })]);
      expect((await s.query(sql, list("A"))).length).toBe(0); // never shows an old grade as current

      const [{ fp: again }] = await s.query<{ fp: string }>(fp, [f.workspaces.a1, id.coA, id.icpA]);
      await trustedOk(s, { fp: again, status: "excluded", score: null, grade: null, reasons: [{ id: id.hard, name: "Consumer-only" }], actor: f.users.ownerA });
      expect(await s.query(sql, list("excluded"))).toEqual([expect.objectContaining({ canonical_name: "Tidecraft", score_state: "excluded", grade: null })]);

      await s.query(`update public.icp_profiles set scoring_model = $2::jsonb where id = $1`, [id.icpA, JSON.stringify({ ...scoringModel, thresholds: { a: 85, b: 50 } })]);
      expect(await s.query(sql, list("outdated"))).toEqual([expect.objectContaining({ canonical_name: "Tidecraft", score_state: "outdated" })]);
    });
  });
});
