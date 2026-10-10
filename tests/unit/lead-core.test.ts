import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { matchCompany, matchContact, type KnownCompany, type KnownContact } from "@/lib/lead-core/dedupe";
import { fieldLabel, formatEmployees, formatLocation, formatObserved } from "@/lib/lead-core/display";
import { normalizeCompanyName, normalizeDomain, normalizeEmail, normalizePersonName, normalizePhone } from "@/lib/lead-core/normalize";
import {
  companyInputSchema,
  contactInputSchema,
  leadScoreSchema,
  leadSourceInputSchema,
  locationSchema,
  qualificationUpdateSchema,
  scoreBreakdownSchema,
  suppressionInputSchema,
} from "@/lib/lead-core/schemas";

const id = () => randomUUID();

// -----------------------------------------------------------------------------
describe("domain normalization", () => {
  it.each([
    "https://www.example.com/",
    "http://example.com/",
    "example.com",
    "www.example.com",
    "example.com/",
    "HTTPS://Example.COM/about?ref=x#top",
    "https://user:pw@www.example.com:8443/path",
    "example.com.",
    "  //example.com  ",
  ])("%s → example.com", (input) => {
    expect(normalizeDomain(input)).toBe("example.com");
  });

  it("keeps meaningful subdomains and handles international names", () => {
    expect(normalizeDomain("https://shop.example.co.uk/x")).toBe("shop.example.co.uk");
    expect(normalizeDomain("bücher.example")).toBe("xn--bcher-kva.example");
  });

  it.each(["", "   ", "localhost", "not a domain", "http://", "192.168.0.1", "exa_mple.com", "example..com", "-bad.example.com", "example.123"])(
    "rejects %j",
    (input) => expect(normalizeDomain(input)).toBeNull(),
  );
});

describe("company name normalization", () => {
  it("normalizes formatting only", () => {
    expect(normalizeCompanyName("  ABC   Company ")).toBe("abc company");
    expect(normalizeCompanyName("A.B.C. Company, Ltd.")).toBe("abc company ltd");
    expect(normalizeCompanyName("Smith & Sons")).toBe(normalizeCompanyName("smith and sons"));
    expect(normalizeCompanyName("O’Neil’s Studio")).toBe("oneils studio");
    expect(normalizeCompanyName("Ｗｉｄｅ Name")).toBe("wide name");
  });

  it("does not strip legal or meaningful words", () => {
    expect(normalizeCompanyName("ABC Company LLC")).not.toBe(normalizeCompanyName("ABC Company"));
    expect(normalizeCompanyName("North Group Holdings")).toBe("north group holdings");
  });
});

describe("email and phone normalization", () => {
  it("emails are trimmed and lower-cased, nothing else", () => {
    expect(normalizeEmail("  Person.One+Tag@Example.TEST ")).toBe("person.one+tag@example.test");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
  });

  it("only international-format phones get a comparison value", () => {
    expect(normalizePhone("+44 20 7946 0000")).toBe("+442079460000");
    expect(normalizePhone("0044 (20) 7946-0000")).toBe("+442079460000");
    expect(normalizePhone("+1 (555) 010-0000 ext. 12")).toBe("+15550100000");
    expect(normalizePhone("+81-3-0000-0000")).toBe("+81300000000");
    // National formats: country unknown → no comparison value (display value is kept separately).
    expect(normalizePhone("(555) 010-0000")).toBeNull();
    expect(normalizePhone("020 7946 0000")).toBeNull();
    expect(normalizePhone("+0 123 456")).toBeNull();
    expect(normalizePhone("call me")).toBeNull();
  });

  it("person names compare case- and punctuation-insensitively", () => {
    expect(normalizePersonName(" Ana  O'Brien ")).toBe(normalizePersonName("ana obrien"));
  });
});

