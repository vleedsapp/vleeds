import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DISPOSITION_LABEL, DISPOSITION_RULES, outcomeProblem } from "@/lib/contact-workflow/dispositions";
import { companyIneligibility, contactIneligibility, hasCallableContact, hasUsablePhone, taskBlocker } from "@/lib/contact-workflow/eligibility";
import { buildDueQueue, buildReadyQueue, classifyDue, recommendContact } from "@/lib/contact-workflow/queue";
import { dayBounds, formatWhen, isValidTimeZone, localDateTimeToUtc, timeZoneOptions, utcToLocalInput } from "@/lib/contact-workflow/time";
import { DISPOSITIONS, type ContactFacts, type DueTaskFacts, type ReadyCandidate } from "@/lib/contact-workflow/types";
import { recordAttemptSchema, scheduleTaskSchema, telHref } from "@/lib/contact-workflow/view";
import { evaluateFitSchema } from "@/lib/scoring/view";

/**
 * P1-E7 workflow domain: dispositions, Ready eligibility, recommended
 * contact, due classification and workspace time. Fictional, generic data.
 */

const NOW = new Date("2026-10-14T15:00:00Z");
const DAY_START = new Date("2026-10-14T00:00:00Z"); // UTC workspace
const iso = (s: string) => new Date(s).toISOString();

const person = (o: Partial<ContactFacts> & { id: string }): ContactFacts => ({
  fullName: o.id,
  jobTitle: null,
  phone: "+1 555 0100",
  isPrimary: false,
  status: "active",
  restricted: false,
  openTaskDueAt: null,
  latestAttempt: null,
  ...o,
});

const company = (o: Partial<ReadyCandidate> & { companyId: string }): ReadyCandidate => ({
  name: o.companyId,
  location: null,
  coveragePercent: 80,
  qualification: "unreviewed",
  restricted: false,
  scoreState: "current",
  grade: "A",
  score: 80,
  contacts: [person({ id: `${o.companyId}-p` })],
  lastAttempt: null,
  ...o,
});

const roles = [
  { title: "Operations Director", priority: "primary" as const },
  { title: "Office Manager", priority: "secondary" as const },
  { title: "Coordinator", priority: "fallback" as const },
];

