import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createFixture, destroyFixture, openTestDb, type Db, type Fixture } from "./support/db";

/**
 * Data rules for P1-E2: import_batches, import_rows, public.ingest_lead()
 * (one transaction per company/contact/evidence write), stage_import_rows()
 * and list_companies() (Leads pagination + filters). Same API-role method as
 * the other suites; every attempt is rolled back.
 */

const DENIED = "42501";
const CHECK = "23514";
const UNIQUE = "23505";
const FK = "23503";
const STATE = "55000";

let db: Db;
let f: Fixture;
const id = { bA: randomUUID(), bB: randomUUID(), r1: randomUUID(), r2: randomUUID(), rB: randomUUID(), cA: randomUUID() };
const user = (uid: string) => ({ kind: "user" as const, id: uid });

beforeAll(async () => {
  db = await openTestDb();
  f = await createFixture(db);
  const w = f.workspaces;
  await db.query(
    `insert into public.import_batches (id, workspace_id, filename, status, headers, total_rows) values
       ($1, $3, 'a.csv', 'review', '["Company","Email"]', 2),
       ($2, $4, 'b.csv', 'review', '["Company"]', 1)`,
    [id.bA, id.bB, w.a1, w.b1],
  );
  await db.query(
    `insert into public.import_rows (id, workspace_id, import_batch_id, row_number, raw_data) values
       ($1, $4, $5, 1, '["Row One Co","one@example.test"]'),
       ($2, $4, $5, 2, '["Row Two Co",""]'),
       ($3, $6, $7, 1, '["Other Org Co"]')`,
    [id.r1, id.r2, id.rB, w.a1, id.bA, w.b1, id.bB],
  );
  await db.query(
    `insert into public.companies (id, workspace_id, canonical_name, normalized_name, primary_domain) values ($1, $2, 'Existing Co', 'existing co', 'existing.example.test')`,
    [id.cA, w.a1],
  );
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

const ingest = "select public.ingest_lead($1, $2::jsonb, $3::jsonb, $4::jsonb, $5) as r";
const company = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ fields: { canonical_name: name, normalized_name: name.toLowerCase(), ...extra } });

