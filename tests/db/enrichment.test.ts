import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createFixture, destroyFixture, openTestDb, type Db, type Fixture } from "./support/db";

/**
 * Data rules for P1-E4: company_enrichment_runs, company_enrichment_results,
 * companies.industry/description, provider credit accounting and the
 * enrichment path of public.ingest_lead (provider evidence + discovery
 * identity link). Same API-role method as the other suites; every attempt is
 * rolled back.
 */

const DENIED = "42501";
const CHECK = "23514";
const UNIQUE = "23505";
const FK = "23503";
const STATE = "55000";

let db: Db;
let f: Fixture;
const id = {
  drunA: randomUUID(), drunB: randomUUID(), candWaiting: randomUUID(), candOther: randomUUID(), candB: randomUUID(),
  companyA: randomUUID(), companyB: randomUUID(),
  processing: randomUUID(), enriching: randomUUID(), done: randomUUID(), runB: randomUUID(), manualProcessing: randomUUID(),
};
const user = (uid: string) => ({ kind: "user" as const, id: uid });

beforeAll(async () => {
  db = await openTestDb();
  f = await createFixture(db);
  const w = f.workspaces;
  await db.query(
    `insert into public.discovery_runs (id, workspace_id, provider_key, query, status) values
       ($1, $3, 'google_places', 'generic query', 'review'), ($2, $4, 'google_places', 'generic query b', 'review')`,
    [id.drunA, id.drunB, w.a1, w.b1],
  );
  await db.query(
    `insert into public.discovery_candidates (id, workspace_id, discovery_run_id, provider_key, external_record_id) values
       ($1, $4, $5, 'google_places', 'place-waiting'), ($2, $4, $5, 'google_places', 'place-other'), ($3, $6, $7, 'google_places', 'place-b')`,
    [id.candWaiting, id.candOther, id.candB, w.a1, id.drunA, w.b1, id.drunB],
  );
  await db.query(`update public.discovery_candidates set decision = 'needs_enrichment' where id = $1`, [id.candWaiting]);
  // The search was finished before enrichment happened (the common case).
  await db.query(`update public.discovery_runs set status = 'completed', completed_at = now() where id = $1`, [id.drunA]);
  await db.query(
    `insert into public.companies (id, workspace_id, canonical_name, normalized_name, primary_domain) values
       ($1, $3, 'Existing A', 'existing a', 'existing-a.example.test'), ($2, $4, 'Existing B', 'existing b', null)`,
    [id.companyA, id.companyB, w.a1, w.b1],
  );
  await db.query(
    `insert into public.company_enrichment_runs (id, workspace_id, provider_key, input_kind, discovery_candidate_id, target_company_id, manual_company_name, requested_domain, status) values
       ($1, $6, 'hunter', 'discovery_reference', $7, null, null, 'quillstone.example.test', 'processing'),
       ($2, $6, 'hunter', 'manual_name', null, null, 'Typed Name', 'typed.example.test', 'enriching'),
       ($3, $6, 'hunter', 'domain', null, null, null, 'done.example.test', 'review'),
       ($4, $8, 'hunter', 'domain', null, null, null, 'b.example.test', 'enriching'),
       ($5, $6, 'hunter', 'existing_company', null, $9, null, 'existing-a.example.test', 'processing')`,
    [id.processing, id.enriching, id.done, id.runB, id.manualProcessing, w.a1, id.candWaiting, w.b1, id.companyA],
  );
  await db.query(`update public.company_enrichment_runs set status = 'completed', completed_at = now(), decision = 'skip', commit_result = 'skipped' where id = $1`, [id.done]);
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
  "insert into public.company_enrichment_runs (workspace_id, provider_key, input_kind, discovery_candidate_id, target_company_id, manual_company_name, requested_domain) values ($1, 'hunter', $2, $3, $4, $5, $6) returning id, status, created_by";
const insertResult =
  "insert into public.company_enrichment_results (workspace_id, enrichment_run_id, provider_key, external_record_id, canonical_name, primary_domain, industry, description, tags, match_state, matched_company_id) values ($1, $2, $3, 'hc-1', 'Typed Co', 'typed.example.test', $4, $5, $6, $7, $8) returning id";

// =============================================================================
describe("company enrichment runs", () => {
  it("RLS on, nothing for anon, no deletes; results are insert-only", async () => {
    const rows = await db.query<{ relname: string; rls: boolean; anon: boolean; del: boolean; upd: boolean }>(
      `select c.relname, c.relrowsecurity as rls,
              has_table_privilege('anon', c.oid, 'select, insert, update, delete') as anon,
              has_table_privilege('authenticated', c.oid, 'delete') as del,
              has_table_privilege('authenticated', c.oid, 'update') as upd
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('company_enrichment_runs', 'company_enrichment_results') order by c.relname`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.rls && !r.anon && !r.del)).toBe(true);
    const cols = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'company_enrichment_results' and grantee = 'authenticated' and privilege_type = 'UPDATE'`,
    );
    expect(cols.rows[0].n).toBe(0);
  });

  it("are visible only in their workspace", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const ids = new Set((await s.query<{ id: string }>("select id from public.company_enrichment_runs")).map((r) => r.id));
      expect(ids).toEqual(new Set([id.processing, id.enriching, id.done, id.manualProcessing]));
    });
    await as(db, user(f.users.outsider), async (s) => expect(await s.query("select * from public.company_enrichment_runs")).toEqual([]));
  });

  it("members create runs in their own workspace; created_by is the caller; status starts draft", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt<{ status: string; created_by: string }>(insertRun, [f.workspaces.a1, "domain", null, null, null, "a.example.test"]);
      expect(r.ok && r.rows[0]).toMatchObject({ status: "draft", created_by: f.users.memberA });
    });
    await expectCode(f.users.memberA, insertRun, [f.workspaces.b1, "domain", null, null, null, "a.example.test"], DENIED);
  });

  it("a discovery-reference run can never store a (transient) provider name", async () => {
    await expectCode(f.users.memberA, insertRun, [f.workspaces.a1, "discovery_reference", id.candOther, null, "Transient Place Name", null], CHECK);
    await expectCode(f.users.memberA, insertRun, [f.workspaces.a1, "discovery_reference", null, null, null, null], CHECK);
    await expectCode(f.users.memberA, "update public.company_enrichment_runs set manual_company_name = 'later' where id = $1", [id.processing], DENIED);
    const cols = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name in ('company_enrichment_runs', 'company_enrichment_results')");
    for (const banned of ["raw", "payload", "response", "api_key", "display_name", "formatted_address", "emails", "email"]) {
      expect(cols.rows.map((c) => c.column_name)).not.toContain(banned);
    }
  });

  it("the discovery reference and every company link must be in the same workspace", async () => {
    await expectCode(f.users.multi, insertRun, [f.workspaces.a1, "discovery_reference", id.candB, null, null, null], FK);
    await expectCode(f.users.multi, insertRun, [f.workspaces.a1, "existing_company", null, id.companyB, null, null], FK);
    await expectCode(f.users.multi, "update public.company_enrichment_runs set matched_company_id = $2 where id = $1", [id.enriching, id.companyB], FK);
    await expectCode(f.users.multi, "update public.company_enrichment_runs set committed_company_id = $2 where id = $1", [id.enriching, id.companyB], FK);
  });

  it("input shapes, statuses and outcomes are validated", async () => {
    await expectCode(f.users.memberA, insertRun, [f.workspaces.a1, "manual_name", null, null, null, null], CHECK);
    await expectCode(f.users.memberA, insertRun, [f.workspaces.a1, "domain", null, null, null, null], CHECK);
    await expectCode(f.users.memberA, insertRun, [f.workspaces.a1, "existing_company", null, null, null, null], CHECK);
    await expectCode(f.users.memberA, insertRun, [f.workspaces.a1, "domain", null, null, null, "Not A Domain"], CHECK);
    await expectCode(f.users.memberA, "update public.company_enrichment_runs set status = 'magic' where id = $1", [id.enriching], CHECK);
    await expectCode(f.users.memberA, "update public.company_enrichment_runs set status = 'failed' where id = $1", [id.enriching], CHECK);
    await expectCode(f.users.memberA, "update public.company_enrichment_runs set commit_result = 'created' where id = $1", [id.enriching], CHECK);
    await expectCode(f.users.memberA, "update public.company_enrichment_runs set status = 'completed', completed_at = now(), commit_result = 'skipped' where id = $1", [id.enriching], STATE);
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt("update public.company_enrichment_runs set status = 'failed', error_code = 'not_found' where id = $1", [id.enriching])).ok).toBe(true);
    });
  });

  it("provider, input kind and origin are immutable; final runs never change", async () => {
    await expectCode(f.users.memberA, "update public.company_enrichment_runs set provider_key = 'other' where id = $1", [id.enriching], DENIED);
    await expectCode(f.users.memberA, "update public.company_enrichment_runs set input_kind = 'domain' where id = $1", [id.processing], DENIED);
    await expectCode(f.users.memberA, "update public.company_enrichment_runs set discovery_candidate_id = null where id = $1", [id.processing], DENIED);
    await expectCode(f.users.memberA, "update public.company_enrichment_runs set status = 'review' where id = $1", [id.done], STATE);
  });
});

// =============================================================================
describe("company enrichment results", () => {
  it("belong to a run of the same workspace, one per run, only while it is enriching", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt(insertResult, [f.workspaces.a1, id.enriching, "hunter", "Printing", "A short description.", JSON.stringify(["a"]), "new", null])).ok).toBe(true);
      const again = await s.attempt(insertResult, [f.workspaces.a1, id.enriching, "hunter", null, null, null, "new", null]);
      expect(again.ok || again.code).toBe(UNIQUE);
    });
    await expectCode(f.users.multi, insertResult, [f.workspaces.a1, id.runB, "hunter", null, null, null, "new", null], FK);
    await expectCode(f.users.memberA, insertResult, [f.workspaces.a1, id.processing, "hunter", null, null, null, "new", null], STATE);
    await expectCode(f.users.memberA, insertResult, [f.workspaces.a1, id.enriching, "other_provider", null, null, null, "new", null], CHECK);
    await expectCode(f.users.multi, insertResult, [f.workspaces.a1, id.enriching, "hunter", null, null, null, "existing_company", id.companyB], FK);
    await expectCode(f.users.memberA, insertResult, [f.workspaces.a1, id.enriching, "hunter", null, null, null, "existing_company", null], CHECK);
  });

  it("industry, description and tags are bounded", async () => {
    await expectCode(f.users.memberA, insertResult, [f.workspaces.a1, id.enriching, "hunter", "x".repeat(201), null, null, "new", null], CHECK);
    await expectCode(f.users.memberA, insertResult, [f.workspaces.a1, id.enriching, "hunter", null, "x".repeat(2001), null, "new", null], CHECK);
    await expectCode(f.users.memberA, insertResult, [f.workspaces.a1, id.enriching, "hunter", null, null, JSON.stringify(Array.from({ length: 21 }, (_, i) => `t${i}`)), "new", null], CHECK);
    await expectCode(f.users.memberA, "update public.companies set industry = $2 where id = $1", [id.companyA, "x".repeat(201)], CHECK);
    await expectCode(f.users.memberA, "update public.companies set description = $2 where id = $1", [id.companyA, "x".repeat(2001)], CHECK);
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt("update public.companies set industry = 'Printing', description = 'Fine.' where id = $1", [id.companyA])).ok).toBe(true);
    });
  });

  it("are visible only in their workspace and can't be updated", async () => {
    await db.query(
      `insert into public.company_enrichment_results (workspace_id, enrichment_run_id, provider_key, canonical_name, primary_domain, match_state) values ($1, $2, 'hunter', 'B Co', 'b.example.test', 'new')`,
      [f.workspaces.b1, id.runB],
    );
    await as(db, user(f.users.memberA), async (s) => expect(await s.query("select * from public.company_enrichment_results")).toEqual([]));
    await expectCode(f.users.ownerB, "update public.company_enrichment_results set canonical_name = 'changed'", [], DENIED);
  });
});

// =============================================================================
describe("ingest_lead: enrichment commit, provider evidence and identity link", () => {
  const hunterEvidence = JSON.stringify([
    { subject: "company", field_key: "company.name", observed_value: "Quillstone Ledger", source_kind: "api", provider_key: "hunter", external_record_id: "hc-777" },
    { subject: "company", field_key: "company.industry", observed_value: "Bookkeeping", source_kind: "api", provider_key: "hunter", external_record_id: "hc-777" },
  ]);
  const company = JSON.stringify({
    fields: { canonical_name: "Quillstone Ledger", normalized_name: "quillstone ledger", primary_domain: "quillstone.example.test", industry: "Bookkeeping", description: "Fictional." },
  });
  const ingest = "select public.ingest_lead(p_workspace_id => $1, p_company => $2::jsonb, p_evidence => $3::jsonb, p_enrichment_run_id => $4, p_notes => $5::jsonb) as r";

  it("creates the company with industry/description, Hunter evidence and the discovery identity link, and completes the run", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const [{ r }] = await s.query<{ r: { commit_result: string; company_id: string; identity_linked: boolean } }>(ingest, [f.workspaces.a1, company, hunterEvidence, id.processing, JSON.stringify(["a note"])]);
      expect(r).toMatchObject({ commit_result: "created", identity_linked: true });
      const [c] = await s.query<{ industry: string; description: string }>("select industry, description from public.companies where id = $1", [r.company_id]);
      expect(c).toEqual({ industry: "Bookkeeping", description: "Fictional." });
      const ev = await s.query<{ provider_key: string; external_record_id: string; field_key: string; observed_value: unknown; company_id: string }>(
        "select provider_key, external_record_id, field_key, observed_value, company_id from public.lead_sources where company_id = $1 order by provider_key, field_key",
        [r.company_id],
      );
      expect(ev).toEqual([
        // identity only: no Google name/address/category in the value
        { provider_key: "google_places", external_record_id: "place-waiting", field_key: "company.provider_reference", observed_value: null, company_id: r.company_id },
        { provider_key: "hunter", external_record_id: "hc-777", field_key: "company.industry", observed_value: "Bookkeeping", company_id: r.company_id },
        { provider_key: "hunter", external_record_id: "hc-777", field_key: "company.name", observed_value: "Quillstone Ledger", company_id: r.company_id },
      ]);
      const [run] = await s.query<{ status: string; commit_result: string; committed_company_id: string; commit_notes: string[] }>(
        "select status, commit_result, committed_company_id, commit_notes from public.company_enrichment_runs where id = $1",
        [id.processing],
      );
      expect(run).toEqual({ status: "completed", commit_result: "created", committed_company_id: r.company_id, commit_notes: ["a note"] });
      // The waiting reference of the (completed) search now IS that company; its counts are unchanged.
      const [cand] = await s.query<{ decision: string; match_state: string; match_company_id: string; decided_by: string }>(
        "select decision, match_state, match_company_id, decided_by from public.discovery_candidates where id = $1",
        [id.candWaiting],
      );
      expect(cand).toEqual({ decision: "selected", match_state: "existing_company", match_company_id: r.company_id, decided_by: f.users.memberA });
      const [dr] = await s.query<{ status: string; selected_count: number }>("select status, selected_count from public.discovery_runs where id = $1", [id.drunA]);
      expect(dr).toEqual({ status: "completed", selected_count: 1 });
      // Future searches find the Place ID through durable evidence → an active company of this workspace.
      const link = await s.query<{ company_id: string }>(
        "select company_id from public.lead_sources where workspace_id = $1 and provider_key = 'google_places' and external_record_id = 'place-waiting'",
        [f.workspaces.a1],
      );
      expect(link.map((l) => l.company_id)).toEqual([r.company_id]);

      // Idempotent: a second commit returns the recorded outcome and writes nothing.
      const [{ r: again }] = await s.query<{ r: { already_committed: boolean; company_id: string } }>(ingest, [f.workspaces.a1, company, hunterEvidence, id.processing, null]);
      expect(again).toMatchObject({ already_committed: true, company_id: r.company_id });
      expect((await s.query("select 1 from public.companies where normalized_name = 'quillstone ledger'")).length).toBe(1);

      // Two OPEN runs per reference are impossible since P1-E5 (unique index). A later run for the same
      // reference (after the first completed) can commit another company but can't re-link the Place ID.
      const [{ id: second2 }] = await s.query<{ id: string }>(
        "insert into public.company_enrichment_runs (workspace_id, provider_key, input_kind, discovery_candidate_id, requested_domain, status) values ($1, 'hunter', 'discovery_reference', $2, 'second.example.test', 'processing') returning id",
        [f.workspaces.a1, id.candWaiting],
      );
      const other = JSON.stringify({ fields: { canonical_name: "Second Co", normalized_name: "second co", primary_domain: "second.example.test" } });
      const [{ r: second }] = await s.query<{ r: { commit_result: string; identity_linked: boolean } }>(ingest, [f.workspaces.a1, other, "[]", second2, null]);
      expect(second).toMatchObject({ commit_result: "created", identity_linked: false });
      const links = await s.query<{ company_id: string }>("select company_id from public.lead_sources where provider_key = 'google_places' and external_record_id = 'place-waiting'");
      expect(links.map((l) => l.company_id)).toEqual([r.company_id]);
    });
  });

  it("merge into an existing company (no discovery origin): no identity link; repeated identity evidence is kept once", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      await s.query("insert into public.lead_sources (workspace_id, company_id, source_kind, provider_key, external_record_id, field_key, observed_value) values ($1, $2, 'api', 'hunter', 'hc-777', 'company.industry', '\"Older\"')", [f.workspaces.a1, id.companyA]);
      const [{ r }] = await s.query<{ r: { commit_result: string; identity_linked: boolean } }>(ingest, [
        f.workspaces.a1, JSON.stringify({ id: id.companyA, fields: { industry: "Bookkeeping" } }), hunterEvidence, id.manualProcessing, null,
      ]);
      expect(r).toMatchObject({ commit_result: "merged", identity_linked: false });
      const ev = await s.query<{ field_key: string }>("select field_key from public.lead_sources where company_id = $1 and provider_key = 'hunter' order by field_key", [id.companyA]);
      expect(ev.map((e) => e.field_key)).toEqual(["company.industry", "company.name"]);
    });
  });

  it("refuses runs that are not being committed, and other workspaces' runs", async () => {
    await expectCode(f.users.memberA, ingest, [f.workspaces.a1, company, "[]", id.enriching, null], STATE);
    await expectCode(f.users.multi, ingest, [f.workspaces.a1, company, "[]", id.runB, null], DENIED);
    await expectCode(f.users.memberA, ingest, [f.workspaces.b1, company, "[]", id.runB, null], DENIED);
  });

  it("other candidates of a finished search stay frozen", async () => {
    await expectCode(f.users.memberA, "update public.discovery_candidates set decision = 'dismissed' where id = $1", [id.candOther], STATE);
    await expectCode(f.users.memberA, "update public.discovery_candidates set decision = 'selected', match_state = 'existing_company', match_company_id = $2 where id = $1", [id.candOther, id.companyA], STATE);
  });

  it("manual and CSV callers are unchanged (P1-E2 contract)", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const [{ r }] = await s.query<{ r: { commit_result: string } }>(
        "select public.ingest_lead($1, $2::jsonb, null, $3::jsonb, null) as r",
        [f.workspaces.a1, JSON.stringify({ fields: { canonical_name: "Manual Co", normalized_name: "manual co" } }), JSON.stringify([{ subject: "company", field_key: "company.name", observed_value: "Manual Co", source_kind: "manual" }])],
      );
      expect(r.commit_result).toBe("created");
    });
  });
});

// =============================================================================
describe("provider usage: enrichment link and estimated credits", () => {
  const insertUsage =
    "insert into public.provider_usage_events (workspace_id, enrichment_run_id, provider_key, operation, request_count, result_count, status, estimated_credit_millis) values ($1, $2, 'hunter', $3, 1, 1, $4, $5) returning id";

  it("records credits for the workspace's own runs only", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt(insertUsage, [f.workspaces.a1, id.enriching, "company_enrichment", "ok", 200])).ok).toBe(true);
      expect((await s.attempt(insertUsage, [f.workspaces.a1, id.enriching, "domain_finder", "quota_exhausted", 0])).ok).toBe(true);
      expect((await s.attempt(insertUsage, [f.workspaces.a1, null, "company_enrichment", "restricted", null])).ok).toBe(true);
    });
    await expectCode(f.users.multi, insertUsage, [f.workspaces.a1, id.runB, "company_enrichment", "ok", 200], FK);
    await expectCode(f.users.memberA, insertUsage, [f.workspaces.b1, null, "company_enrichment", "ok", 200], DENIED);
    await expectCode(f.users.memberA, insertUsage, [f.workspaces.a1, null, "company_enrichment", "ok", -1], CHECK);
    await expectCode(f.users.memberA, insertUsage, [f.workspaces.a1, null, "company_enrichment", "great", 0], CHECK);
  });

  it("stay append-only and workspace-specific", async () => {
    await db.query(`insert into public.provider_usage_events (workspace_id, provider_key, operation, request_count, status, estimated_credit_millis) values ($1, 'hunter', 'company_enrichment', 1, 'ok', 200)`, [f.workspaces.b1]);
    await as(db, user(f.users.memberA), async (s) => {
      expect(await s.query("select * from public.provider_usage_events where workspace_id = $1", [f.workspaces.b1])).toEqual([]);
    });
    await expectCode(f.users.ownerB, "update public.provider_usage_events set estimated_credit_millis = 0", [], DENIED);
  });
});