// =============================================================================
describe("dispositions", () => {
  const ok = (o: Parameters<typeof outcomeProblem>[0]) => outcomeProblem(o, NOW);
  const later = new Date(NOW.getTime() + 3_600_000);

  it("every disposition has a product label (no raw enum values)", () => {
    for (const d of DISPOSITIONS) {
      expect(DISPOSITION_LABEL[d]).toBeTruthy();
      expect(DISPOSITION_LABEL[d]).not.toContain("_");
    }
  });

  it("callback and follow-up need a due date/time; do not contact needs a scope; other needs a note", () => {
    expect(ok({ disposition: "callback_requested", note: null, next: null, scope: null })).toMatch(/callback date and time/i);
    expect(ok({ disposition: "follow_up_needed", note: null, next: null, scope: null })).toMatch(/follow-up date and time/i);
    expect(ok({ disposition: "callback_requested", note: null, next: { kind: "callback", dueAt: later }, scope: null })).toBeNull();
    expect(ok({ disposition: "follow_up_needed", note: null, next: { kind: "follow_up", dueAt: later }, scope: null })).toBeNull();
    expect(ok({ disposition: "do_not_contact", note: null, next: null, scope: null })).toMatch(/this person or the entire company/);
    expect(ok({ disposition: "do_not_contact", note: null, next: null, scope: "company" })).toBeNull();
    expect(ok({ disposition: "other", note: "  ", next: null, scope: null })).toMatch(/note/);
    expect(ok({ disposition: "other", note: "Left a message with reception", next: null, scope: null })).toBeNull();
  });

  it("retry is optional after no answer / voicemail, and needs a valid future time when chosen", () => {
    for (const d of ["no_answer", "left_voicemail"] as const) {
      expect(ok({ disposition: d, note: null, next: null, scope: null })).toBeNull();
      expect(ok({ disposition: d, note: null, next: { kind: "retry_call", dueAt: later }, scope: null })).toBeNull();
      expect(ok({ disposition: d, note: null, next: { kind: "retry_call", dueAt: null }, scope: null })).toMatch(/valid date/);
      expect(ok({ disposition: d, note: null, next: { kind: "retry_call", dueAt: new Date(NOW.getTime() - 1) }, scope: null })).toMatch(/future/);
      expect(ok({ disposition: d, note: null, next: { kind: "callback", dueAt: later }, scope: null })).toMatch(/can't schedule/);
    }
  });

  it("interested may schedule a follow-up; not interested and wrong number schedule nothing; only DNC restricts", () => {
    expect(ok({ disposition: "connected_interested", note: null, next: { kind: "follow_up", dueAt: later }, scope: null })).toBeNull();
    expect(ok({ disposition: "connected_not_interested", note: null, next: { kind: "follow_up", dueAt: later }, scope: null })).toMatch(/can't schedule/);
    expect(ok({ disposition: "wrong_number", note: null, next: { kind: "retry_call", dueAt: later }, scope: null })).toMatch(/can't schedule/);
    expect(ok({ disposition: "connected_not_interested", note: null, next: null, scope: "contact" })).toMatch(/Only “Do not contact”/);
    expect(DISPOSITION_RULES.connected_not_interested.ready).toBe("terminal");
    expect(DISPOSITION_RULES.wrong_number.ready).toBe("terminal");
  });
});

// =============================================================================
describe("Ready eligibility", () => {
  it("company: only a current A/B result, unreviewed or qualified, not restricted", () => {
    const base = { qualification: "unreviewed" as const, restricted: false, scoreState: "current" as const, grade: "A" as const, score: 80 };
    expect(companyIneligibility(base)).toBeNull();
    expect(companyIneligibility({ ...base, grade: "B" })).toBeNull();
    expect(companyIneligibility({ ...base, qualification: "qualified" })).toBeNull();
    expect(companyIneligibility({ ...base, grade: "C" })).toBe("grade");
    expect(companyIneligibility({ ...base, scoreState: "excluded", grade: null })).toBe("excluded");
    expect(companyIneligibility({ ...base, scoreState: "outdated" })).toBe("outdated");
    expect(companyIneligibility({ ...base, scoreState: "none", grade: null })).toBe("not_scored");
    expect(companyIneligibility({ ...base, qualification: "needs_review" })).toBe("qualification");
    expect(companyIneligibility({ ...base, qualification: "unqualified" })).toBe("qualification");
    expect(companyIneligibility({ ...base, restricted: true })).toBe("restricted");
  });

  it("contact: left company, restriction, missing phone and any open task exclude it", () => {
    expect(contactIneligibility(person({ id: "a" }), DAY_START)).toBeNull();
    expect(contactIneligibility(person({ id: "a", status: "left_company" }), DAY_START)).toBe("left_company");
    expect(contactIneligibility(person({ id: "a", restricted: true }), DAY_START)).toBe("restricted");
    expect(contactIneligibility(person({ id: "a", phone: null }), DAY_START)).toBe("no_phone");
    expect(contactIneligibility(person({ id: "a", phone: "n/a" }), DAY_START)).toBe("no_phone");
    expect(contactIneligibility(person({ id: "a", openTaskDueAt: iso("2026-10-20T10:00:00Z") }), DAY_START)).toBe("open_task"); // future task
    expect(contactIneligibility(person({ id: "a", openTaskDueAt: iso("2026-10-13T10:00:00Z") }), DAY_START)).toBe("open_task"); // due task (listed as due work)
    expect(hasUsablePhone("+44 20 7946 0000")).toBe(true);
  });

  it("no answer / voicemail / interested today keep the contact out for the rest of the local day only", () => {
    for (const d of ["no_answer", "left_voicemail", "connected_interested", "other"] as const) {
      expect(contactIneligibility(person({ id: "a", latestAttempt: { disposition: d, attemptedAt: iso("2026-10-14T09:00:00Z") } }), DAY_START), d).toBe("attempted_today");
      expect(contactIneligibility(person({ id: "a", latestAttempt: { disposition: d, attemptedAt: iso("2026-10-13T23:59:00Z") } }), DAY_START), d).toBeNull();
    }
  });

  it("not interested and wrong number are never returned automatically", () => {
    for (const d of ["connected_not_interested", "wrong_number"] as const) {
      expect(contactIneligibility(person({ id: "a", latestAttempt: { disposition: d, attemptedAt: iso("2026-09-01T09:00:00Z") } }), DAY_START)).toBe("not_returned");
    }
  });

  it("callable contact ignores today's workflow state", () => {
    expect(hasCallableContact([person({ id: "a", latestAttempt: { disposition: "no_answer", attemptedAt: iso("2026-10-14T09:00:00Z") } })])).toBe(true);
    expect(hasCallableContact([person({ id: "a", phone: null }), person({ id: "b", restricted: true }), person({ id: "c", status: "left_company" })])).toBe(false);
  });
});

// =============================================================================
describe("recommended contact and Ready queue", () => {
  it("prefers primary, then secondary, then fallback role matches, then the primary contact, then a stable order", () => {
    const pick = (list: ContactFacts[]) => recommendContact(list, roles)?.contact.id;
    expect(pick([person({ id: "fallback", jobTitle: "Project Coordinator" }), person({ id: "secondary", jobTitle: "Office Manager" }), person({ id: "primary", jobTitle: "Operations Director, North" })])).toBe("primary");
    expect(pick([person({ id: "fallback", jobTitle: "Coordinator" }), person({ id: "secondary", jobTitle: "Office Manager" })])).toBe("secondary");
    expect(pick([person({ id: "none", jobTitle: "Analyst" }), person({ id: "fallback", jobTitle: "Coordinator" })])).toBe("fallback");
    expect(pick([person({ id: "b-other", jobTitle: "Analyst" }), person({ id: "a-primary-contact", jobTitle: "Engineer", isPrimary: true })])).toBe("a-primary-contact");
    expect(pick([person({ id: "z", fullName: "Zed" }), person({ id: "y", fullName: "Amy" })])).toBe("y");
    // whole-word matching (same helper as scoring / contact discovery)
    expect(recommendContact([person({ id: "x", jobTitle: "Operations Directorate Clerk" })], roles)?.role).toBeNull();
  });

  it("falls back to the next eligible contact; one item per company; nobody callable → needs a callable contact", () => {
    const q = buildReadyQueue(
      [
        company({
          companyId: "co1",
          contacts: [person({ id: "best", jobTitle: "Operations Director", restricted: true }), person({ id: "next", jobTitle: "Office Manager" }), person({ id: "third", jobTitle: "Coordinator" })],
        }),
        company({ companyId: "co2", grade: "B", score: 60, contacts: [person({ id: "nophone", phone: null })] }),
        company({ companyId: "co3", grade: "B", score: 55, contacts: [person({ id: "today", latestAttempt: { disposition: "no_answer", attemptedAt: iso("2026-10-14T10:00:00Z") } })] }),
      ],
      roles,
      DAY_START,
    );
    expect(q.items.map((i) => [i.candidate.companyId, i.contact.id])).toEqual([["co1", "next"]]);
    expect(q.total).toBe(1);
    expect(q.needsCallableContact.map((c) => c.companyId)).toEqual(["co2"]); // co3 is callable, just not again today
  });

  it("orders A before B, then fit descending, then name; ignores coverage; filters C/Excluded/Outdated/Not scored/qualification", () => {
    const q = buildReadyQueue(
      [
        company({ companyId: "b-high", grade: "B", score: 74, coveragePercent: 100 }),
        company({ companyId: "a-low", grade: "A", score: 76, coveragePercent: 10 }),
        company({ companyId: "a-high", grade: "A", score: 95 }),
        company({ companyId: "a-tie-b", name: "Beta", grade: "A", score: 80 }),
        company({ companyId: "a-tie-a", name: "Alpha", grade: "A", score: 80 }),
        company({ companyId: "c", grade: "C", score: 40 }),
        company({ companyId: "x", scoreState: "excluded", grade: null, score: null }),
        company({ companyId: "o", scoreState: "outdated" }),
        company({ companyId: "n", scoreState: "none", grade: null, score: null }),
        company({ companyId: "review", qualification: "needs_review" }),
        company({ companyId: "unq", qualification: "unqualified" }),
        company({ companyId: "qual", qualification: "qualified", grade: "B", score: 50 }),
        company({ companyId: "restricted", restricted: true }),
      ],
      roles,
      DAY_START,
    );
    expect(q.items.map((i) => i.candidate.companyId)).toEqual(["a-high", "a-tie-a", "a-tie-b", "a-low", "b-high", "qual"]);
  });

  it("is bounded: shows at most the limit, with the full total", () => {
    const many = Array.from({ length: 30 }, (_, i) => company({ companyId: `co${String(i).padStart(2, "0")}`, score: 99 - i }));
    const q = buildReadyQueue(many, roles, DAY_START, 25);
    expect(q.items).toHaveLength(25);
    expect(q.total).toBe(30);
  });
});

// =============================================================================
describe("due work", () => {
  const task = (o: Partial<DueTaskFacts> & { id: string; dueAt: string }): DueTaskFacts => ({
    kind: "callback",
    note: null,
    companyId: "co",
    companyName: "Co",
    companyArchived: false,
    companyRestricted: false,
    contactId: "p",
    contactName: "P",
    jobTitle: null,
    phone: "+1 555 0100",
    contactStatus: "active",
    contactArchived: false,
    contactRestricted: false,
    ...o,
  });

  it("classifies overdue (before today), due now (today, by now), later today", () => {
    expect(classifyDue("2026-10-13T23:59:00Z", NOW, DAY_START)).toBe("overdue");
    expect(classifyDue("2026-10-14T00:00:00Z", NOW, DAY_START)).toBe("due_now");
    expect(classifyDue("2026-10-14T15:00:00Z", NOW, DAY_START)).toBe("due_now");
    expect(classifyDue("2026-10-14T15:01:00Z", NOW, DAY_START)).toBe("later_today");
  });

  it("orders overdue first, then due time, then id; splits callbacks/follow-ups; blocked tasks are not actionable", () => {
    const q = buildDueQueue(
      [
        task({ id: "later", dueAt: "2026-10-14T18:00:00Z" }),
        task({ id: "now", dueAt: "2026-10-14T09:00:00Z" }),
        task({ id: "old-2", dueAt: "2026-10-12T09:00:00Z" }),
        task({ id: "old-1", dueAt: "2026-10-12T09:00:00Z" }),
        task({ id: "fu", kind: "follow_up", dueAt: "2026-10-14T08:00:00Z" }),
        task({ id: "retry", kind: "retry_call", dueAt: "2026-10-14T07:00:00Z" }),
        task({ id: "blocked", dueAt: "2026-10-14T06:00:00Z", contactRestricted: true }),
        task({ id: "left", dueAt: "2026-10-14T06:30:00Z", contactStatus: "left_company" }),
      ],
      NOW,
      DAY_START,
    );
    expect(q.callbacks.map((t) => t.id)).toEqual(["old-1", "old-2", "now", "later"]);
    expect(q.followUps.map((t) => t.id)).toEqual(["retry", "fu"]);
    expect(q.blocked.map((t) => [t.id, t.blocker])).toEqual([
      ["blocked", "contact_restricted"],
      ["left", "contact_left"],
    ]);
  });

  it("names every blocking reason", () => {
    const base = { companyArchived: false, contactArchived: false, companyRestricted: false, contactRestricted: false, contactStatus: "active" as const, phone: "+1 555 0100" };
    expect(taskBlocker(base)).toBeNull();
    expect(taskBlocker({ ...base, companyRestricted: true })).toBe("company_restricted");
    expect(taskBlocker({ ...base, phone: null })).toBe("no_phone");
    expect(taskBlocker({ ...base, contactArchived: true })).toBe("unavailable");
  });
});

// =============================================================================
describe("workspace time", () => {
  it("validates IANA zones from the runtime list", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    for (const bad of ["Mars/Base", "+05:00", "", "utc ", "x".repeat(70), 7]) expect(isValidTimeZone(bad), String(bad)).toBe(false);
    expect(timeZoneOptions()[0]).toBe("UTC");
  });

  it("computes UTC and offset day boundaries (positive and negative offsets)", () => {
    expect(dayBounds(NOW, "UTC")).toEqual({ start: new Date("2026-10-14T00:00:00Z"), end: new Date("2026-10-15T00:00:00Z") });
    // Asia/Kolkata = UTC+5:30 → local day 14 Oct runs 13 Oct 18:30Z – 14 Oct 18:30Z
    expect(dayBounds(NOW, "Asia/Kolkata")).toEqual({ start: new Date("2026-10-13T18:30:00Z"), end: new Date("2026-10-14T18:30:00Z") });
    // America/Chicago = UTC-5 (CDT) in October
    expect(dayBounds(NOW, "America/Chicago")).toEqual({ start: new Date("2026-10-14T05:00:00Z"), end: new Date("2026-10-15T05:00:00Z") });
    // Just after local midnight in Chicago it is already the next local day.
    expect(dayBounds(new Date("2026-10-15T05:30:00Z"), "America/Chicago").start).toEqual(new Date("2026-10-15T05:00:00Z"));
  });

  it("handles daylight-saving transitions (23- and 25-hour days)", () => {
    const spring = dayBounds(new Date("2026-03-29T12:00:00Z"), "Europe/London");
    expect(spring.start.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(spring.end.toISOString()).toBe("2026-03-29T23:00:00.000Z"); // clocks go forward: 23 hours
    const autumn = dayBounds(new Date("2026-11-01T12:00:00Z"), "America/Chicago");
    expect((autumn.end.getTime() - autumn.start.getTime()) / 3_600_000).toBe(25);
  });

  it("reads typed local date/time in the workspace zone and stores a UTC instant", () => {
    expect(localDateTimeToUtc("2026-10-14", "14:00", "UTC")?.toISOString()).toBe("2026-10-14T14:00:00.000Z");
    expect(localDateTimeToUtc("2026-10-14", "14:00", "Europe/London")?.toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(localDateTimeToUtc("2026-12-14", "14:00", "Europe/London")?.toISOString()).toBe("2026-12-14T14:00:00.000Z");
    expect(localDateTimeToUtc("2026-10-14", "09:30", "America/Chicago")?.toISOString()).toBe("2026-10-14T14:30:00.000Z");
    // A local time that doesn't exist (clocks jump 02:00 → 03:00) moves forward by the gap.
    expect(localDateTimeToUtc("2026-03-08", "02:30", "America/Chicago")?.toISOString()).toBe("2026-03-08T08:30:00.000Z");
    for (const [d, t] of [["2026-02-30", "10:00"], ["2026-10-14", "24:00"], ["14/10/2026", "10:00"], ["2026-10-14", "9:5"]]) {
      expect(localDateTimeToUtc(d, t, "UTC"), `${d} ${t}`).toBeNull();
    }
    expect(localDateTimeToUtc("2026-10-14", "10:00", "Mars/Base")).toBeNull();
    expect(utcToLocalInput("2026-10-14T13:00:00Z", "Europe/London")).toEqual({ date: "2026-10-14", time: "14:00" });
  });

  it("labels times relative to the workspace-local day", () => {
    expect(formatWhen("2026-10-14T10:42:00Z", NOW, "UTC")).toBe("Today · 10:42");
    expect(formatWhen("2026-10-13T16:05:00Z", NOW, "UTC")).toBe("Yesterday · 16:05");
    expect(formatWhen("2026-10-15T14:00:00Z", NOW, "UTC")).toBe("Tomorrow · 14:00");
    expect(formatWhen("2026-10-19T09:30:00Z", NOW, "UTC")).toBe("Mon 19 Oct · 09:30");
    // 04:00Z on the 15th is still the 14th in Chicago
    expect(formatWhen("2026-10-15T04:00:00Z", NOW, "America/Chicago")).toBe("Today · 23:00");
  });
});

// =============================================================================
describe("browser input boundary", () => {
  const ids = { companyId: "8f5c1c1e-3f1a-4d36-9b8e-2b8f0a1c9d10", contactId: "1b2f8a2e-0c3d-4e5f-8a9b-0c1d2e3f4a5b", requestId: "c0ffee00-1234-4abc-8def-001122334455" };

  it("attempt input is ids + choices + local date/time text only (no actor, timestamps or scores)", () => {
    const valid = { ...ids, sourceTaskId: null, disposition: "no_answer", note: null, next: null, scope: null, reason: null };
    expect(recordAttemptSchema.safeParse(valid).success).toBe(true);
    for (const extra of [{ actorUserId: ids.contactId }, { attemptedAt: "2026-10-14T10:00:00Z" }, { score: 90 }, { createdBy: ids.contactId }]) {
      expect(recordAttemptSchema.safeParse({ ...valid, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(recordAttemptSchema.safeParse({ ...valid, next: { kind: "callback", date: "2026-10-15", time: "14:00", note: null, dueAt: "x" } }).success).toBe(false);
    expect(scheduleTaskSchema.safeParse({ companyId: ids.companyId, contactId: ids.contactId, kind: "callback", date: "2026-10-15", time: "14:00", note: null, status: "completed" }).success).toBe(false);
  });

  it("fit evaluation input still carries no score/grade/breakdown fields", () => {
    expect(evaluateFitSchema.safeParse({ companyId: ids.companyId, icpProfileId: ids.contactId }).success).toBe(true);
    for (const k of ["score", "grade", "breakdown", "coverage", "fingerprint", "actorUserId"]) {
      expect(evaluateFitSchema.safeParse({ companyId: ids.companyId, icpProfileId: ids.contactId, [k]: 1 }).success, k).toBe(false);
    }
  });

  it("builds tel: links from stored numbers without recording anything", () => {
    expect(telHref("+44 20 7946 0000")).toBe("tel:+442079460000");
    expect(telHref("(555) 010-0100")).toBe("tel:5550100100");
    expect(telHref("n/a")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

// =============================================================================
describe("trusted score writer isolation", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = path.join(dir, e);
      return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(e) ? [full] : [];
    });
  const src = files(path.join(ROOT, "src"));

  it("only the scoring DAL and the Today actions import the writer; no client module does", () => {
    const importers = src.filter((f) => /from ["']@\/lib\/supabase\/trusted-score-writer["']/.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f).replaceAll("\\", "/"));
    expect(importers.sort()).toEqual(["src/app/w/[workspaceId]/today/actions.ts", "src/lib/dal/scoring.ts"]);
    for (const f of src) {
      const text = readFileSync(f, "utf8");
      if (/^["']use client["']/.test(text.trimStart())) expect(text, f).not.toMatch(/from ["'][^"']*trusted-score-writer["']|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("the service-role key is read in exactly one module, which is server-only and never exports its client", () => {
    const readers = src.filter((f) => readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY")).map((f) => path.relative(ROOT, f).replaceAll("\\", "/"));
    expect(readers).toEqual(["src/lib/supabase/trusted-score-writer.ts"]);
    const writer = readFileSync(path.join(ROOT, "src/lib/supabase/trusted-score-writer.ts"), "utf8");
    expect(writer.startsWith('import "server-only";')).toBe(true);
    expect(writer).not.toMatch(/NEXT_PUBLIC_SUPABASE_SERVICE|export (const|let) client|export function writer/);
    expect(writer).toMatch(/rpc\("save_lead_score_trusted"/);
    expect((writer.match(/\.rpc\(/g) ?? []).length).toBe(1); // one function, nothing else
    expect(writer).not.toMatch(/\.from\(/);
  });
});