// -----------------------------------------------------------------------------
describe("company identity matching", () => {
  const known: KnownCompany[] = [
    { id: "c1", primaryDomain: "example.test", primaryPhoneNormalized: "+442079460000", normalizedName: "example co", location: { countryCode: "GB", city: "London" }, externalIds: [{ providerKey: "example-directory", externalRecordId: "r-1" }] },
    { id: "c2", primaryDomain: null, primaryPhoneNormalized: null, normalizedName: "abc company", location: { countryCode: "US", region: "Region One", city: "City One" }, externalIds: [] },
  ];

  it("1. provider identity wins", () => {
    expect(matchCompany({ name: "Something Else", external: { providerKey: "example-directory", externalRecordId: "r-1" } }, known)).toEqual({ outcome: "match", id: "c1", reason: "external_id" });
  });

  it("provider identity is per provider: the same record id from another provider is not a match", () => {
    expect(matchCompany({ name: "Something Else", external: { providerKey: "other-source", externalRecordId: "r-1" } }, known).outcome).toBe("new");
  });

  it("2. equivalent website URLs and domains match", () => {
    for (const domain of ["https://www.example.test/contact", "http://example.test/", "example.test"]) {
      expect(matchCompany({ name: "Renamed Co", websiteUrl: domain }, known)).toEqual({ outcome: "match", id: "c1", reason: "domain" });
    }
  });

  it("3. a shared phone suggests review, never an automatic match", () => {
    expect(matchCompany({ name: "Tenant Next Door", phone: "+44 20 7946 0000" }, known)).toEqual({ outcome: "review", ids: ["c1"], reason: "phone" });
  });

  it("4. same normalized name in the same place suggests review", () => {
    expect(matchCompany({ name: "ABC Company", location: { countryCode: "us", city: "city one" } }, known)).toEqual({ outcome: "review", ids: ["c2"], reason: "name_location" });
  });

  it("similar names without a strong identifier are not merged", () => {
    expect(matchCompany({ name: "ABC Company LLC", location: { countryCode: "US", city: "City One" } }, known).outcome).toBe("new");
    expect(matchCompany({ name: "ABC Company" }, known).outcome).toBe("new"); // no location evidence
    expect(matchCompany({ name: "ABC Company", location: { countryCode: "US", city: "City Two" } }, known).outcome).toBe("new");
  });

  it("the same company in another workspace is a new record there (matching only sees one workspace)", () => {
    const otherWorkspace: KnownCompany[] = [];
    expect(matchCompany({ name: "Example Co", domain: "example.test" }, otherWorkspace).outcome).toBe("new");
  });
});

describe("contact identity matching", () => {
  const known: KnownContact[] = [
    { id: "p1", companyId: "c1", fullName: "Person One", normalizedEmail: "person.one@example.test", externalIds: [{ providerKey: "example-directory", externalRecordId: "p-1" }] },
    { id: "p2", companyId: "c1", fullName: "Person Two", normalizedEmail: null, externalIds: [] },
  ];

  it("email is the strongest identifier (normalized)", () => {
    expect(matchContact({ fullName: "P. One", companyId: "c9", email: " Person.One@EXAMPLE.test " }, known)).toEqual({ outcome: "match", id: "p1", reason: "email" });
  });

  it("provider identity matches", () => {
    expect(matchContact({ fullName: "X", companyId: "c1", external: { providerKey: "example-directory", externalRecordId: "p-1" } }, known)).toEqual({ outcome: "match", id: "p1", reason: "external_id" });
  });

  it("same name at the same company goes to review; at another company it is new", () => {
    expect(matchContact({ fullName: "person two", companyId: "c1" }, known)).toEqual({ outcome: "review", ids: ["p2"], reason: "name_company" });
    expect(matchContact({ fullName: "Person Two", companyId: "c2" }, known).outcome).toBe("new");
  });

  it("a shared company phone number never merges contacts", () => {
    expect(matchContact({ fullName: "Person Three", companyId: "c1", phone: "+44 20 7946 0000" }, known).outcome).toBe("new");
  });
});

