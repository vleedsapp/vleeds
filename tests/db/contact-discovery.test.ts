import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createFixture, destroyFixture, openTestDb, type Db, type Fixture } from "./support/db";

/**
 * Data rules for P1-E5: contact_discovery_runs, contact_discovery_candidates,
 * public.commit_contact_candidate (→ ingest_lead), usage links, and the P1-E4
 * one-open-enrichment-run-per-reference correction. Every attempt is rolled back.
 */

const DENIED = "42501";
const CHECK = "23514";
const UNIQUE = "23505";
const FK = "23503";
const STATE = "55000";

let db: Db;
let f: Fixture;
const id = {
  icpA: randomUUID(), icpB: randomUUID(),
  coA: randomUUID(), coA2: randomUUID(), coB: randomUUID(),
  kAda: randomUUID(), kBen: randomUUID(), kOther: randomUUID(), kB: randomUUID(),
  run: randomUUID(), runDone: randomUUID(), runB: randomUUID(),
  cNew: randomUUID(), cExisting: randomUUID(), cDup: randomUUID(), cConflict: randomUUID(), cB: randomUUID(),
  drun: randomUUID(), dcand: randomUUID(),
};
const user = (uid: string) => ({ kind: "user" as const, id: uid });
const titles = JSON.stringify([{ title: "Head of Operations", priority: "primary" }]);

beforeAll(async () => {
  db = await openTestDb();
  f = await createFixture(db);
  const w = f.workspaces;
  await db.query(`insert into public.icp_profiles (id, workspace_id, name, is_default) values ($1, $3, 'Profile A', true), ($2, $4, 'Profile B', true)`, [id.icpA, id.icpB, w.a1, w.b1]);
  await db.query(
    `insert into public.companies (id, workspace_id, canonical_name, normalized_name, primary_domain) values
       ($1, $4, 'Tidewell', 'tidewell', 'tidewell.example.test'),
       ($2, $4, 'Other Co', 'other co', 'other.example.test'),
       ($3, $5, 'B Co', 'b co', 'b.example.test')`,
    [id.coA, id.coA2, id.coB, w.a1, w.b1],
  );
  await db.query(
    `insert into public.contacts (id, workspace_id, company_id, full_name, email, normalized_email) values
       ($1, $5, $6, 'Ada Quill', 'ada.quill@tidewell.example.test', 'ada.quill@tidewell.example.test'),
       ($2, $5, $6, 'Ben Ross', null, null),
       ($3, $5, $7, 'Cy Dale', 'cy.dale@tidewell.example.test', 'cy.dale@tidewell.example.test'),
       ($4, $8, $9, 'B Person', null, null)`,
    [id.kAda, id.kBen, id.kOther, id.kB, w.a1, id.coA, id.coA2, w.b1, id.coB],
  );
  await db.query(
    `insert into public.contact_discovery_runs (id, workspace_id, company_id, icp_profile_id, icp_revision, provider_key, domain, status, selected_titles) values
       ($1, $4, $5, $7, 1, 'hunter', 'tidewell.example.test', 'searching', $9::jsonb),
       ($2, $4, $5, null, null, 'hunter', 'tidewell.example.test', 'searching', $9::jsonb),
       ($3, $6, $8, null, null, 'hunter', 'b.example.test', 'searching', $9::jsonb)`,
    [id.run, id.runDone, id.runB, w.a1, id.coA, w.b1, id.icpA, id.coB, titles],
  );
  const cand = `insert into public.contact_discovery_candidates (id, workspace_id, contact_discovery_run_id, company_id, provider_key, full_name, email, normalized_email, job_title, role_match, match_state, matched_contact_id)
                values ($1, $2, $3, $4, 'hunter', $5, $6, lower($6), $7, $8, $9, $10)`;
  await db.query(cand, [id.cNew, w.a1, id.run, id.coA, "Dee Ash", "Dee.Ash@tidewell.example.test", "Office Coordinator", "other", "new", null]);
  await db.query(cand, [id.cExisting, w.a1, id.run, id.coA, "Ada Quill", "ada.quill@tidewell.example.test", "Head of Operations", "primary", "existing_contact", id.kAda]);
  await db.query(cand, [id.cDup, w.a1, id.run, id.coA, "Ben Ross", "b.ross@tidewell.example.test", "Operations Manager", "secondary", "possible_duplicate", id.kBen]);
  await db.query(cand, [id.cConflict, w.a1, id.run, id.coA, "Cy Dale", "cy.dale@tidewell.example.test", "CEO", "decision_maker", "conflict", id.kOther]);
  await db.query(cand, [id.cB, w.b1, id.runB, id.coB, "B Cand", "b.cand@b.example.test", null, "other", "new", null]);
  await db.query(`update public.contact_discovery_runs set status = 'review' where id = any($1::uuid[])`, [[id.run, id.runB]]);
  await db.query(`update public.contact_discovery_runs set status = 'completed', completed_at = now() where id = $1`, [id.runDone]);
  // P1-E4 F1 fixture: a discovery reference
  await db.query(`insert into public.discovery_runs (id, workspace_id, provider_key, query, status) values ($1, $2, 'google_places', 'q', 'review')`, [id.drun, w.a1]);
  await db.query(`insert into public.discovery_candidates (id, workspace_id, discovery_run_id, provider_key, external_record_id, decision) values ($1, $2, $3, 'google_places', 'place-x', 'unreviewed')`, [id.dcand, w.a1, id.drun]);
}, 180_000);