// =============================================================================
describe("import batches and rows", () => {
  it("RLS on both tables, nothing for anon", async () => {
    const rows = await db.query<{ relname: string; rls: boolean; anon: boolean }>(
      `select c.relname, c.relrowsecurity as rls, has_table_privilege('anon', c.oid, 'select, insert, update, delete') as anon
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('import_batches', 'import_rows')`,
    );
    expect(rows.rows.every((r) => r.rls && !r.anon)).toBe(true);
  });

  it("imports are visible only in their workspace", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect((await s.query<{ id: string }>("select id from public.import_batches")).map((r) => r.id)).toEqual([id.bA]);
      expect(new Set((await s.query<{ id: string }>("select id from public.import_rows")).map((r) => r.id))).toEqual(new Set([id.r1, id.r2]));
    });
    await as(db, user(f.users.ownerB), async (s) => {
      expect(await s.query("select * from public.import_rows where import_batch_id = $1", [id.bA])).toEqual([]);
    });
    await as(db, user(f.users.outsider), async (s) => expect(await s.query("select * from public.import_batches")).toEqual([]));
  });

  it("members can create batches in their workspace only; created_by is the caller", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt<{ created_by: string; status: string }>(
        "insert into public.import_batches (workspace_id, filename, headers, total_rows) values ($1, 'x.csv', '[\"A\"]', 1) returning created_by, status",
        [f.workspaces.a1],
      );
      expect(r.ok && r.rows[0]).toEqual({ created_by: f.users.memberA, status: "mapping" });
    });
    await expectCode(f.users.memberA, "insert into public.import_batches (workspace_id, filename, headers) values ($1, 'x.csv', '[\"A\"]')", [f.workspaces.b1], DENIED);
  });

  it("rows stay attached to a batch of the same workspace; row numbers are unique per batch", async () => {
    const insertRow = "insert into public.import_rows (workspace_id, import_batch_id, row_number, raw_data) values ($1, $2, $3, $4::jsonb)";
    await expectCode(f.users.multi, insertRow, [f.workspaces.a1, id.bB, 9, "[]"], FK);
    await expectCode(f.users.memberA, insertRow, [f.workspaces.a1, id.bA, 1, "[]"], UNIQUE);
    await expectCode(f.users.memberA, insertRow, [f.workspaces.a1, id.bA, 3, '{"not":"array"}'], CHECK);
    await expectCode(f.users.memberA, insertRow, [f.workspaces.a1, id.bA, 3, JSON.stringify(["x".repeat(20000)])], CHECK);
    await expectCode(f.users.memberA, "update public.import_rows set import_batch_id = $1 where id = $2", [id.bB, id.r1], DENIED);
  });

  it("status values are validated and a batch completes only from processing", async () => {
    await expectCode(f.users.memberA, "update public.import_batches set status = 'ready' where id = $1", [id.bA], CHECK);
    await expectCode(f.users.memberA, "update public.import_batches set status = 'completed', completed_at = now() where id = $1", [id.bA], STATE);
    await as(db, user(f.users.memberA), async (s) => {
      await s.query("update public.import_batches set status = 'processing' where id = $1", [id.bA]);
      const r = await s.attempt("update public.import_batches set status = 'completed' where id = $1", [id.bA]);
      expect(!r.ok && r.code).toBe(CHECK); // completed needs completed_at
    });
  });

  it("completed and cancelled batches are frozen (rows too), but can be archived", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      await s.query("update public.import_batches set status = 'cancelled' where id = $1", [id.bA]);
      const reopen = await s.attempt("update public.import_batches set status = 'review' where id = $1", [id.bA]);
      expect(!reopen.ok && reopen.code).toBe(STATE);
      const row = await s.attempt("update public.import_rows set decision = 'skip' where id = $1", [id.r1]);
      expect(!row.ok && row.code).toBe(STATE);
      expect((await s.attempt("update public.import_batches set archived_at = now() where id = $1", [id.bA])).ok).toBe(true);
    });
  });

  it("decisions and invalid rows are validated", async () => {
    await expectCode(f.users.memberA, "update public.import_rows set decision = 'overwrite' where id = $1", [id.r1], CHECK);
    await expectCode(f.users.memberA, "update public.import_rows set match_state = 'invalid', decision = 'create' where id = $1", [id.r1], CHECK);
    await expectCode(f.users.memberA, "update public.import_rows set commit_result = 'created' where id = $1", [id.r1], CHECK);
  });

  it("imports in one workspace never touch another workspace's rows", async () => {
    await as(db, user(f.users.multi), async (s) => {
      const n = await s.query<{ n: number }>(
        "select public.stage_import_rows($1, $2, $3::jsonb) as n",
        [f.workspaces.a1, id.bB, JSON.stringify([{ id: id.rB, match_state: "new", decision: "create" }])],
      );
      expect(n[0].n).toBe(0); // batch B belongs to B1, not A1
    });
    const [rb] = (await db.query<{ match_state: string }>("select match_state from public.import_rows where id = $1", [id.rB])).rows;
    expect(rb.match_state).toBe("unprocessed");
  });

  it("stage_import_rows writes the staged results of many rows at once", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const payload = [
        { id: id.r1, normalized_data: { company: { canonicalName: "Row One Co" } }, validation_errors: [], match_state: "new", decision: "create" },
        { id: id.r2, normalized_data: null, validation_errors: [{ level: "error", field: "company_name", message: "x" }], match_state: "invalid", decision: "skip" },
      ];
      const [{ n }] = await s.query<{ n: number }>("select public.stage_import_rows($1, $2, $3::jsonb) as n", [f.workspaces.a1, id.bA, JSON.stringify(payload)]);
      expect(n).toBe(2);
      const rows = await s.query<{ match_state: string }>("select match_state from public.import_rows where import_batch_id = $1 order by row_number", [id.bA]);
      expect(rows.map((r) => r.match_state)).toEqual(["new", "invalid"]);
    });
  });
});

