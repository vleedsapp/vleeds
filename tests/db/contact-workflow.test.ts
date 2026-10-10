import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayBounds } from "@/lib/contact-workflow/time";
import { as, createFixture, destroyFixture, openTestDb, type Db, type Fixture, type Session } from "./support/db";

/**
 * Data rules for P1-E7: workspaces.timezone, contact_attempts (append-only
 * history), follow_up_tasks (one open task per contact), the workflow
 * functions (record_contact_attempt, schedule/reschedule/complete/cancel) and
 * the Today reads (today_ready_candidates, today_due_tasks). Fictional data;
 * every block is rolled back.
 */

const DENIED = "42501";
const CHECK = "23514";
const INVALID = "22023";
const RESTRICTED = "VL001";
const NOT_CONTACTABLE = "VL002";
const TASK_CLOSED = "VL003";
const TASK_EXISTS = "VL004";

let db: Db;
let f: Fixture;
const id = {
  icp: randomUUID(),
  coA: randomUUID(), // current A
  coB: randomUUID(), // current B
  coC: randomUUID(), // current C
  coX: randomUUID(), // excluded
  coOut: randomUUID(), // outdated
  coNone: randomUUID(), // not scored
  coForeign: randomUUID(), // workspace B1
  kLead: randomUUID(), // coA, primary role, phone
  kSecond: randomUUID(), // coA, secondary role, phone
  kNoPhone: randomUUID(), // coA, no phone
  kLeft: randomUUID(), // coA, left the company
  kB: randomUUID(), // coB
  kForeign: randomUUID(),
};
const user = (uid: string) => ({ kind: "user" as const, id: uid });
const future = (hours = 24) => new Date(Date.now() + hours * 3_600_000).toISOString();
const past = (hours = 2) => new Date(Date.now() - hours * 3_600_000).toISOString();

const scoringModel = { thresholds: { a: 75, b: 50 }, categoryWeights: { company_fit: 40, geography_fit: 20, decision_maker_fit: 20, buying_signal_fit: 20 } };
const SAVE =
  "select public.save_lead_score_trusted($1, $2, $3, $4, 1, public.scoring_input($2, $3, $4) ->> 'fingerprint', $5, $6, $7, '{}'::jsonb, 80, '{}'::jsonb, '{}'::jsonb, $8::jsonb)";

beforeAll(async () => {
  db = await openTestDb();
  f = await createFixture(db);
  const a1 = f.workspaces.a1;
  await db.query(
    `insert into public.icp_profiles (id, workspace_id, name, is_default, ideal_customer, decision_maker_titles, scoring_model)
     values ($1, $2, 'Default', true, $3::jsonb, $4::jsonb, $5::jsonb)`,
    [
      id.icp,
      a1,
      JSON.stringify({ industries: ["Field services"], companySize: null, characteristics: [], keywords: [], notes: null }),
      JSON.stringify([
        { id: randomUUID(), title: "Operations Director", priority: "primary", seniority: null },
        { id: randomUUID(), title: "Office Manager", priority: "secondary", seniority: null },
      ]),
      JSON.stringify(scoringModel),
    ],
  );
  const companies: [string, string, string][] = [
    [id.coA, a1, "Alder Works"],
    [id.coB, a1, "Birch Supply"],
    [id.coC, a1, "Cobalt Studio"],
    [id.coX, a1, "Excluded Co"],
    [id.coOut, a1, "Outdated Co"],
    [id.coNone, a1, "Unscored Co"],
    [id.coForeign, f.workspaces.b1, "Foreign Co"],
  ];
  for (const [cid, ws, name] of companies) {
    await db.query("insert into public.companies (id, workspace_id, canonical_name, normalized_name, industry) values ($1, $2, $3, lower($3), 'Field services')", [cid, ws, name]);
  }
  await db.query(
    `insert into public.contacts (id, workspace_id, company_id, full_name, job_title, phone, is_primary, status) values
       ($1, $7, $8, 'Lee Park', 'Operations Director', '+1 555 0100', false, 'active'),
       ($2, $7, $8, 'Sam Reed', 'Office Manager', '+1 555 0101', true, 'active'),
       ($3, $7, $8, 'No Phone', 'Office Manager', null, false, 'active'),
       ($4, $7, $8, 'Gone Person', 'Operations Director', '+1 555 0102', false, 'left_company'),
       ($5, $7, $9, 'Bea Lund', 'Owner', '+1 555 0200', true, 'active'),
       ($6, $10, $11, 'Far Away', 'Owner', '+1 555 0300', true, 'active')`,
    [id.kLead, id.kSecond, id.kNoPhone, id.kLeft, id.kB, id.kForeign, a1, id.coA, id.coB, f.workspaces.b1, id.coForeign],
  );
  // Results written the way the server does: through the trusted function.
  const save = (company: string, status: string, score: number | null, grade: string | null, reasons: unknown = null) =>
    db.query(SAVE, [f.users.ownerA, a1, company, id.icp, status, score, grade, reasons === null ? null : JSON.stringify(reasons)]);
  await save(id.coA, "scored", 82, "A");
  await save(id.coB, "scored", 60, "B");
  await save(id.coC, "scored", 30, "C");
  await save(id.coX, "excluded", null, null, [{ id: "x", name: "Consumer-only" }]);
  await save(id.coOut, "scored", 90, "A");
  await db.query("update public.companies set description = 'Changed after scoring' where id = $1", [id.coOut]);
}, 180_000);