afterAll(async () => {
  if (db && f) await destroyFixture(db, f);
  await db?.close();
});

async function expectCode(who: string, sql: string, params: unknown[], code: string) {
  await as(db, user(who), async (s) => {
    const r = await s.attempt(sql, params);
    expect(r.ok, sql).toBe(false);
    if (!r.ok) expect(r.code, r.message).toBe(code);
  });
}

const insertRun =
  "insert into public.contact_discovery_runs (workspace_id, company_id, icp_profile_id, icp_revision, provider_key, domain, selected_titles, decision_maker_only) values ($1, $2, $3, $4, 'hunter', 'tidewell.example.test', $5::jsonb, $6) returning id, status, created_by";
const insertCand =
  "insert into public.contact_discovery_candidates (workspace_id, contact_discovery_run_id, company_id, provider_key, full_name, email, normalized_email, match_state, matched_contact_id) values ($1, $2, $3, 'hunter', 'X Y', $4, $5, $6, $7)";
const select = (candidate: string, action: string): [string, unknown[]] => [`update public.contact_discovery_candidates set decision = 'selected', selected_action = $2 where id = $1`, [candidate, action]];
const commit = "select public.commit_contact_candidate($1, $2, $3::jsonb, $4::jsonb) as r";

// =============================================================================
describe("contact discovery runs", () => {
  it("RLS on, nothing for anon, no deletes", async () => {
    const rows = await db.query<{ rls: boolean; anon: boolean; del: boolean }>(
      `select c.relrowsecurity as rls, has_table_privilege('anon', c.oid, 'select, insert, update, delete') as anon,
              has_table_privilege('authenticated', c.oid, 'delete') as del
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('contact_discovery_runs', 'contact_discovery_candidates')`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.rls && !r.anon && !r.del)).toBe(true);
  });

  it("belong to their workspace; members create them for their own companies only", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect(new Set((await s.query<{ id: string }>("select id from public.contact_discovery_runs")).map((r) => r.id))).toEqual(new Set([id.run, id.runDone]));
      const r = await s.attempt<{ status: string; created_by: string }>(insertRun, [f.workspaces.a1, id.coA, id.icpA, 1, titles, false]);
      expect(r.ok && r.rows[0]).toMatchObject({ status: "draft", created_by: f.users.memberA });
    });
    await expectCode(f.users.memberA, insertRun, [f.workspaces.b1, id.coB, null, null, titles, false], DENIED);
  });

  it("the company and the ICP must be in the run's workspace; revision needs a profile; criteria required", async () => {
    await expectCode(f.users.multi, insertRun, [f.workspaces.a1, id.coB, null, null, titles, false], FK);
    await expectCode(f.users.multi, insertRun, [f.workspaces.a1, id.coA, id.icpB, 1, titles, false], FK);
    await expectCode(f.users.memberA, insertRun, [f.workspaces.a1, id.coA, null, 2, titles, false], CHECK);
    await expectCode(f.users.memberA, insertRun, [f.workspaces.a1, id.coA, null, null, "[]", false], CHECK);
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt(insertRun, [f.workspaces.a1, id.coA, null, null, "[]", true])).ok).toBe(true); // decision makers only
    });
    await expectCode(f.users.memberA, insertRun, [f.workspaces.a1, id.coA, null, null, JSON.stringify(Array(11).fill({ title: "t", priority: "primary" })), false], CHECK);
  });

  it("criteria are immutable; completed runs are final", async () => {
    await expectCode(f.users.memberA, "update public.contact_discovery_runs set domain = 'other.example.test' where id = $1", [id.run], DENIED);
    await expectCode(f.users.memberA, "update public.contact_discovery_runs set result_count = 99 where id = $1", [id.run], DENIED);
    await expectCode(f.users.memberA, "update public.contact_discovery_runs set status = 'review' where id = $1", [id.runDone], STATE);
    await expectCode(f.users.memberA, "update public.contact_discovery_runs set status = 'failed' where id = $1", [id.run], CHECK);
  });
});