// -----------------------------------------------------------------------------
describe("company and location schemas", () => {
  it("derives normalized name, domain (from website if needed) and phone", () => {
    const c = companyInputSchema.parse({ canonicalName: "  Example Co.  ", websiteUrl: "https://www.example.test/about", primaryPhone: "+44 20 7946 0000" });
    expect(c).toMatchObject({ canonicalName: "Example Co.", normalizedName: "example co", primaryDomain: "example.test", primaryPhoneNormalized: "+442079460000", qualificationState: "unreviewed" });
    expect(companyInputSchema.parse({ canonicalName: "Local Co", primaryPhone: "(555) 010-0000" }).primaryPhoneNormalized).toBeNull();
  });

  it("rejects bad names, domains, URLs, phones, ranges and states", () => {
    const bad = (v: object) => companyInputSchema.safeParse({ canonicalName: "Example", ...v }).success;
    expect(bad({ canonicalName: " " })).toBe(false);
    expect(bad({ primaryDomain: "not a domain" })).toBe(false);
    expect(bad({ websiteUrl: "javascript:alert(1)" })).toBe(false);
    expect(bad({ primaryPhone: "call us" })).toBe(false);
    expect(bad({ employeeCountMin: 10, employeeCountMax: 5 })).toBe(false);
    expect(bad({ employeeCountMin: 1.5 })).toBe(false);
    expect(bad({ employeeCountMin: -1 })).toBe(false);
    expect(bad({ qualificationState: "hot" })).toBe(false);
    expect(bad({ notes: "x".repeat(5001) })).toBe(false);
    expect(bad({ workspaceId: id() })).toBe(false);
  });

  it("accepts international locations, partial locations and no location", () => {
    expect(locationSchema.parse({ countryCode: "jp", city: "City" })).toMatchObject({ countryCode: "JP", city: "City", region: null });
    expect(locationSchema.parse({ region: "Some Region" })).toMatchObject({ region: "Some Region", countryCode: null });
    expect(locationSchema.parse({ city: " " })).toBeNull();
    expect(locationSchema.safeParse({ countryCode: "ZZ" }).success).toBe(false);
    expect(formatLocation({ countryCode: "BR", region: "Region", city: "City", postalCode: null, addressLine1: null, addressLine2: null })).toMatch(/^City, Region, Brazil$/);
  });

  it("qualification updates accept only the four states", () => {
    expect(qualificationUpdateSchema.safeParse({ state: "qualified", reason: "" }).success).toBe(true);
    expect(qualificationUpdateSchema.parse({ state: "needs_review", reason: "  " }).reason).toBeNull();
    expect(qualificationUpdateSchema.safeParse({ state: "won", reason: null }).success).toBe(false);
    expect(qualificationUpdateSchema.safeParse({ state: "qualified", reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("contact schema", () => {
  const companyId = id();
  it("a name alone is enough; full name is built from parts", () => {
    expect(contactInputSchema.parse({ companyId, firstName: "Ana", lastName: "Silva" })).toMatchObject({ fullName: "Ana Silva", normalizedEmail: null, status: "active" });
    expect(contactInputSchema.parse({ companyId, fullName: "Person", email: "Person@Example.TEST" }).normalizedEmail).toBe("person@example.test");
  });

  it("rejects nameless contacts, bad emails, non-https profiles and unknown statuses", () => {
    expect(contactInputSchema.safeParse({ companyId }).success).toBe(false);
    expect(contactInputSchema.safeParse({ companyId, fullName: "P", email: "nope" }).success).toBe(false);
    expect(contactInputSchema.safeParse({ companyId, fullName: "P", linkedinUrl: "http://x.example.test" }).success).toBe(false);
    expect(contactInputSchema.safeParse({ companyId, fullName: "P", status: "customer" }).success).toBe(false);
  });
});

describe("source evidence schema", () => {
  const base = { companyId: id(), sourceKind: "csv" };
  it("accepts company or contact evidence with documented or pattern-valid field keys", () => {
    expect(leadSourceInputSchema.safeParse({ ...base, fieldKey: "company.phone", observedValue: "+44 20 7946 0000", confidence: 90 }).success).toBe(true);
    expect(leadSourceInputSchema.safeParse({ contactId: id(), sourceKind: "manual", fieldKey: "contact.title" }).success).toBe(true);
    expect(leadSourceInputSchema.safeParse({ ...base, fieldKey: "company.category" }).success).toBe(true);
    expect(fieldLabel("company.employee_range")).toBe("Employees");
    expect(fieldLabel("company.category")).toBe("category");
  });

  it("requires a subject and validates kind, key, confidence, provider and size", () => {
    expect(leadSourceInputSchema.safeParse({ sourceKind: "manual" }).success).toBe(false);
    expect(leadSourceInputSchema.safeParse({ ...base, sourceKind: "scraper" }).success).toBe(false);
    expect(leadSourceInputSchema.safeParse({ ...base, fieldKey: "deal.value" }).success).toBe(false);
    expect(leadSourceInputSchema.safeParse({ ...base, confidence: 101 }).success).toBe(false);
    expect(leadSourceInputSchema.safeParse({ ...base, confidence: -1 }).success).toBe(false);
    expect(leadSourceInputSchema.safeParse({ ...base, externalRecordId: "r-1" }).success).toBe(false);
    expect(leadSourceInputSchema.parse({ ...base, providerKey: "Example-Directory", externalRecordId: "r-1" }).providerKey).toBe("example-directory");
    expect(leadSourceInputSchema.safeParse({ ...base, providerKey: "bad key" }).success).toBe(false);
    expect(leadSourceInputSchema.safeParse({ ...base, observedValue: { raw: "x".repeat(3000) } }).success).toBe(false);
    expect(formatObserved({ a: "x".repeat(200) })?.endsWith("…")).toBe(true);
  });
});

describe("score storage schema", () => {
  const base = { companyId: id(), icpProfileId: id(), icpRevision: 3, breakdown: null, scoredAt: null };
  it("pending results have no score; scored results need score, grade and time", () => {
    expect(leadScoreSchema.safeParse({ ...base, score: null, grade: null, status: "pending" }).success).toBe(true);
    expect(leadScoreSchema.safeParse({ ...base, score: 80, grade: "A", status: "pending" }).success).toBe(false);
    expect(leadScoreSchema.safeParse({ ...base, score: 80, grade: "A", status: "scored" }).success).toBe(false);
    expect(leadScoreSchema.safeParse({ ...base, score: 80, grade: "A", status: "scored", scoredAt: new Date().toISOString() }).success).toBe(true);
  });

  it("bounds score, grade and revision; breakdown is small and fixed-shape", () => {
    const scored = { ...base, status: "scored", scoredAt: new Date().toISOString() };
    expect(leadScoreSchema.safeParse({ ...scored, score: 101, grade: "A" }).success).toBe(false);
    expect(leadScoreSchema.safeParse({ ...scored, score: 50, grade: "D" }).success).toBe(false);
    expect(leadScoreSchema.safeParse({ ...scored, score: 50, grade: "B", icpRevision: 0 }).success).toBe(false);
    expect(scoreBreakdownSchema.safeParse({ company_fit: 40, exclusion_penalty: 10 }).success).toBe(true);
    expect(scoreBreakdownSchema.safeParse({ company_fit: 140 }).success).toBe(false);
    expect(scoreBreakdownSchema.safeParse({ raw_payload: "x" }).success).toBe(false);
  });
});

describe("suppression schema", () => {
  const companyId = id();
  it("company scope targets the company; contact scope needs the contact", () => {
    expect(suppressionInputSchema.safeParse({ scope: "company", companyId }).success).toBe(true);
    expect(suppressionInputSchema.safeParse({ scope: "company", companyId, contactId: id() }).success).toBe(false);
    expect(suppressionInputSchema.safeParse({ scope: "contact", companyId }).success).toBe(false);
    expect(suppressionInputSchema.safeParse({ scope: "contact", companyId, contactId: id(), reason: "Asked not to be called" }).success).toBe(true);
    expect(suppressionInputSchema.safeParse({ scope: "workspace", companyId }).success).toBe(false);
    expect(suppressionInputSchema.safeParse({ scope: "company", companyId, reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("display helpers", () => {
  it("formats employee ranges", () => {
    expect(formatEmployees(10, 50)).toBe("10–50 employees");
    expect(formatEmployees(null, null)).toBeNull();
  });
});