afterAll(async () => {
  if (db && f) await destroyFixture(db, f);
  await db?.close();
});

const RECORD =
  "select public.record_contact_attempt($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) as r";
type Rec = {
  company?: string;
  contact?: string;
  request?: string;
  disposition: string;
  note?: string | null;
  sourceTask?: string | null;
  nextKind?: string | null;
  nextDue?: string | null;
  nextNote?: string | null;
  scope?: string | null;
  reason?: string | null;
  workspace?: string;
};
const recArgs = (o: Rec) => [
  o.workspace ?? f.workspaces.a1,
  o.company ?? id.coA,
  o.contact ?? id.kLead,
  o.request ?? randomUUID(),
  o.disposition,
  o.note ?? null,
  o.sourceTask ?? null,
  o.nextKind ?? null,
  o.nextDue ?? null,
  o.nextNote ?? null,
  o.scope ?? null,
  o.reason ?? null,
];
type RecResult = { attempt_id: string; task_id: string | null; replayed: boolean };
const record = async (s: Session, o: Rec): Promise<RecResult> => (await s.query<{ r: RecResult }>(RECORD, recArgs(o)))[0].r;
const SCHEDULE = "select public.schedule_follow_up($1, $2, $3, $4, $5, $6) as id";
const schedule = async (s: Session, contact: string, kind = "follow_up", due = future(), company = id.coA) =>
  (await s.query<{ id: string }>(SCHEDULE, [f.workspaces.a1, company, contact, kind, due, null]))[0].id;
const code = async (s: Session, sql: string, params: unknown[]) => {
  const r = await s.attempt(sql, params);
  return r.ok ? "ok" : r.code;
};

// =============================================================================
describe("workspace timezone", () => {
  it("defaults to UTC; owners/admins may change it to a known IANA zone; members can read but not change it", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect(await s.query("select timezone from public.workspaces where id = $1", [f.workspaces.a1])).toEqual([{ timezone: "UTC" }]);
      const r = await s.attempt("update public.workspaces set timezone = 'Europe/London' where id = $1", [f.workspaces.a1]);
      expect(r.ok && r.affectedRows).toBe(0);
    });
    await as(db, user(f.users.adminA), async (s) => {
      const r = await s.attempt("update public.workspaces set timezone = 'America/Chicago' where id = $1", [f.workspaces.a1]);
      expect(r.ok && r.affectedRows).toBe(1);
      for (const bad of ["Mars/Base", "+05:00", "", "x".repeat(65)]) {
        expect(await code(s, "update public.workspaces set timezone = $2 where id = $1", [f.workspaces.a1, bad]), bad).toBe(CHECK);
      }
    });
  });
});