// =============================================================================
describe("contact discovery candidates", () => {
  it("have no payload columns and are visible only in their workspace", async () => {
    const cols = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'contact_discovery_candidates'")).rows.map((c) => c.column_name);
    for (const banned of ["raw", "payload", "response", "sources", "twitter", "organization"]) expect(cols).not.toContain(banned);
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.query<{ id: string }>("select id from public.contact_discovery_candidates")).map((r) => r.id).sort()).toEqual([id.cNew, id.cExisting, id.cDup, id.cConflict].sort());
    });
  });

  it("belong to the run's company and workspace; are added only while the run is searching; one per email", async () => {
    await expectCode(f.users.memberA, insertCand, [f.workspaces.a1, id.run, id.coA, "z@x.example.test", "z@x.example.test", "new", null], STATE); // run in review
    await as(db, user(f.users.multi), async (s) => {
      // a searching run in workspace B: a candidate can't claim workspace A
      const [{ id: rb }] = await s.query<{ id: string }>(
        "insert into public.contact_discovery_runs (workspace_id, company_id, provider_key, domain, selected_titles, status) values ($1, $2, 'hunter', 'b.example.test', $3::jsonb, 'searching') returning id",
        [f.workspaces.b1, id.coB, titles],
      );
      const cross = await s.attempt(insertCand, [f.workspaces.a1, rb, id.coB, "z@x.example.test", "z@x.example.test", "new", null]);
      expect(!cross.ok && cross.code).toBe(FK);
      // a match can't point at another workspace's contact (refused by the same-company rule before the FK)
      const foreign = await s.attempt(insertCand, [f.workspaces.b1, rb, id.coB, "u@x.example.test", "u@x.example.test", "possible_duplicate", id.kAda]);
      expect(foreign.ok).toBe(false);
      if (!foreign.ok) expect([CHECK, FK]).toContain(foreign.code);
    });
    await as(db, user(f.users.memberA), async (s) => {
      const [{ id: rid }] = await s.query<{ id: string }>(insertRun, [f.workspaces.a1, id.coA, null, null, titles, false]);
      await s.query("update public.contact_discovery_runs set status = 'searching' where id = $1", [rid]);
      const otherCompany = await s.attempt(insertCand, [f.workspaces.a1, rid, id.coA2, "z@x.example.test", "z@x.example.test", "new", null]);
      expect(!otherCompany.ok && otherCompany.code).toBe(FK); // must be the run's company
      expect((await s.attempt(insertCand, [f.workspaces.a1, rid, id.coA, "Z@x.example.test", "z@x.example.test", "new", null])).ok).toBe(true);
      const again = await s.attempt(insertCand, [f.workspaces.a1, rid, id.coA, "z@x.example.test", "z@x.example.test", "new", null]);
      expect(!again.ok && again.code).toBe(UNIQUE);
      const bad = await s.attempt(insertCand, [f.workspaces.a1, rid, id.coA, "Y@x.example.test", "Y@x.example.test", "new", null]);
      expect(!bad.ok && bad.code).toBe(CHECK); // normalized email must be lower-case
      const notEmail = await s.attempt(insertCand, [f.workspaces.a1, rid, id.coA, "nope", "nope", "new", null]);
      expect(!notEmail.ok && notEmail.code).toBe(CHECK);
      // an existing/duplicate match must be a contact at THIS company; matches in another workspace are impossible
      const wrong = await s.attempt(insertCand, [f.workspaces.a1, rid, id.coA, "w@x.example.test", "w@x.example.test", "existing_contact", id.kOther]);
      expect(!wrong.ok && wrong.code).toBe(CHECK);
      const noMatch = await s.attempt(insertCand, [f.workspaces.a1, rid, id.coA, "v@x.example.test", "v@x.example.test", "existing_contact", null]);
      expect(!noMatch.ok && noMatch.code).toBe(CHECK);
    });
  });

  it("decision rules: conflicts can't be selected; selection needs a fitting action; decided_by stamped; counts kept", async () => {
    await expectCode(f.users.memberA, ...select(id.cConflict, "create"), CHECK);
    await expectCode(f.users.memberA, ...select(id.cExisting, "create"), CHECK);
    await expectCode(f.users.memberA, "update public.contact_discovery_candidates set decision = 'selected' where id = $1", [id.cNew], CHECK);
    await expectCode(f.users.memberA, "update public.contact_discovery_candidates set decision = 'saved' where id = $1", [id.cNew], CHECK);
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt<{ decided_by: string }>("update public.contact_discovery_candidates set decision = 'selected', selected_action = 'create' where id = $1 returning decided_by", [id.cNew]);
      expect(r.ok && r.rows[0].decided_by).toBe(f.users.memberA);
      expect((await s.attempt(...select(id.cDup, "create"))).ok).toBe(true); // possible duplicate: user chose "new"
      expect((await s.attempt("update public.contact_discovery_candidates set decision = 'dismissed', selected_action = null where id = $1", [id.cConflict])).ok).toBe(true);
      const [run] = await s.query<{ result_count: number; selected_count: number; dismissed_count: number }>("select result_count, selected_count, dismissed_count from public.contact_discovery_runs where id = $1", [id.run]);
      expect(run).toEqual({ result_count: 4, selected_count: 2, dismissed_count: 1 });
    });
  });

  it("identity fields are immutable", async () => {
    await expectCode(f.users.memberA, "update public.contact_discovery_candidates set normalized_email = 'x@y.example.test' where id = $1", [id.cNew], DENIED);
    await expectCode(f.users.memberA, "update public.contact_discovery_candidates set matched_contact_id = $2 where id = $1", [id.cDup, id.kAda], DENIED);
  });
});