// =============================================================================
describe("ingest_lead (manual entry and row commits)", () => {
  it("creates company + primary contact + manual evidence in one call", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const [{ r }] = await s.query<{ r: { company_id: string; contact_id: string; commit_result: string } }>(ingest, [
        f.workspaces.a1,
        company("Manual Co", { primary_domain: "manual.example.test" }),
        JSON.stringify({ fields: { full_name: "Ana Silva", email: "ana@manual.example.test", normalized_email: "ana@manual.example.test" }, primary_if_none: true }),
        JSON.stringify([
          { subject: "company", field_key: "company.name", observed_value: "Manual Co", source_kind: "manual" },
          { subject: "contact", field_key: "contact.email", observed_value: "ana@manual.example.test", source_kind: "manual" },
        ]),
        null,
      ]);
      expect(r.commit_result).toBe("created");
      const [c] = await s.query<{ is_primary: boolean; company_id: string }>("select is_primary, company_id from public.contacts where id = $1", [r.contact_id]);
      expect(c).toEqual({ is_primary: true, company_id: r.company_id });
      const ev = await s.query<{ source_kind: string; contact_id: string | null; import_batch_id: string | null }>(
        "select source_kind, contact_id, import_batch_id from public.lead_sources where company_id = $1 order by field_key", [r.company_id],
      );
      expect(ev).toEqual([
        { source_kind: "manual", contact_id: null, import_batch_id: null },
        { source_kind: "manual", contact_id: r.contact_id, import_batch_id: null },
      ]);
    });
  });

  it("a second contact is not primary when the company already has one (primary rule kept)", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const first = { fields: { full_name: "P One" }, primary_if_none: true };
      const [{ r }] = await s.query<{ r: { company_id: string } }>(ingest, [f.workspaces.a1, company("Primary Co"), JSON.stringify(first), "[]", null]);
      const [{ r: r2 }] = await s.query<{ r: { contact_id: string } }>(ingest, [
        f.workspaces.a1, JSON.stringify({ id: r.company_id, fields: {} }), JSON.stringify({ fields: { full_name: "P Two" }, primary_if_none: true }), "[]", null,
      ]);
      const [c] = await s.query<{ is_primary: boolean }>("select is_primary from public.contacts where id = $1", [r2.contact_id]);
      expect(c.is_primary).toBe(false);
      const forced = await s.attempt(ingest, [f.workspaces.a1, JSON.stringify({ id: r.company_id, fields: {} }), JSON.stringify({ fields: { full_name: "P Three" }, is_primary: true }), "[]", null]);
      expect(!forced.ok && forced.code).toBe(UNIQUE);
    });
  });

  it("is all-or-nothing: an invalid contact rolls back the company too", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const r = await s.attempt(ingest, [f.workspaces.a1, company("Atomic Co"), JSON.stringify({ fields: { full_name: "X", email: "a@b.test" } }), "[]", null]);
      expect(!r.ok && r.code).toBe(CHECK); // email without normalized_email
      expect(await s.query("select 1 from public.companies where canonical_name = 'Atomic Co'")).toEqual([]);
    });
  });

  it("respects RLS and workspace boundaries (invoker rights)", async () => {
    await expectCode(f.users.memberA, ingest, [f.workspaces.b1, company("Injected"), null, "[]", null], DENIED);
    await expectCode(f.users.multi, ingest, [f.workspaces.b1, JSON.stringify({ id: id.cA, fields: { notes: "x" } }), null, "[]", null], DENIED);
    await expectCode(f.users.memberA, ingest, [f.workspaces.a1, company("Dup Domain", { primary_domain: "existing.example.test" }), null, "[]", null], UNIQUE);
    await as(db, { kind: "anon" }, async (s) => {
      const r = await s.attempt(ingest, [f.workspaces.a1, company("Anon"), null, "[]", null]);
      expect(r.ok).toBe(false);
    });
  });

  it("merging fills only the given columns", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      await s.query(ingest, [f.workspaces.a1, JSON.stringify({ id: id.cA, fields: { website_url: "https://existing.example.test" } }), null, "[]", null]);
      const [c] = await s.query<{ canonical_name: string; website_url: string; primary_domain: string }>(
        "select canonical_name, website_url, primary_domain from public.companies where id = $1", [id.cA],
      );
      expect(c).toEqual({ canonical_name: "Existing Co", website_url: "https://existing.example.test", primary_domain: "existing.example.test" });
    });
  });

  it("a row commit needs a processing batch, records its outcome and traceable CSV evidence, and never commits twice", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const call = [
        f.workspaces.a1, company("Row One Co"), null,
        JSON.stringify([{ subject: "company", field_key: "company.name", observed_value: "Row One Co", source_kind: "csv" }]), id.r1,
      ];
      const early = await s.attempt(call.length ? ingest : "", call);
      expect(!early.ok && early.code).toBe(STATE); // batch still in review

      await s.query("update public.import_batches set status = 'processing' where id = $1", [id.bA]);
      const [{ r }] = await s.query<{ r: { company_id: string; already_committed: boolean } }>(ingest, call);
      expect(r.already_committed).toBe(false);
      const [row] = await s.query<{ commit_result: string; committed_company_id: string }>(
        "select commit_result, committed_company_id from public.import_rows where id = $1", [id.r1],
      );
      expect(row).toEqual({ commit_result: "created", committed_company_id: r.company_id });
      const [ev] = await s.query<{ source_kind: string; import_batch_id: string; import_row_id: string }>(
        "select source_kind, import_batch_id, import_row_id from public.lead_sources where company_id = $1", [r.company_id],
      );
      expect(ev).toEqual({ source_kind: "csv", import_batch_id: id.bA, import_row_id: id.r1 });

      // Retry: nothing new is written; the recorded outcome comes back.
      const [{ r: again }] = await s.query<{ r: { already_committed: boolean; company_id: string } }>(ingest, call);
      expect(again).toMatchObject({ already_committed: true, company_id: r.company_id });
      expect(await s.query("select 1 from public.companies where canonical_name = 'Row One Co'")).toHaveLength(1);

      // A committed row is frozen.
      const tamper = await s.attempt("update public.import_rows set commit_result = 'skipped' where id = $1", [id.r1]);
      expect(!tamper.ok && tamper.code).toBe(STATE);

      // Finishing the batch.
      expect((await s.attempt("update public.import_batches set status = 'completed', completed_at = now() where id = $1", [id.bA])).ok).toBe(true);
    });
  });

  it("evidence can only point at an import of the same workspace", async () => {
    await expectCode(
      f.users.multi,
      "insert into public.lead_sources (workspace_id, company_id, source_kind, import_batch_id) values ($1, $2, 'csv', $3)",
      [f.workspaces.a1, id.cA, id.bB],
      FK,
    );
  });
});