// =============================================================================
describe("contact_attempts and follow_up_tasks tables", () => {
  it("RLS on; API roles may only read; no anon access", async () => {
    const r = await db.query<{ relname: string; rls: boolean; sel: boolean; ins: boolean; upd: boolean; del: boolean; anon: boolean }>(
      `select c.relname, c.relrowsecurity as rls,
              has_table_privilege('authenticated', c.oid, 'select') as sel, has_table_privilege('authenticated', c.oid, 'insert') as ins,
              has_table_privilege('authenticated', c.oid, 'update') as upd, has_table_privilege('authenticated', c.oid, 'delete') as del,
              has_table_privilege('anon', c.oid, 'select') as anon
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('contact_attempts', 'follow_up_tasks') order by c.relname`,
    );
    expect(r.rows).toEqual([
      { relname: "contact_attempts", rls: true, sel: true, ins: false, upd: false, del: false, anon: false },
      { relname: "follow_up_tasks", rls: true, sel: true, ins: false, upd: false, del: false, anon: false },
    ]);
  });

  it("attempt history can't be edited or deleted through the API; even the trusted role can't edit it", async () => {
    await as(db, user(f.users.ownerA), async (s) => {
      const r = await record(s, { disposition: "no_answer" });
      expect(await code(s, "update public.contact_attempts set disposition = 'other' where id = $1", [r.attempt_id])).toBe(DENIED);
      expect(await code(s, "delete from public.contact_attempts where id = $1", [r.attempt_id])).toBe(DENIED);
      await s.query("set local role service_role");
      expect(await code(s, "update public.contact_attempts set note = 'edited' where id = $1", [r.attempt_id])).toBe(DENIED);
    });
  });

  it("task status/timestamps stay consistent and relationships stay within the contact", async () => {
    await db.exec("begin");
    let n = 0;
    // Each refused statement runs in its own savepoint so the next one can run.
    const fails = async (sql: string, params: unknown[], code: string) => {
      const sp = `sp_${++n}`;
      await db.exec(`savepoint ${sp}`);
      await expect(db.query(sql, params), sql).rejects.toMatchObject({ code });
      await db.exec(`rollback to savepoint ${sp}`);
    };
    try {
      const task =
        "insert into public.follow_up_tasks (workspace_id, company_id, contact_id, kind, due_at, status, completed_at, cancelled_at) values ($1, $2, $3, 'callback', now(), $4, $5, $6)";
      await fails(task, [f.workspaces.a1, id.coA, id.kSecond, "completed", null, null], CHECK);
      await fails(task, [f.workspaces.a1, id.coA, id.kSecond, "open", new Date().toISOString(), null], CHECK);
      await fails(task, [f.workspaces.a1, id.coA, id.kSecond, "waiting", null, null], CHECK);
      // a contact from another company can't be attached to this company
      await fails("insert into public.follow_up_tasks (workspace_id, company_id, contact_id, kind, due_at) values ($1, $2, $3, 'callback', now())", [f.workspaces.a1, id.coB, id.kLead], "23503");
      // source attempt must be the same contact's
      const [{ id: attempt }] = (
        await db.query<{ id: string }>(
          "insert into public.contact_attempts (workspace_id, company_id, contact_id, request_id, disposition) values ($1, $2, $3, gen_random_uuid(), 'no_answer') returning id",
          [f.workspaces.a1, id.coA, id.kLead],
        )
      ).rows;
      await fails(
        "insert into public.follow_up_tasks (workspace_id, company_id, contact_id, source_attempt_id, kind, due_at) values ($1, $2, $3, $4, 'callback', now())",
        [f.workspaces.a1, id.coA, id.kSecond, attempt],
        "23503",
      );
      // channel and disposition are controlled; "other" needs a note
      const att = "insert into public.contact_attempts (workspace_id, company_id, contact_id, request_id, channel, disposition) values ($1, $2, $3, gen_random_uuid(), $4, $5)";
      await fails(att, [f.workspaces.a1, id.coA, id.kLead, "sms", "no_answer"], CHECK);
      await fails(att, [f.workspaces.a1, id.coA, id.kLead, "phone", "other"], CHECK);
      await fails(att, [f.workspaces.a1, id.coA, id.kLead, "phone", "voicemail_full"], CHECK);
      // one open task per contact is enforced by the table itself, not only by the functions
      await db.query(task, [f.workspaces.a1, id.coA, id.kSecond, "open", null, null]);
      await fails(task, [f.workspaces.a1, id.coA, id.kSecond, "open", null, null], "23505");
      await db.query(task, [f.workspaces.a1, id.coA, id.kSecond, "cancelled", null, new Date().toISOString()]); // history is fine
    } finally {
      await db.exec("rollback");
    }
  });
});