// =============================================================================
describe("commit_contact_candidate (→ ingest_lead)", () => {
  const evidence = JSON.stringify([
    { subject: "contact", field_key: "contact.name", observed_value: "Dee Ash", source_kind: "api", provider_key: "hunter" },
    { subject: "contact", field_key: "contact.email", observed_value: "Dee.Ash@tidewell.example.test", source_kind: "api", provider_key: "hunter" },
  ]);
  const newContact = JSON.stringify({ fields: { full_name: "Dee Ash", email: "Dee.Ash@tidewell.example.test", normalized_email: "dee.ash@tidewell.example.test", job_title: "Office Coordinator" }, primary_if_none: true });

  it("creates the selected contact at the company with provider evidence; idempotent on repeat", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      await s.query(...select(id.cNew, "create"));
      const [{ r }] = await s.query<{ r: { commit_result: string; contact_id: string; already_committed: boolean } }>(commit, [f.workspaces.a1, id.cNew, newContact, evidence]);
      expect(r).toMatchObject({ commit_result: "created", already_committed: false });
      const [k] = await s.query<{ company_id: string; full_name: string; is_primary: boolean }>("select company_id, full_name, is_primary from public.contacts where id = $1", [r.contact_id]);
      expect(k).toEqual({ company_id: id.coA, full_name: "Dee Ash", is_primary: true });
      const ev = await s.query<{ field_key: string; provider_key: string; external_record_id: string | null; source_kind: string; contact_id: string }>(
        "select field_key, provider_key, external_record_id, source_kind, contact_id from public.lead_sources where contact_id = $1 order by field_key",
        [r.contact_id],
      );
      expect(ev).toEqual([
        { field_key: "contact.email", provider_key: "hunter", external_record_id: null, source_kind: "api", contact_id: r.contact_id },
        { field_key: "contact.name", provider_key: "hunter", external_record_id: null, source_kind: "api", contact_id: r.contact_id },
      ]);
      const [c] = await s.query<{ commit_result: string; committed_contact_id: string }>("select commit_result, committed_contact_id from public.contact_discovery_candidates where id = $1", [id.cNew]);
      expect(c).toEqual({ commit_result: "created", committed_contact_id: r.contact_id });
      expect((await s.query<{ saved_count: number }>("select saved_count from public.contact_discovery_runs where id = $1", [id.run]))[0].saved_count).toBe(1);

      const [{ r: again }] = await s.query<{ r: { already_committed: boolean; contact_id: string } }>(commit, [f.workspaces.a1, id.cNew, newContact, evidence]);
      expect(again).toEqual({ already_committed: true, commit_result: "created", contact_id: r.contact_id });
      expect((await s.query("select 1 from public.contacts where normalized_email = 'dee.ash@tidewell.example.test'")).length).toBe(1);
      // a saved candidate is frozen
      const frozen = await s.attempt("update public.contact_discovery_candidates set decision = 'dismissed', selected_action = null where id = $1", [id.cNew]);
      expect(!frozen.ok && frozen.code).toBe(STATE);
    });
  });

  it("merges into the matched existing contact only (fills empty fields), never another one", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      await s.query(...select(id.cExisting, "merge"));
      const wrongTarget = await s.attempt(commit, [f.workspaces.a1, id.cExisting, JSON.stringify({ id: id.kBen, fields: { job_title: "x" } }), "[]"]);
      expect(!wrongTarget.ok && wrongTarget.code).toBe(DENIED);
      const [{ r }] = await s.query<{ r: { commit_result: string; contact_id: string } }>(commit, [f.workspaces.a1, id.cExisting, JSON.stringify({ id: id.kAda, fields: { job_title: "Head of Operations" } }), "[]"]);
      expect(r).toMatchObject({ commit_result: "merged", contact_id: id.kAda });
      expect((await s.query<{ job_title: string }>("select job_title from public.contacts where id = $1", [id.kAda]))[0].job_title).toBe("Head of Operations");
    });
  });

  it("never duplicates or moves a contact whose email exists elsewhere; refuses unselected and conflict candidates", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      // a "new" decision for an email that already exists anywhere in the workspace is refused
      await s.query(...select(id.cDup, "create"));
      const dupe = await s.attempt(commit, [f.workspaces.a1, id.cDup, JSON.stringify({ fields: { full_name: "Ben Ross", email: "cy.dale@tidewell.example.test", normalized_email: "cy.dale@tidewell.example.test" } }), "[]"]);
      expect(dupe.ok).toBe(true); // candidate email b.ross@ is free: allowed
    });
    await as(db, user(f.users.memberA), async (s) => {
      await s.query("update public.contacts set email = 'b.ross@tidewell.example.test', normalized_email = 'b.ross@tidewell.example.test' where id = $1", [id.kOther]);
      await s.query(...select(id.cDup, "create"));
      const r = await s.attempt(commit, [f.workspaces.a1, id.cDup, JSON.stringify({ fields: { full_name: "Ben Ross" } }), "[]"]);
      expect(!r.ok && r.code).toBe(UNIQUE);
      expect((await s.query<{ company_id: string }>("select company_id from public.contacts where id = $1", [id.kOther]))[0].company_id).toBe(id.coA2);
    });
    await expectCode(f.users.memberA, commit, [f.workspaces.a1, id.cConflict, JSON.stringify({ fields: { full_name: "Cy Dale" } }), "[]"], STATE);
    await expectCode(f.users.memberA, commit, [f.workspaces.a1, id.cNew, newContact, "[]"], STATE); // not selected
    await expectCode(f.users.multi, commit, [f.workspaces.a1, id.cB, newContact, "[]"], DENIED); // another workspace's candidate
  });

  it("refuses runs that are not in review", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      await s.query(...select(id.cNew, "create"));
      await s.query("update public.contact_discovery_runs set status = 'cancelled', cancelled_at = now() where id = $1", [id.run]);
      const r = await s.attempt(commit, [f.workspaces.a1, id.cNew, newContact, "[]"]);
      expect(!r.ok && r.code).toBe(STATE);
      const late = await s.attempt("update public.contact_discovery_candidates set decision = 'dismissed', selected_action = null where id = $1", [id.cExisting]);
      expect(!late.ok && late.code).toBe(STATE);
    });
  });
});