// =============================================================================
describe("list_companies (Leads pagination and filters)", () => {
  const list = (args: Partial<Record<string, unknown>> = {}) => [
    args.ws ?? f.workspaces.a2, args.qualification ?? null, args.grade ?? null, args.restricted ?? null, args.contact ?? null,
    args.country ?? null, args.sort ?? "updated", args.limit ?? 25, args.offset ?? 0,
  ];
  const sql = "select * from public.list_companies($1, $2, $3, $4, $5, $6, $7, $8, $9)";

  beforeAll(async () => {
    const ws = f.workspaces.a2;
    const values = Array.from({ length: 30 }, (_, i) => {
      const n = String(i + 1).padStart(2, "0");
      return `('${randomUUID()}', '${ws}', 'Company ${n}', 'company ${n}', ${i < 3 ? "'qualified'" : "'unreviewed'"}, ${i % 2 ? `'{"countryCode":"DE"}'` : `'{"countryCode":"JP"}'`}, now() - interval '${i} hours')`;
    });
    await db.query(`insert into public.companies (id, workspace_id, canonical_name, normalized_name, qualification_state, location, updated_at) values ${values.join(",")}`);
    const [{ id: c01 }] = (await db.query<{ id: string }>("select id from public.companies where workspace_id = $1 and canonical_name = 'Company 01'", [ws])).rows;
    const [{ id: c02 }] = (await db.query<{ id: string }>("select id from public.companies where workspace_id = $1 and canonical_name = 'Company 02'", [ws])).rows;
    await db.query("insert into public.contacts (workspace_id, company_id, full_name) values ($1, $2, 'Someone')", [ws, c01]);
    await db.query("insert into public.suppression_records (workspace_id, company_id, scope) values ($1, $2, 'company')", [ws, c02]);
    const icp = randomUUID();
    await db.query("insert into public.icp_profiles (id, workspace_id, name, is_default) values ($1, $2, 'P', true)", [icp, ws]);
    // P1-E6: a current result carries the fingerprint of the current scoring inputs.
    await db.query(
      "insert into public.lead_scores (workspace_id, company_id, icp_profile_id, icp_revision, score, grade, status, scored_at, input_fingerprint, coverage_percent) values ($1, $2, $3, 1, 90, 'A', 'scored', now(), public.scoring_input($1, $2, $3) ->> 'fingerprint', 80)",
      [ws, c02, icp],
    );
  });

  it("pages through results with a total count; an out-of-range page is empty", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const p1 = await s.query<{ canonical_name: string; total_count: string }>(sql, list());
      expect(p1).toHaveLength(25);
      expect(Number(p1[0].total_count)).toBe(30);
      expect(p1[0].canonical_name).toBe("Company 01"); // most recently updated first
      expect(await s.query(sql, list({ offset: 25 }))).toHaveLength(5);
      expect(await s.query(sql, list({ offset: 50 }))).toEqual([]);
      expect(await s.query(sql, list({ limit: 1000 }))).toHaveLength(30); // clamped to 100
    });
  });

  it("filters by qualification, restriction, contacts, country and grade", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const names = async (a: Partial<Record<string, unknown>>) => (await s.query<{ canonical_name: string }>(sql, list({ ...a, sort: "name", limit: 100 }))).map((r) => r.canonical_name);
      expect(await names({ qualification: "qualified" })).toEqual(["Company 01", "Company 02", "Company 03"]);
      expect(await names({ restricted: true })).toEqual(["Company 02"]);
      expect((await names({ restricted: false })).length).toBe(29);
      expect(await names({ contact: true })).toEqual(["Company 01"]);
      expect((await names({ country: "DE" })).length).toBe(15);
      expect(await names({ grade: "A" })).toEqual(["Company 02"]);
      expect((await names({ grade: "none" })).length).toBe(29);
    });
  });

  it("sorts by name, qualification and grade", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const first = async (sort: string) => (await s.query<{ canonical_name: string }>(sql, list({ sort, limit: 1 })))[0].canonical_name;
      expect(await first("name")).toBe("Company 01");
      expect(await first("qualification")).toBe("Company 01");
      expect(await first("grade")).toBe("Company 02");
    });
  });

  it("returns nothing for a workspace the caller doesn't belong to", async () => {
    await as(db, user(f.users.ownerB), async (s) => expect(await s.query(sql, list())).toEqual([]));
  });
});
