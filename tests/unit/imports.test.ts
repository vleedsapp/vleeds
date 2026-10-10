import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { allowedDecisions, classifyRows, isDecisionAllowed, type ClassifyInput } from "@/lib/imports/classify";
import { planRowCommit, type CommitContext } from "@/lib/imports/commit";
import { checkCsvFile, decodeCsv, parseCsv, uniqueHeaders } from "@/lib/imports/csv";
import { columnMappingSchema, suggestMapping, type ColumnMapping } from "@/lib/imports/fields";
import { evidenceFor } from "@/lib/imports/ingest";
import { IMPORT_LIMITS } from "@/lib/imports/limits";
import { planCompanyMerge, planContactMerge, type ExistingCompany, type ExistingContact } from "@/lib/imports/merge";
import { buildRow, parseCount, resolveCountry, resolveQualification, type StagedRow } from "@/lib/imports/rows";
import { summarize } from "@/lib/imports/summary";
import type { KnownCompany } from "@/lib/lead-core/dedupe";

// -----------------------------------------------------------------------------
describe("CSV parsing", () => {
  const parse = (text: string) => {
    const r = parseCsv(text);
    if (!r.ok) throw new Error(r.error.message);
    return r.csv;
  };

  it("handles BOM, quoted commas, quoted line breaks and escaped quotes", () => {
    const csv = parse('﻿Company,Notes\n"Example, Ltd","Line one\nLine two"\n"Quote ""Co""",x\n');
    expect(csv.headers).toEqual(["Company", "Notes"]);
    expect(csv.rows).toEqual([
      ["Example, Ltd", "Line one\nLine two"],
      ['Quote "Co"', "x"],
    ]);
  });

  it("handles CRLF and CR newlines and drops blank rows", () => {
    expect(parse("A,B\r\n1,2\r\n\r\n,\r\n3,4\r\n").rows).toEqual([["1", "2"], ["3", "4"]]);
    expect(parse("A,B\r1,2\r3,4").rows).toHaveLength(2);
  });

  it("pads short rows, trims long rows and keeps values as text (no formula or number evaluation)", () => {
    const csv = parse("A,B\n1\n=SUM(A1:A9),007,extra\n");
    expect(csv.rows).toEqual([["1", ""], ["=SUM(A1:A9)", "007"]]);
  });

  it("makes blank and duplicate headers unique", () => {
    expect(uniqueHeaders(["Email", "", "email", "Email"])).toEqual(["Email", "Column 2", "email (2)", "Email (3)"]);
  });

  it("rejects empty files, header-only files and files over the row/column limits", () => {
    expect(parseCsv("").ok).toBe(false);
    expect(parseCsv("\n\n").ok).toBe(false);
    expect(parseCsv("A,B\n").ok).toBe(false);
    const many = "A\n" + Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => `r${i}`).join("\n");
    const r = parseCsv(many);
    expect(!r.ok && r.error.code).toBe("too_many_rows");
    const wide = Array.from({ length: IMPORT_LIMITS.maxColumns + 1 }, (_, i) => `c${i}`).join(",") + "\n1";
    const w = parseCsv(wide);
    expect(!w.ok && w.error.code).toBe("too_many_columns");
    expect(parseCsv("A\n" + Array.from({ length: IMPORT_LIMITS.maxRows }, () => "x").join("\n")).ok).toBe(true);
  });

  it("checks file name and size before reading", () => {
    expect(checkCsvFile({ name: "leads.CSV", size: 10 })).toBeNull();
    expect(checkCsvFile({ name: "leads.xlsx", size: 10 })?.code).toBe("not_csv");
    expect(checkCsvFile({ name: "leads.csv.exe", size: 10 })?.code).toBe("not_csv");
    expect(checkCsvFile({ name: "leads.csv", size: 0 })?.code).toBe("empty");
    expect(checkCsvFile({ name: "leads.csv", size: IMPORT_LIMITS.maxFileBytes + 1 })?.code).toBe("too_large");
  });

  it("decodes UTF-8 and falls back to Windows-1252", () => {
    expect(decodeCsv(new TextEncoder().encode("Café,Zürich"))).toBe("Café,Zürich");
    expect(decodeCsv(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
  });
});

// -----------------------------------------------------------------------------
describe("column mapping", () => {
  it("suggests generic fields from common headers, each field once", () => {
    expect(suggestMapping(["Company", "Website", "Email", "E-mail", "Job Title", "Owner Notes", "Zip"])).toEqual([
      "company_name", "website", "contact_email", null, "contact_title", null, "postal_code",
    ]);
  });

  it("requires the company name and refuses a field mapped twice", () => {
    expect(columnMappingSchema.safeParse(["website", null]).success).toBe(false);
    expect(columnMappingSchema.safeParse(["company_name", "website", "website"]).success).toBe(false);
    expect(columnMappingSchema.safeParse(["company_name", null, null]).success).toBe(true);
    expect(columnMappingSchema.safeParse(["company_name", "made_up_field"]).success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe("row normalization and validation", () => {
  const mapping: ColumnMapping = [
    "company_name", "website", "domain", "phone", "country", "region", "city", "employees_min", "employees_max",
    "qualification", "contact_name", "contact_title", "contact_email", "contact_seniority", null,
  ];
  const row = (o: Partial<Record<number, string>>) => Array.from({ length: mapping.length }, (_, i) => o[i] ?? "");

  it("normalizes a full row with the shared lead-core helpers", () => {
    const r = buildRow(row({ 0: " Example  Co. ", 1: "https://www.example.test/about", 3: "+44 20 7946 0000", 4: "United Kingdom", 6: "London", 7: "1,200", 8: "5000", 9: "Needs review", 10: "Ana Silva", 12: "Ana.Silva@Example.test", 13: "Director" }), mapping);
    expect(r.valid).toBe(true);
    expect(r.company).toMatchObject({
      normalizedName: "example co",
      primaryDomain: "example.test",
      primaryPhoneNormalized: "+442079460000",
      location: { countryCode: "GB", city: "London" },
      employeeCountMin: 1200,
      employeeCountMax: 5000,
      qualificationState: "needs_review",
    });
    expect(r.contact).toMatchObject({ fullName: "Ana Silva", normalizedEmail: "ana.silva@example.test", seniority: "director" });
  });

  it("reports errors per field without failing other rows", () => {
    const missing = buildRow(row({ 10: "Ana Silva" }), mapping);
    expect(missing.valid).toBe(false);
    expect(missing.issues.find((i) => i.field === "company_name")?.message).toMatch(/Contacts must belong to a company/);
    expect(buildRow(row({ 0: "X", 2: "not a domain" }), mapping).issues.map((i) => i.field)).toContain("domain");
    expect(buildRow(row({ 0: "X", 1: "javascript:alert(1)" }), mapping).issues.map((i) => i.field)).toContain("website");
    expect(buildRow(row({ 0: "X", 10: "Ana", 12: "nope" }), mapping).issues.map((i) => i.field)).toContain("contact_email");
    expect(buildRow(row({ 0: "X", 7: "500", 8: "10" }), mapping).issues.map((i) => i.field)).toContain("employees_max");
    expect(buildRow(row({ 0: "X", 7: "ten" }), mapping).issues.find((i) => i.field === "employees_min")?.message).toBe("Use a whole number of employees.");
    expect(buildRow(row({ 0: "X", 12: "a@example.test" }), mapping).issues.find((i) => i.field === "contact_name")?.level).toBe("error");
    expect(buildRow(row({ 0: "x".repeat(1001) }), mapping).valid).toBe(false);
  });

  it("downgrades unsupported optional values to warnings", () => {
    const r = buildRow(row({ 0: "X", 4: "Atlantis", 9: "Hot lead", 10: "Ana", 13: "Boss", 3: "(555) 010-0000" }), mapping);
    expect(r.valid).toBe(true);
    expect(r.issues.filter((i) => i.level === "warning").map((i) => i.field).sort()).toEqual(["contact_seniority", "country", "phone", "qualification"]);
    expect(r.contact?.seniority).toBeNull();
    expect(r.company?.qualificationState).toBeNull();
    expect(r.company?.location).toBeNull();
  });

  it("small resolvers", () => {
    expect(parseCount("1 200")).toBe(1200);
    expect(parseCount("")).toBeNull();
    expect(Number.isNaN(parseCount("10-50"))).toBe(true);
    expect(resolveCountry("de")).toBe("DE");
    expect(resolveCountry("germany")).toBe("DE");
    expect(resolveQualification("needs_review")).toBe("needs_review");
    expect(resolveQualification("Qualified")).toBe("qualified");
    expect(resolveQualification("won")).toBeNull();
  });
});

// -----------------------------------------------------------------------------
const staged = (o: { name: string; domain?: string; phone?: string; country?: string; city?: string; email?: string; contact?: string }): StagedRow => {
  const r = buildRow(
    [o.name, o.domain ?? "", o.phone ?? "", o.country ?? "", o.city ?? "", o.contact ?? "", o.email ?? ""],
    ["company_name", "domain", "phone", "country", "city", "contact_name", "contact_email"],
  );
  return { mapped: r.mapped, company: r.company, contact: r.contact };
};

describe("duplicate classification", () => {
  const known: KnownCompany[] = [
    { id: "c1", primaryDomain: "existing.example.test", primaryPhoneNormalized: "+442079460000", normalizedName: "existing co", location: { countryCode: "GB", city: "London" }, externalIds: [] },
    { id: "c2", primaryDomain: null, primaryPhoneNormalized: null, normalizedName: "abc company", location: { countryCode: "US", city: "City One" }, externalIds: [] },
  ];
  const input = (n: number, s: StagedRow, valid = true): ClassifyInput => ({ id: `r${n}`, rowNumber: n, staged: s, valid });

  it("classifies new, strong matches, weak matches and invalid rows", () => {
    const res = classifyRows(
      [
        input(1, staged({ name: "Brand New Co", domain: "new.example.test" })),
        input(2, staged({ name: "Renamed", domain: "https://www.existing.example.test/x" })),
        input(3, staged({ name: "Tenant", phone: "+44 20 7946 0000" })),
        input(4, staged({ name: "ABC Company", country: "US", city: "City One" })),
        input(5, staged({ name: "ABC Company LLC", country: "US", city: "City One" })),
        input(6, { mapped: {}, company: null, contact: null }, false),
      ],
      known,
    );
    expect(res.get("r1")).toMatchObject({ matchState: "new", decision: "create" });
    expect(res.get("r2")).toMatchObject({ matchState: "matched", matchReason: "domain", matchedCompanyId: "c1", decision: "merge" });
    expect(res.get("r3")).toMatchObject({ matchState: "possible_duplicate", matchReason: "phone", matchedCompanyId: "c1", decision: null });
    expect(res.get("r4")).toMatchObject({ matchState: "possible_duplicate", matchReason: "name_location", matchedCompanyId: "c2", decision: null });
    expect(res.get("r5")).toMatchObject({ matchState: "new" }); // similar name, no strong identifier
    expect(res.get("r6")).toMatchObject({ matchState: "invalid", decision: "skip" });
  });

  it("detects a company listed twice in the same file", () => {
    const res = classifyRows(
      [input(1, staged({ name: "Twice Co", domain: "twice.example.test" })), input(2, staged({ name: "Twice Company", domain: "twice.example.test" }))],
      [],
    );
    expect(res.get("r1")?.matchState).toBe("new");
    expect(res.get("r2")).toMatchObject({ matchState: "matched", matchedRowId: "r1", matchedCompanyId: null, decision: "merge" });
  });

  it("restricts decisions: strong identity can't be created separately; invalid rows only skip", () => {
    expect(allowedDecisions("matched")).toEqual(["merge", "skip"]);
    expect(allowedDecisions("possible_duplicate")).toEqual(["merge", "skip", "create"]);
    expect(allowedDecisions("new")).toEqual(["create", "skip"]);
    expect(allowedDecisions("invalid")).toEqual(["skip"]);
    expect(isDecisionAllowed("matched", "create")).toBe(false);
    expect(isDecisionAllowed("invalid", "merge")).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe("merge rules", () => {
  const existing: ExistingCompany = {
    canonical_name: "Existing Co", normalized_name: "existing co", website_url: null, primary_domain: "existing.example.test",
    primary_phone: "+44 20 7946 0000", primary_phone_normalized: "+442079460000", location: null, employee_count_min: 10,
    employee_count_max: null, qualification_state: "qualified", notes: "Keep me",
  };

  it("fills blanks, ignores blanks and equal values, keeps existing values on conflict", () => {
    const incoming = buildRow(
      ["Existing Co.", "https://existing.example.test", "", "0044 20 7946 0000", "DE", "Berlin", "20", "200", "unqualified", "Other notes"],
      ["company_name", "website", "domain", "phone", "country", "city", "employees_min", "employees_max", "qualification", "company_notes"],
    ).company!;
    const plan = planCompanyMerge(existing, incoming);
    expect(plan.patch).toEqual({ website_url: "https://existing.example.test", location: incoming.location, employee_count_max: 200 });
    expect(plan.conflicts.join(" ")).toMatch(/employee minimum 10/);
    expect(plan.conflicts.join(" ")).toMatch(/qualification/);
    expect(plan.conflicts.join(" ")).toMatch(/notes/);
    expect(plan.conflicts.join(" ")).not.toMatch(/company name/); // "Existing Co." normalizes equal
    expect(plan.conflicts.join(" ")).not.toMatch(/phone/); // same number, different format
  });

  it("a blank import changes nothing; a different name is reported, never applied", () => {
    const blank = buildRow(["Another Name"], ["company_name"]).company!;
    const plan = planCompanyMerge(existing, blank);
    expect(plan.patch).toEqual({});
    expect(plan.conflicts).toEqual(["Kept company name “Existing Co” (import had “Another Name”)."]);
  });

  it("an unreviewed existing qualification can be set by the import", () => {
    const incoming = buildRow(["Existing Co", "qualified"], ["company_name", "qualification"]).company!;
    expect(planCompanyMerge({ ...existing, qualification_state: "unreviewed" }, incoming).patch).toEqual({ qualification_state: "qualified" });
  });

  it("contacts follow the same rules", () => {
    const ex: ExistingContact = { full_name: "Ana Silva", first_name: null, last_name: null, job_title: "Lead", seniority: null, email: null, normalized_email: null, phone: null, phone_normalized: null, linkedin_url: null, notes: null };
    const incoming = staged({ name: "X", contact: "ana silva", email: "Ana@Example.test" }).contact!;
    const plan = planContactMerge(ex, { ...incoming, jobTitle: "Manager" });
    expect(plan.patch).toEqual({ email: "Ana@Example.test", normalized_email: "ana@example.test" });
    expect(plan.conflicts).toEqual(["Kept existing job title “Lead” (import had “Manager”)."]);
  });
});

// -----------------------------------------------------------------------------
describe("row commit planning", () => {
  const targetId = randomUUID();
  const target: CommitContext["target"] = {
    id: targetId, canonical_name: "Existing Co", normalized_name: "existing co", website_url: null, primary_domain: "existing.example.test",
    primary_phone: null, primary_phone_normalized: null, location: null, employee_count_min: null, employee_count_max: null,
    qualification_state: "unreviewed", notes: null,
  };
  const ctx: CommitContext = { target, targetContacts: [], emailOwners: [] };
  const row = (decision: "create" | "merge" | "skip" | null, s = staged({ name: "Existing Co", domain: "existing.example.test", contact: "Ana Silva", email: "ana@example.test" })) => ({
    commitResult: null, matchState: "matched" as const, decision, staged: s,
  });

  it("never plans an already-committed row again (idempotency)", () => {
    expect(planRowCommit({ ...row("merge"), commitResult: "merged" }, ctx).kind).toBe("already_committed");
    expect(planRowCommit({ ...row("create"), commitResult: "created" }, ctx).kind).toBe("already_committed");
  });

  it("skip, undecided and invalid rows write nothing", () => {
    expect(planRowCommit(row("skip"), ctx)).toMatchObject({ kind: "skip" });
    expect(planRowCommit(row(null), ctx)).toMatchObject({ kind: "skip" });
    expect(planRowCommit({ ...row("create"), matchState: "invalid" }, ctx)).toMatchObject({ kind: "skip" });
  });

  it("create inserts company + contact (primary if none) with CSV evidence for non-empty fields only", () => {
    const plan = planRowCommit({ ...row("create"), matchState: "new" }, { target: null, targetContacts: [], emailOwners: [] });
    expect(plan.kind).toBe("ingest");
    if (plan.kind !== "ingest") return;
    expect(plan.call.company.id).toBeUndefined();
    expect(plan.call.company.fields).toMatchObject({ canonical_name: "Existing Co", primary_domain: "existing.example.test", qualification_state: "unreviewed" });
    expect(plan.call.contact).toMatchObject({ primary_if_none: true, fields: { full_name: "Ana Silva", normalized_email: "ana@example.test" } });
    expect(plan.call.evidence.map((e) => e.field_key)).toEqual(["company.name", "company.domain", "contact.name", "contact.email"]);
    expect(plan.call.evidence.every((e) => e.source_kind === "csv")).toBe(true);
  });

  it("merge updates only the patch and merges a same-email contact at that company", () => {
    const contact = { id: randomUUID(), company_id: targetId, full_name: "Ana Silva", first_name: null, last_name: null, job_title: null, seniority: null, email: "ana@example.test", normalized_email: "ana@example.test", phone: null, phone_normalized: null, linkedin_url: null, notes: null };
    const plan = planRowCommit(row("merge"), { target, targetContacts: [contact], emailOwners: [{ id: contact.id, company_id: targetId, full_name: "Ana Silva" }] });
    expect(plan.kind === "ingest" && plan.call.company).toEqual({ id: targetId, fields: {} });
    expect(plan.kind === "ingest" && plan.call.contact).toEqual({ id: contact.id, fields: {} });
  });

  it("never moves or duplicates a contact whose email belongs to another company", () => {
    const plan = planRowCommit(row("merge"), { target, targetContacts: [], emailOwners: [{ id: randomUUID(), company_id: randomUUID(), full_name: "Someone Else" }] });
    expect(plan.kind === "ingest" && plan.call.contact).toBeNull();
    expect(plan.kind === "ingest" && plan.notes.join(" ")).toMatch(/belongs to Someone Else at another company/);
  });

  it("a merge target that disappeared fails the row instead of creating a duplicate", () => {
    expect(planRowCommit(row("merge"), { target: null, targetContacts: [], emailOwners: [] }).kind).toBe("fail");
  });
});

// -----------------------------------------------------------------------------
describe("evidence and summary", () => {
  it("manual and CSV evidence are distinguishable and skip empty values", () => {
    const s = staged({ name: "Co", domain: "co.example.test" });
    expect(evidenceFor(s.company, null, "manual").map((e) => [e.field_key, e.source_kind])).toEqual([
      ["company.name", "manual"],
      ["company.domain", "manual"],
    ]);
  });

  it("counts what will be imported and what happened", () => {
    const s = summarize([
      { matchState: "new", decision: "create", commitResult: null },
      { matchState: "matched", decision: "merge", commitResult: null },
      { matchState: "possible_duplicate", decision: null, commitResult: null },
      { matchState: "possible_duplicate", decision: "skip", commitResult: null },
      { matchState: "invalid", decision: "skip", commitResult: null },
    ]);
    expect(s).toMatchObject({ total: 5, valid: 4, invalid: 1, toCreate: 1, toMerge: 1, toSkip: 1, undecided: 1, toImport: 2, duplicates: 3 });
    const done = summarize([
      { matchState: "new", decision: "create", commitResult: "created" },
      { matchState: "matched", decision: "merge", commitResult: "merged" },
      { matchState: "new", decision: "create", commitResult: "failed" },
      { matchState: "invalid", decision: "skip", commitResult: "skipped" },
    ]);
    expect(done).toMatchObject({ created: 1, merged: 1, failed: 1, skipped: 0, invalid: 1, pending: 0 });
  });
});