// =============================================================================
describe("usage events and the P1-E4 open-run correction", () => {
  const insertUsage =
    "insert into public.provider_usage_events (workspace_id, contact_discovery_run_id, company_id, provider_key, operation, request_count, result_count, status, estimated_credit_millis) values ($1, $2, $3, 'hunter', 'domain_search', 1, 4, 'ok', 1000) returning id";

  it("usage links to the workspace's own contact runs and companies only", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt(insertUsage, [f.workspaces.a1, id.run, id.coA])).ok).toBe(true);
    });
    await expectCode(f.users.multi, insertUsage, [f.workspaces.a1, id.runB, id.coA], FK);
    await expectCode(f.users.multi, insertUsage, [f.workspaces.a1, id.run, id.coB], FK);
    await expectCode(f.users.memberA, "update public.provider_usage_events set result_count = 0", [], DENIED);
  });

  const enrich = "insert into public.company_enrichment_runs (workspace_id, provider_key, input_kind, discovery_candidate_id) values ($1, 'hunter', 'discovery_reference', $2) returning id";

  it("at most one OPEN enrichment run per discovery reference; finished runs may coexist", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const [{ id: first }] = await s.query<{ id: string }>(enrich, [f.workspaces.a1, id.dcand]);
      const second = await s.attempt(enrich, [f.workspaces.a1, id.dcand]);
      expect(!second.ok && second.code).toBe(UNIQUE);
      await s.query("update public.company_enrichment_runs set status = 'failed', error_code = 'timeout' where id = $1", [first]);
      const whileFailed = await s.attempt(enrich, [f.workspaces.a1, id.dcand]);
      expect(!whileFailed.ok && whileFailed.code).toBe(UNIQUE); // a failed run is still open (retryable)
      await s.query("update public.company_enrichment_runs set status = 'cancelled', cancelled_at = now() where id = $1", [first]);
      expect((await s.attempt(enrich, [f.workspaces.a1, id.dcand])).ok).toBe(true);
    });
  });
});
