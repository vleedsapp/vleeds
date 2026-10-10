import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createFixture, destroyFixture, openTestDb, type Db, type Fixture } from "./support/db";

/**
 * Data rules for P1-E3: discovery_runs, discovery_candidates (provider
 * REFERENCES only) and provider_usage_events. Same API-role method as the
 * other suites; every attempt is rolled back.
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
  runA: randomUUID(), runA2: randomUUID(), runB: randomUUID(), runDone: randomUUID(),
  candA: randomUUID(), candB: randomUUID(), company: randomUUID(),
};
const user = (uid: string) => ({ kind: "user" as const, id: uid });

beforeAll(async () => {
  db = await openTestDb();
  f = await createFixture(db);
  const w = f.workspaces;
  await db.query(`insert into public.icp_profiles (id, workspace_id, name, is_default) values ($1, $3, 'Profile A', true), ($2, $4, 'Profile B', true)`, [id.icpA, id.icpB, w.a1, w.b1]);
  await db.query(
    `insert into public.discovery_runs (id, workspace_id, icp_profile_id, icp_revision, provider_key, query, status) values
       ($1, $5, $7, 1, 'google_places', 'generic query a', 'review'),
       ($2, $5, null, null, 'google_places', 'generic query a2', 'review'),
       ($3, $6, $8, 1, 'google_places', 'generic query b', 'review'),
       ($4, $5, null, null, 'google_places', 'finished query', 'review')`,
    [id.runA, id.runA2, id.runB, id.runDone, w.a1, w.b1, id.icpA, id.icpB],
  );
  await db.query(
    `insert into public.discovery_candidates (id, workspace_id, discovery_run_id, provider_key, external_record_id) values
       ($1, $3, $4, 'google_places', 'place-shared'),
       ($2, $5, $6, 'google_places', 'place-shared')`,
    [id.candA, id.candB, w.a1, id.runA, w.b1, id.runB],
  );
  await db.query(`insert into public.companies (id, workspace_id, canonical_name, normalized_name) values ($1, $2, 'Linked Co', 'linked co')`, [id.company, w.a1]);
  await db.query(
    `insert into public.lead_sources (workspace_id, company_id, source_kind, provider_key, external_record_id, field_key) values ($1, $2, 'api', 'google_places', 'place-linked', 'company.provider_reference')`,
    [w.a1, id.company],
  );
  await db.query(`update public.discovery_runs set status = 'completed', completed_at = now() where id = $1`, [id.runDone]);
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

const insertRun = "insert into public.discovery_runs (workspace_id, icp_profile_id, icp_revision, provider_key, query) values ($1, $2, $3, 'google_places', 'q') returning id, status, created_by";
const insertCandidate = "insert into public.discovery_candidates (workspace_id, discovery_run_id, provider_key, external_record_id) values ($1, $2, $3, $4) returning id, decision";

// =============================================================================
describe("discovery runs", () => {
  it("RLS on all three tables, nothing for anon, no deletes", async () => {
    const rows = await db.query<{ relname: string; rls: boolean; anon: boolean; del: boolean }>(
      `select c.relname, c.relrowsecurity as rls,
              has_table_privilege('anon', c.oid, 'select, insert, update, delete') as anon,
              has_table_privilege('authenticated', c.oid, 'delete') as del
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('discovery_runs', 'discovery_candidates', 'provider_usage_events')`,
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.every((r) => r.rls && !r.anon && !r.del)).toBe(true);
  });

  it("runs are visible only in their workspace", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect(new Set((await s.query<{ id: string }>("select id from public.discovery_runs")).map((r) => r.id))).toEqual(new Set([id.runA, id.runA2, id.runDone]));
    });
    await as(db, user(f.users.ownerB), async (s) => {
      expect((await s.query<{ id: string }>("select id from public.discovery_runs")).map((r) => r.id)).toEqual([id.runB]);
    });
    await as(db, user(f.users.outsider), async (s) => expect(await s.query("select * from public.discovery_runs")).toEqual([]));
  });

  it("members create runs in their workspace only; created_by is the caller; status starts running", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt<{ status: string; created_by: string }>(insertRun, [f.workspaces.a1, id.icpA, 1]);
      expect(r.ok && r.rows[0]).toMatchObject({ status: "running", created_by: f.users.memberA });
    });
    await expectCode(f.users.memberA, insertRun, [f.workspaces.b1, null, null], DENIED);
  });

  it("the ICP reference must belong to the run's workspace", async () => {
    await expectCode(f.users.multi, insertRun, [f.workspaces.a1, id.icpB, 1], FK);
    await expectCode(f.users.memberA, insertRun, [f.workspaces.a1, null, 3], CHECK); // revision needs a profile
  });

  it("statuses are validated; failed needs an error code; completed/cancelled need timestamps", async () => {
    await expectCode(f.users.memberA, "update public.discovery_runs set status = 'draft' where id = $1", [id.runA], CHECK);
    await expectCode(f.users.memberA, "update public.discovery_runs set status = 'failed' where id = $1", [id.runA], CHECK);
    await expectCode(f.users.memberA, "update public.discovery_runs set status = 'completed' where id = $1", [id.runA], CHECK);
    await expectCode(f.users.memberA, "update public.discovery_runs set status = 'cancelled' where id = $1", [id.runA], CHECK);
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt("update public.discovery_runs set status = 'failed', error_code = 'timeout' where id = $1", [id.runA2])).ok).toBe(true);
    });
  });

  it("query, provider and workspace are immutable; counts can't be set by hand", async () => {
    await expectCode(f.users.memberA, "update public.discovery_runs set query = 'other' where id = $1", [id.runA], DENIED);
    await expectCode(f.users.memberA, "update public.discovery_runs set workspace_id = $2 where id = $1", [id.runA, f.workspaces.a2], DENIED);
    await expectCode(f.users.memberA, "update public.discovery_runs set candidate_count = 99 where id = $1", [id.runA], DENIED);
  });

  it("completed and cancelled runs are final, and so are their candidates", async () => {
    await expectCode(f.users.memberA, "update public.discovery_runs set status = 'review' where id = $1", [id.runDone], STATE);
    await expectCode(f.users.memberA, insertCandidate, [f.workspaces.a1, id.runDone, "google_places", "late-place"], STATE);
  });
});

// =============================================================================
describe("discovery candidates (references only)", () => {
  it("store no provider display content", async () => {
    const cols = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'discovery_candidates'",
    );
    const names = cols.rows.map((c) => c.column_name);
    for (const banned of ["display_name", "name", "formatted_address", "address", "phone", "website", "rating", "reviews", "raw", "payload"]) {
      expect(names).not.toContain(banned);
    }
  });

  it("are visible only in their workspace", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.query<{ id: string }>("select id from public.discovery_candidates")).map((r) => r.id)).toEqual([id.candA]);
    });
  });

  it("one per provider id within a run; the same id is allowed in another run", async () => {
    await expectCode(f.users.memberA, insertCandidate, [f.workspaces.a1, id.runA, "google_places", "place-shared"], UNIQUE);
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt(insertCandidate, [f.workspaces.a1, id.runA2, "google_places", "place-shared"])).ok).toBe(true);
    });
  });

  it("must belong to a run of the same workspace and use the run's provider", async () => {
    await expectCode(f.users.multi, insertCandidate, [f.workspaces.a1, id.runB, "google_places", "x-1"], FK);
    await expectCode(f.users.memberA, insertCandidate, [f.workspaces.a1, id.runA, "other_provider", "x-2"], FK);
    await expectCode(f.users.memberA, insertCandidate, [f.workspaces.b1, id.runB, "google_places", "x-3"], DENIED);
    await expectCode(f.users.memberA, insertCandidate, [f.workspaces.a1, id.runA, "google_places", ""], CHECK);
  });

  it("a matched company must be in the same workspace", async () => {
    await expectCode(
      f.users.multi,
      "insert into public.discovery_candidates (workspace_id, discovery_run_id, provider_key, external_record_id, match_state, match_company_id) values ($1, $2, 'google_places', 'x-4', 'existing_company', $3)",
      [f.workspaces.b1, id.runB, id.company],
      FK,
    );
    await expectCode(
      f.users.memberA,
      "insert into public.discovery_candidates (workspace_id, discovery_run_id, provider_key, external_record_id, match_state) values ($1, $2, 'google_places', 'x-5', 'existing_company')",
      [f.workspaces.a1, id.runA],
      CHECK,
    );
  });

  it("decisions follow the allowed states; 'selected' requires a linked company", async () => {
    await expectCode(f.users.memberA, "update public.discovery_candidates set decision = 'imported' where id = $1", [id.candA], CHECK);
    await expectCode(f.users.memberA, "update public.discovery_candidates set decision = 'selected' where id = $1", [id.candA], CHECK);
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt<{ decision: string; decided_by: string }>(
        "update public.discovery_candidates set decision = 'needs_enrichment' where id = $1 returning decision, decided_by",
        [id.candA],
      );
      expect(r.ok && r.rows[0]).toEqual({ decision: "needs_enrichment", decided_by: f.users.memberA });
      const [run] = await s.query<{ candidate_count: number; selected_count: number; dismissed_count: number }>(
        "select candidate_count, selected_count, dismissed_count from public.discovery_runs where id = $1",
        [id.runA],
      );
      expect(run).toEqual({ candidate_count: 1, selected_count: 1, dismissed_count: 0 });
    });
  });

  it("the provider id can't be changed after the fact", async () => {
    await expectCode(f.users.memberA, "update public.discovery_candidates set external_record_id = 'other' where id = $1", [id.candA], DENIED);
  });

  it("existing companies are found through durable provider identity in lead_sources", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const rows = await s.query<{ company_id: string }>(
        "select company_id from public.lead_sources where workspace_id = $1 and provider_key = 'google_places' and external_record_id = 'place-linked'",
        [f.workspaces.a1],
      );
      expect(rows.map((r) => r.company_id)).toEqual([id.company]);
    });
    await as(db, user(f.users.ownerB), async (s) => {
      expect(await s.query("select * from public.lead_sources where provider_key = 'google_places'")).toEqual([]);
    });
  });
});

// =============================================================================
describe("provider usage events", () => {
  const insertUsage =
    "insert into public.provider_usage_events (workspace_id, discovery_run_id, provider_key, operation, requested_fields, request_count, result_count, status) values ($1, $2, 'google_places', 'text_search', $3, 1, 3, $4) returning id";

  it("members record usage for their workspace's runs only", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.attempt(insertUsage, [f.workspaces.a1, id.runA, ["places.id"], "ok"])).ok).toBe(true);
    });
    await expectCode(f.users.memberA, insertUsage, [f.workspaces.b1, null, null, "ok"], DENIED);
    await expectCode(f.users.multi, insertUsage, [f.workspaces.a1, id.runB, null, "ok"], FK);
  });

  it("are visible only in their workspace", async () => {
    await db.query(`insert into public.provider_usage_events (workspace_id, provider_key, operation, request_count, status) values ($1, 'google_places', 'text_search', 1, 'ok')`, [f.workspaces.b1]);
    await as(db, user(f.users.memberA), async (s) => {
      expect(await s.query("select * from public.provider_usage_events where workspace_id = $1", [f.workspaces.b1])).toEqual([]);
    });
    await as(db, user(f.users.ownerB), async (s) => {
      expect((await s.query("select * from public.provider_usage_events")).length).toBe(1);
    });
  });

  it("are append-only and validated", async () => {
    await expectCode(f.users.memberA, insertUsage, [f.workspaces.a1, id.runA, null, "great"], CHECK);
    await expectCode(f.users.memberA, "update public.provider_usage_events set request_count = 0", [], DENIED);
    const priv = await db.query<{ cost: boolean; created: boolean }>(
      `select has_column_privilege('authenticated', 'public.provider_usage_events', 'occurred_at', 'insert') as cost,
              has_column_privilege('authenticated', 'public.provider_usage_events', 'created_by', 'insert') as created`,
    );
    expect(priv.rows[0]).toEqual({ cost: false, created: false });
  });
});