// =============================================================================
describe("record_contact_attempt", () => {
  it("appends an attempt as the caller with server time; a resubmitted request returns the same attempt", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const request = randomUUID();
      const first = await record(s, { disposition: "no_answer", note: "Rang out", request });
      const again = await record(s, { disposition: "no_answer", note: "Rang out", request });
      expect(again).toEqual({ attempt_id: first.attempt_id, task_id: null, replayed: true });
      const rows = await s.query<{ created_by: string; channel: string; disposition: string; fresh: boolean }>(
        "select created_by, channel, disposition, abs(extract(epoch from now() - attempted_at)) < 60 as fresh from public.contact_attempts where request_id = $1",
        [request],
      );
      expect(rows).toEqual([{ created_by: f.users.memberA, channel: "phone", disposition: "no_answer", fresh: true }]);
      expect(await code(s, RECORD, recArgs({ disposition: "no_answer", request, contact: id.kSecond }))).toBe(INVALID);
    });
  });

  it("enforces each outcome's requirements", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const cases: [Rec, string][] = [
        [{ disposition: "voicemail_full" }, INVALID],
        [{ disposition: "callback_requested" }, INVALID], // needs a due time
        [{ disposition: "follow_up_needed", nextKind: "follow_up" }, INVALID], // kind without time
        [{ disposition: "callback_requested", nextKind: "follow_up", nextDue: future() }, INVALID], // wrong kind
        [{ disposition: "callback_requested", nextKind: "callback", nextDue: past() }, INVALID], // must be in the future
        [{ disposition: "other" }, INVALID], // needs a note
        [{ disposition: "do_not_contact" }, INVALID], // needs a scope
        [{ disposition: "do_not_contact", scope: "everyone" }, INVALID],
        [{ disposition: "no_answer", scope: "contact" }, INVALID], // only do-not-contact restricts
        [{ disposition: "connected_not_interested", nextKind: "follow_up", nextDue: future() }, INVALID],
        [{ disposition: "wrong_number", nextKind: "retry_call", nextDue: future() }, INVALID],
        [{ disposition: "no_answer", note: "x".repeat(1001) }, CHECK],
      ];
      for (const [o, expected] of cases) expect(await code(s, RECORD, recArgs(o)), JSON.stringify(o)).toBe(expected);
    });
  });

  it("callback requested / follow-up needed / optional retry create the next task from the attempt", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const due = future(30);
      const r = await record(s, { disposition: "callback_requested", nextKind: "callback", nextDue: due, nextNote: "Ask about Q3" });
      const [task] = await s.query<{ kind: string; status: string; source_attempt_id: string; note: string; created_by: string; same: boolean }>(
        "select kind, status, source_attempt_id, note, created_by, due_at = $2::timestamptz as same from public.follow_up_tasks where id = $1",
        [r.task_id, due],
      );
      expect(task).toEqual({ kind: "callback", status: "open", source_attempt_id: r.attempt_id, note: "Ask about Q3", created_by: f.users.memberA, same: true });
      // optional retry after no answer on another contact
      const retry = await record(s, { contact: id.kSecond, disposition: "no_answer", nextKind: "retry_call", nextDue: future(48) });
      expect(retry.task_id).not.toBeNull();
      const noRetry = await record(s, { contact: id.kB, company: id.coB, disposition: "left_voicemail" });
      expect(noRetry.task_id).toBeNull();
    });
  });

  it("logging from a due task completes it; a new next task replaces any other open task; one open task per contact", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const t1 = await schedule(s, id.kLead, "callback");
      expect(await code(s, SCHEDULE, [f.workspaces.a1, id.coA, id.kLead, "follow_up", future(), null])).toBe(TASK_EXISTS);
      const r = await record(s, { disposition: "follow_up_needed", sourceTask: t1, nextKind: "follow_up", nextDue: future(72) });
      const tasks = await s.query<{ id: string; status: string; completed_by: string | null }>(
        "select id, status, completed_by from public.follow_up_tasks where contact_id = $1 order by created_at, status",
        [id.kLead],
      );
      expect(tasks).toEqual([
        { id: t1, status: "completed", completed_by: f.users.memberA },
        { id: r.task_id, status: "open", completed_by: null },
      ]);
      const [att] = await s.query<{ source_task_id: string }>("select source_task_id from public.contact_attempts where id = $1", [r.attempt_id]);
      expect(att.source_task_id).toBe(t1);
      // the completed task can't be used again
      expect(await code(s, RECORD, recArgs({ disposition: "no_answer", sourceTask: t1 }))).toBe(TASK_CLOSED);
      // a source task must be this contact's
      const other = await schedule(s, id.kSecond, "callback");
      expect(await code(s, RECORD, recArgs({ disposition: "no_answer", sourceTask: other }))).toBe(TASK_CLOSED);
      // scheduling a next action while another task is open (not the source) replaces it
      await record(s, { disposition: "connected_interested", nextKind: "follow_up", nextDue: future(96) });
      expect((await s.query("select 1 from public.follow_up_tasks where contact_id = $1 and status = 'open'", [id.kLead])).length).toBe(1);
      expect((await s.query("select 1 from public.follow_up_tasks where id = $1 and status = 'cancelled'", [r.task_id])).length).toBe(1);
    });
  });

  it("do not contact (this person): creates the contact restriction and cancels only that contact's task", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const mine = await schedule(s, id.kLead);
      const theirs = await schedule(s, id.kSecond);
      await record(s, { disposition: "do_not_contact", scope: "contact", reason: "Asked on the call" });
      expect(await s.query("select scope, contact_id, reason, created_by from public.suppression_records where company_id = $1 and active", [id.coA])).toEqual([
        { scope: "contact", contact_id: id.kLead, reason: "Asked on the call", created_by: f.users.memberA },
      ]);
      expect(await s.query("select id, status from public.follow_up_tasks where id = any($1::uuid[]) order by status", [[mine, theirs]])).toEqual([
        { id: mine, status: "cancelled" },
        { id: theirs, status: "open" },
      ]);
      expect(await code(s, RECORD, recArgs({ disposition: "no_answer" }))).toBe(RESTRICTED);
      expect(await code(s, SCHEDULE, [f.workspaces.a1, id.coA, id.kLead, "callback", future(), null])).toBe(RESTRICTED);
      expect(await code(s, RECORD, recArgs({ disposition: "do_not_contact", scope: "contact" }))).toBe(RESTRICTED); // already restricted
    });
  });

  it("do not contact (entire company): company restriction; every open task at the company is cancelled", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const a = await schedule(s, id.kLead);
      const b = await schedule(s, id.kSecond);
      await record(s, { contact: id.kSecond, disposition: "do_not_contact", scope: "company" });
      expect(await s.query("select scope, contact_id from public.suppression_records where company_id = $1 and active", [id.coA])).toEqual([{ scope: "company", contact_id: null }]);
      expect((await s.query("select 1 from public.follow_up_tasks where id = any($1::uuid[]) and status = 'cancelled'", [[a, b]])).length).toBe(2);
      expect(await code(s, RECORD, recArgs({ disposition: "no_answer" }))).toBe(RESTRICTED);
      // only owners/admins may lift it (existing rule)
      const lift = await s.attempt("update public.suppression_records set active = false where company_id = $1", [id.coA]);
      expect(lift.ok && lift.affectedRows).toBe(0);
    });
  });

  it("refuses contacts that left, have no phone, belong elsewhere, or another workspace", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      expect(await code(s, RECORD, recArgs({ contact: id.kLeft, disposition: "no_answer" }))).toBe(NOT_CONTACTABLE);
      expect(await code(s, RECORD, recArgs({ contact: id.kNoPhone, disposition: "no_answer" }))).toBe(NOT_CONTACTABLE);
      expect(await code(s, SCHEDULE, [f.workspaces.a1, id.coA, id.kNoPhone, "callback", future(), null])).toBe(NOT_CONTACTABLE);
      // "Do not contact" is still possible for a contact without a phone (it only adds a restriction)
      expect(await code(s, RECORD, recArgs({ contact: id.kNoPhone, disposition: "do_not_contact", scope: "contact" }))).toBe("ok");
      expect(await code(s, RECORD, recArgs({ company: id.coB, contact: id.kLead, disposition: "no_answer" }))).toBe(DENIED); // wrong company
      expect(await code(s, RECORD, recArgs({ workspace: f.workspaces.b1, company: id.coForeign, contact: id.kForeign, disposition: "no_answer" }))).toBe(DENIED);
    });
    await as(db, user(f.users.outsider), async (s) => {
      expect(await code(s, RECORD, recArgs({ disposition: "no_answer" }))).toBe(DENIED);
    });
    await as(db, { kind: "anon" }, async (s) => {
      expect(await code(s, RECORD, recArgs({ disposition: "no_answer" }))).toBe(DENIED);
    });
  });
});

// =============================================================================
describe("task management", () => {
  it("reschedule keeps the task's identity, creator and created_at; complete and cancel keep history", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const t = await schedule(s, id.kLead, "callback");
      const [before] = await s.query<{ created_at: string; created_by: string }>("select created_at, created_by from public.follow_up_tasks where id = $1", [t]);
      const due = future(50);
      await s.query("select public.reschedule_follow_up($1, $2, $3)", [f.workspaces.a1, t, due]);
      const [after] = await s.query<{ created_at: string; created_by: string; same: boolean; status: string }>(
        "select created_at, created_by, due_at = $2::timestamptz as same, status from public.follow_up_tasks where id = $1",
        [t, due],
      );
      expect(after).toEqual({ ...before, same: true, status: "open" });
      expect(await code(s, "select public.reschedule_follow_up($1, $2, $3)", [f.workspaces.a1, t, past()])).toBe(INVALID);
      await s.query("select public.complete_follow_up($1, $2)", [f.workspaces.a1, t]);
      expect(await s.query("select status, completed_by from public.follow_up_tasks where id = $1", [t])).toEqual([{ status: "completed", completed_by: f.users.memberA }]);
      expect(await code(s, "select public.cancel_follow_up($1, $2)", [f.workspaces.a1, t])).toBe(TASK_CLOSED);
      expect(await code(s, "select public.reschedule_follow_up($1, $2, $3)", [f.workspaces.a1, t, future()])).toBe(TASK_CLOSED);
      // completing records no attempt
      expect((await s.query("select 1 from public.contact_attempts where source_task_id = $1", [t])).length).toBe(0);
      const t2 = await schedule(s, id.kLead, "follow_up");
      await s.query("select public.cancel_follow_up($1, $2)", [f.workspaces.a1, t2]);
      expect(await s.query("select status, cancelled_by from public.follow_up_tasks where id = $1", [t2])).toEqual([{ status: "cancelled", cancelled_by: f.users.memberA }]);
    });
  });

  it("restricted targets can't be rescheduled, but blocked tasks can still be cancelled", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const t = await schedule(s, id.kSecond, "callback");
      await s.query("insert into public.suppression_records (workspace_id, company_id, contact_id, scope) values ($1, $2, $3, 'contact')", [f.workspaces.a1, id.coA, id.kSecond]);
      expect(await code(s, "select public.reschedule_follow_up($1, $2, $3)", [f.workspaces.a1, t, future(5)])).toBe(RESTRICTED);
      expect(await code(s, "select public.cancel_follow_up($1, $2)", [f.workspaces.a1, t])).toBe("ok");
    });
    await as(db, user(f.users.ownerB), async (s) => {
      expect(await code(s, SCHEDULE, [f.workspaces.a1, id.coA, id.kLead, "callback", future(), null])).toBe(DENIED);
    });
  });
});

// =============================================================================
describe("Today reads", () => {
  type Candidate = { company_id: string; grade: string; score: number; contacts: { id: string; restricted: boolean; open_task_due_at: string | null; latest_attempt: { disposition: string } | null }[]; last_attempt: { disposition: string; contact_name: string } | null };
  const candidates = (s: Session) =>
    s.query<Candidate>("select company_id, grade, score, contacts, last_attempt from public.today_ready_candidates($1)", [f.workspaces.a1]);

  it("ready candidates: only CURRENT A/B results of the default ICP, best first, with contact facts", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const rows = await candidates(s);
      expect(rows.map((r) => [r.company_id, r.grade, r.score])).toEqual([
        [id.coA, "A", 82],
        [id.coB, "B", 60],
      ]); // C, Excluded, Outdated and Not scored are absent
      await record(s, { disposition: "no_answer" });
      const t = await schedule(s, id.kSecond, "callback");
      await s.query("insert into public.suppression_records (workspace_id, company_id, contact_id, scope) values ($1, $2, $3, 'contact')", [f.workspaces.a1, id.coA, id.kNoPhone]);
      const [a] = await candidates(s);
      const by = Object.fromEntries(a.contacts.map((c) => [c.id, c]));
      expect(by[id.kLead].latest_attempt?.disposition).toBe("no_answer");
      expect(by[id.kSecond].open_task_due_at).not.toBeNull();
      expect(by[id.kNoPhone].restricted).toBe(true);
      expect(a.last_attempt).toMatchObject({ disposition: "no_answer", contact_name: "Lee Park" });
      expect(t).toBeTruthy();
    });
    await as(db, user(f.users.ownerB), async (s) => expect(await s.query("select * from public.today_ready_candidates($1)", [f.workspaces.a1])).toEqual([]));
  });

  it("ready candidates follow currentness: a data change drops the company until it is re-evaluated", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      await s.query("update public.companies set description = 'New facts' where id = $1", [id.coB]);
      expect((await candidates(s)).map((r) => r.company_id)).toEqual([id.coA]);
    });
  });

  it("due tasks: open tasks before the given instant, with blocking facts; future and closed tasks excluded", async () => {
    await db.exec("begin");
    try {
      const insert = async (contact: string, company: string, due: string, status = "open") =>
        (
          await db.query<{ id: string }>(
            `insert into public.follow_up_tasks (workspace_id, company_id, contact_id, kind, due_at, status, completed_at)
             values ($1, $2, $3, 'callback', $4, $5, case when $5 = 'completed' then now() end) returning id`,
            [f.workspaces.a1, company, contact, due, status],
          )
        ).rows[0].id;
      const overdue = await insert(id.kLead, id.coA, past(30));
      const dueLeft = await insert(id.kLeft, id.coA, past(1));
      await insert(id.kSecond, id.coA, future(48));
      await insert(id.kB, id.coB, past(3), "completed");
      await db.query("insert into public.suppression_records (workspace_id, company_id, scope) values ($1, $2, 'company')", [f.workspaces.a1, id.coA]);
      await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: f.users.memberA, role: "authenticated" })]);
      const rows = (
        await db.query<{ id: string; company_restricted: boolean; contact_status: string }>(
          "select id, company_restricted, contact_status from public.today_due_tasks($1, $2)",
          [f.workspaces.a1, future(1)],
        )
      ).rows;
      expect(rows).toEqual([
        { id: overdue, company_restricted: true, contact_status: "active" },
        { id: dueLeft, company_restricted: true, contact_status: "left_company" },
      ]);
    } finally {
      await db.exec("rollback");
    }
  });

  it("contacted today uses the workspace-local day (attempts just before local midnight belong to yesterday)", async () => {
    const now = new Date();
    for (const tz of ["UTC", "America/Chicago", "Asia/Kolkata"]) {
      const { start, end } = dayBounds(now, tz);
      await db.exec("begin");
      try {
        const add = (at: Date) =>
          db.query(
            "insert into public.contact_attempts (workspace_id, company_id, contact_id, request_id, disposition, attempted_at) values ($1, $2, $3, gen_random_uuid(), 'no_answer', $4)",
            [f.workspaces.a1, id.coB, id.kB, at.toISOString()],
          );
        await add(new Date(start.getTime() - 60_000)); // 23:59 yesterday (local)
        await add(start); // 00:00 today (local)
        await add(new Date(end.getTime() - 60_000)); // 23:59 today
        await add(end); // 00:00 tomorrow
        const r = await db.query<{ n: number }>(
          "select count(*)::int as n from public.contact_attempts where workspace_id = $1 and attempted_at >= $2 and attempted_at < $3",
          [f.workspaces.a1, start.toISOString(), end.toISOString()],
        );
        expect(r.rows[0].n, tz).toBe(2);
      } finally {
        await db.exec("rollback");
      }
    }
  });

  it("attempts and tasks are not scoring inputs: the fingerprint doesn't change", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const fp = async () => (await s.query<{ fp: string }>("select public.scoring_input($1, $2, $3) ->> 'fingerprint' as fp", [f.workspaces.a1, id.coA, id.icp]))[0].fp;
      const before = await fp();
      await record(s, { disposition: "connected_interested", nextKind: "follow_up", nextDue: future() });
      await record(s, { contact: id.kSecond, disposition: "wrong_number" });
      expect(await fp()).toBe(before);
      // and the stored grade is still current
      expect((await candidates(s)).map((r) => r.company_id)).toContain(id.coA);
    });
  });
});

// =============================================================================
describe("Refresh lead scores (batch selection)", () => {
  it("selects unscored and outdated companies (not current or excluded); new results reach Today immediately", async () => {
    await as(db, user(f.users.memberA), async (s) => {
      const pick = async (state: string) =>
        (await s.query<{ id: string }>("select id from public.list_companies($1, null, $2, null, null, null, 'name', 50, 0)", [f.workspaces.a1, state])).map((r) => r.id);
      expect(await pick("none")).toEqual([id.coNone]);
      expect(await pick("outdated")).toEqual([id.coOut]);
      // re-evaluating through the trusted writer makes it current; it enters the ready candidates
      await s.query("set local role service_role");
      await s.query(SAVE, [f.users.memberA, f.workspaces.a1, id.coOut, id.icp, "scored", 88, "A", null]);
      await s.query("set local role authenticated");
      expect(await pick("outdated")).toEqual([]);
      const ready = await s.query<{ company_id: string }>("select company_id from public.today_ready_candidates($1)", [f.workspaces.a1]);
      expect(ready.map((r) => r.company_id)).toContain(id.coOut);
      expect(ready.map((r) => r.company_id)).not.toContain(id.coX); // hard-excluded never enters Ready
    });
  });
});
