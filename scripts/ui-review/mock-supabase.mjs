#!/usr/bin/env node
/**
 * UI REVIEW HARNESS ONLY — NOT A SECURITY BOUNDARY, NOT USED IN TESTS OF RLS.
 *
 * A tiny stand-in for the Supabase Auth + PostgREST endpoints the app calls,
 * so the authenticated shell can be rendered and screenshotted on machines
 * where the Docker-based local Supabase stack cannot run. It mimics
 * membership-based visibility so the switcher looks realistic, but tenant
 * isolation is proven exclusively by tests/db against real Postgres RLS.
 *
 * Since P0-E1-S2 it also accepts the Settings writes (workspace profile and
 * icp_profiles) for owners/admins, in memory, so the editors can be exercised.
 * It does NOT validate jsonb or enforce constraints; that is the database's
 * and the server actions' job, and is tested in tests/db and tests/unit.
 *
 * Since P1-E2 it also stands in for list_companies / ingest_lead /
 * stage_import_rows (plain JS, see the *Rpc functions), import_batches and
 * import_rows, and restriction add/lift, so manual entry and the CSV import
 * workflow can be driven end to end. Only the few rules the UI surfaces are
 * imitated (one active company per domain, one primary contact, frozen
 * committed rows, owner/admin lifting); everything else is proven in tests/db.
 *
 * Since P1-E4 it also serves a FICTIONAL company-enrichment provider (Domain
 * Finder + Company Enrichment shapes, reached via HUNTER_API_ENDPOINT in review
 * runs only), the enrichment tables, and ingest_lead's enrichment path
 * (provider evidence, discovery identity link, run completion).
 *
 * Since P1-E5 it also serves a FICTIONAL Domain Search (contact discovery),
 * the contact-discovery tables and commit_contact_candidate.
 *
 * Since P1-E6 it also stands in for scoring_input (canonical scoring input +
 * fingerprint), save_lead_score, list_companies currentness and
 * company_signal_observations, with a fictional scoring configuration on the
 * Beta profile. The scoring itself is the app's TypeScript engine.
 *
 * Since P1-E7 it also stands in for the trusted score writer
 * (save_lead_score_trusted, accepted ONLY with the review service key, never
 * with a user session), workspaces.timezone, contact_attempts /
 * follow_up_tasks, record_contact_attempt, the task functions and the Today
 * reads. With MOCK_TODAY=1 it adds fictional Today fixtures to Beta (other
 * reviews run without them, so their data is unchanged).
 *
 * Usage: node scripts/ui-review/mock-supabase.mjs   (listens on :54321)
 * Data mirrors supabase/seed.sql (generic example data only).
 */
import { createHash } from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54321);
const PASSWORD = "vleeds-dev-password";

const ORGS = [
  { id: "10000000-0000-4000-a000-00000000000a", name: "Example Org A", slug: "example-org-a" },
  { id: "10000000-0000-4000-a000-00000000000b", name: "Example Org B", slug: "example-org-b" },
];
const USERS = [
  { id: "00000000-0000-4000-a000-00000000000a", email: "owner.a@example.test" },
  { id: "00000000-0000-4000-a000-00000000000b", email: "member.a@example.test" },
  { id: "00000000-0000-4000-a000-00000000000c", email: "owner.b@example.test" },
  { id: "00000000-0000-4000-a000-00000000000d", email: "multi@example.test" },
  { id: "00000000-0000-4000-a000-00000000000e", email: "new@example.test" },
];
const MEMBERSHIPS = [
  [ORGS[0].id, USERS[0].id, "owner"],
  [ORGS[0].id, USERS[1].id, "member"],
  [ORGS[0].id, USERS[3].id, "admin"],
  [ORGS[1].id, USERS[2].id, "owner"],
  [ORGS[1].id, USERS[3].id, "member"],
].map(([organization_id, user_id, role], i) => ({ id: `m${i}`, organization_id, user_id, role }));
const now = new Date().toISOString();
const WORKSPACES = [
  {
    id: "20000000-0000-4000-a000-00000000000a",
    organization_id: ORGS[0].id,
    name: "Alpha Workspace",
    slug: "alpha",
    description: "Generic development workspace.",
    website_url: "https://alpha.example.test",
    primary_domain: "alpha.example.test",
  },
  {
    id: "20000000-0000-4000-a000-00000000000b",
    organization_id: ORGS[0].id,
    name: "Beta Workspace",
    slug: "beta",
    description: "Second workspace in the same organization.",
    website_url: null,
    primary_domain: null,
  },
  {
    id: "20000000-0000-4000-a000-00000000000c",
    organization_id: ORGS[1].id,
    name: "Gamma Workspace",
    slug: "gamma",
    description: "Workspace in an unrelated organization.",
    website_url: "https://gamma.example.test",
    primary_domain: "gamma.example.test",
  },
].map((w) => ({ logo_url: null, settings: {}, timezone: "UTC", archived_at: null, created_by: null, created_at: now, updated_at: now, ...w }));

// ICP profiles start empty, so the review can walk through first-time configuration.
// In-memory only: restart the mock to reset.
const ICP_PROFILES = [];

// -----------------------------------------------------------------------------
// Lead core (P1-E1) — FICTIONAL, GENERIC fixtures for UI review only.
// Alpha has no companies (empty state); Beta is populated; Gamma (another
// organization) has one company that Org A users must never see.
// -----------------------------------------------------------------------------
const BETA = WORKSPACES[1].id;
const GAMMA = WORKSPACES[2].id;
const days = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const fid = (prefix, n) => `${prefix}-0000-4000-a000-${String(n).padStart(12, "0")}`;
const C = { northwind: fid("30000000", 1), lumen: fid("30000000", 2), cedar: fid("30000000", 3), brightwave: fid("30000000", 4), atlas: fid("30000000", 5), gammaCo: fid("30000000", 9) };
const P = { avery: fid("40000000", 1), jordan: fid("40000000", 2), sam: fid("40000000", 3), riley: fid("40000000", 4), morgan: fid("40000000", 5), gammaP: fid("40000000", 9) };
const BETA_ICP = fid("50000000", 1);

ICP_PROFILES.push({
  id: BETA_ICP, workspace_id: BETA, name: "Default profile", description: null, is_default: true, archived_at: null,
  schema_version: 1, revision: 3,
  // P1-E3: generic categories and places so Discover can offer starting points.
  ideal_customer: { industries: ["Bookkeeping services", "Print shops", "Data analytics"], companySize: { minEmployees: 10, maxEmployees: 200 }, characteristics: ["multi-location"], keywords: [], notes: "Notes are never scored." },
  target_geographies: [
    { id: fid("51000000", 1), countryCode: "CA", countryName: "Canada", region: "Ontario", city: "Toronto", label: null },
    { id: fid("51000000", 2), countryCode: "FR", countryName: "France", region: null, city: "Lyon", label: null },
  ],
  // P1-E5: generic fictional roles so contact discovery can target them.
  decision_maker_titles: [
    { id: fid("52000000", 1), title: "Head of Operations", priority: "primary", seniority: "executive" },
    { id: fid("52000000", 2), title: "Operations Director", priority: "primary", seniority: "director" },
    { id: fid("52000000", 3), title: "Operations Manager", priority: "secondary", seniority: "manager" },
    { id: fid("52000000", 4), title: "Finance Lead", priority: "secondary", seniority: null },
    { id: fid("52000000", 5), title: "Office Manager", priority: "fallback", seniority: null },
  ],
  // P1-E6: fictional signals and a scoring model.
  buying_signals: [
    { id: fid("53000000", 1), name: "Expanding operations", description: "Hiring or opening capacity", weight: 60, enabled: true },
    { id: fid("53000000", 2), name: "New office opening", description: null, weight: 40, enabled: true },
  ],
  exclusion_signals: [
    { id: fid("54000000", 1), name: "Consumer-only business", description: "Sells only to individuals", behavior: "hard_exclude", penalty: null, enabled: true },
    { id: fid("54000000", 2), name: "Uses a competing tool", description: null, behavior: "penalty", penalty: 20, enabled: true },
  ],
  scoring_model: { thresholds: { a: 75, b: 50 }, categoryWeights: { company_fit: 40, geography_fit: 20, decision_maker_fit: 20, buying_signal_fit: 20 } },
  created_by: null, created_at: now, updated_at: now,
});
// Two more Beta profiles (not default): one evaluable on geography only, one without criteria.
ICP_PROFILES.push(
  {
    id: fid("50000000", 2), workspace_id: BETA, name: "Second profile", description: null, is_default: false, archived_at: null, schema_version: 1, revision: 1,
    ideal_customer: null, target_geographies: [{ id: fid("51000000", 3), countryCode: "DE", countryName: "Germany", region: null, city: null, label: null }],
    decision_maker_titles: null, buying_signals: null, exclusion_signals: null,
    scoring_model: { thresholds: { a: 80, b: 40 }, categoryWeights: { company_fit: 25, geography_fit: 25, decision_maker_fit: 25, buying_signal_fit: 25 } },
    created_by: null, created_at: now, updated_at: now,
  },
  {
    id: fid("50000000", 3), workspace_id: BETA, name: "Draft profile", description: null, is_default: false, archived_at: null, schema_version: 1, revision: 1,
    ideal_customer: null, target_geographies: null, decision_maker_titles: null, buying_signals: null, exclusion_signals: null,
    scoring_model: { thresholds: { a: 75, b: 50 }, categoryWeights: { company_fit: 40, geography_fit: 20, decision_maker_fit: 20, buying_signal_fit: 20 } },
    created_by: null, created_at: now, updated_at: now,
  },
);

const company = (o) => ({
  workspace_id: BETA, industry: null, description: null, website_url: null, primary_domain: null, primary_phone: null, primary_phone_normalized: null, location: null,
  employee_count_min: null, employee_count_max: null, qualification_state: "unreviewed", qualification_reason: null, notes: null,
  archived_at: null, created_by: null, created_at: days(30), ...o,
});
const COMPANIES = [
  company({ id: C.northwind, industry: "Data analytics", description: "Data analytics consultancy with a multi-location team.", canonical_name: "Northwind Analytics", normalized_name: "northwind analytics", website_url: "https://www.northwind.example.test", primary_domain: "northwind.example.test", primary_phone: "+44 20 7946 0000", primary_phone_normalized: "+442079460000", location: { countryCode: "GB", region: null, city: "London", postalCode: "EC1A 1AA", addressLine1: "1 Example Street", addressLine2: null }, employee_count_min: 50, employee_count_max: 200, qualification_state: "needs_review", notes: "Met at an industry event; asked for a follow-up next quarter.", updated_at: days(1) }),
  company({ id: C.lumen, canonical_name: "Lumen Field Instruments", normalized_name: "lumen field instruments", website_url: "https://lumen.example.test", primary_domain: "lumen.example.test", location: { countryCode: "DE", region: "Bavaria", city: "Munich", postalCode: null, addressLine1: null, addressLine2: null }, employee_count_min: 10, employee_count_max: 50, qualification_state: "qualified", qualification_reason: "Matches size and region.", updated_at: days(2) }),
  company({ id: C.cedar, canonical_name: "Cedar Point Studio", normalized_name: "cedar point studio", primary_domain: "cedarpoint.example.test", location: { countryCode: "CA", region: "Ontario", city: "Toronto", postalCode: null, addressLine1: null, addressLine2: null }, qualification_state: "unqualified", qualification_reason: "Existing partner.", updated_at: days(4) }),
  company({ id: C.brightwave, canonical_name: "Brightwave Systems", normalized_name: "brightwave systems", primary_domain: "brightwave.example.test", location: { countryCode: "AU", region: "New South Wales", city: "Sydney", postalCode: null, addressLine1: null, addressLine2: null }, updated_at: days(6) }),
  company({ id: C.atlas, canonical_name: "Atlas Ridge Supply", normalized_name: "atlas ridge supply", location: { countryCode: "BR", region: null, city: "Curitiba", postalCode: null, addressLine1: null, addressLine2: null }, updated_at: days(9) }),
  company({ id: C.gammaCo, workspace_id: GAMMA, canonical_name: "Gamma Only Co", normalized_name: "gamma only co", primary_domain: "northwind.example.test", updated_at: days(1) }),
];
const contact = (o) => ({
  workspace_id: BETA, first_name: null, last_name: null, job_title: null, seniority: null, email: null, normalized_email: null, phone: null,
  phone_normalized: null, linkedin_url: null, is_primary: false, status: "active", notes: null, archived_at: null, created_by: null, created_at: days(20), updated_at: days(20), ...o,
});
const CONTACTS = [
  contact({ id: P.avery, company_id: C.northwind, full_name: "Avery Stone", job_title: "Head of Operations", email: "avery.stone@northwind.example.test", normalized_email: "avery.stone@northwind.example.test", phone: "+44 20 7946 0001", is_primary: true, linkedin_url: "https://profiles.example.test/avery-stone" }),
  contact({ id: P.jordan, company_id: C.northwind, full_name: "Jordan Pike", job_title: "Finance Lead", email: "jordan.pike@northwind.example.test", normalized_email: "jordan.pike@northwind.example.test" }),
  contact({ id: P.sam, company_id: C.northwind, full_name: "Sam Ortiz", job_title: "Office Coordinator", status: "left_company" }),
  contact({ id: P.riley, company_id: C.lumen, full_name: "Riley Brandt", job_title: "Managing Director", is_primary: true, phone: "+49 89 0000 0000", email: "riley.brandt@lumen.example.test", normalized_email: "riley.brandt@lumen.example.test" }),
  contact({ id: P.morgan, company_id: C.cedar, full_name: "Morgan Lee", job_title: "Studio Lead", is_primary: true }),
  contact({ id: P.gammaP, workspace_id: GAMMA, company_id: C.gammaCo, full_name: "Gamma Person", is_primary: true }),
];
const source = (n, o) => ({
  id: fid("60000000", n), workspace_id: BETA, company_id: null, contact_id: null, provider_key: null, external_record_id: null, source_url: null,
  field_key: null, observed_value: null, confidence: null, observed_at: days(10 + n), created_by: null, created_at: days(10 + n), ...o,
});
const LEAD_SOURCES = [
  source(1, { company_id: C.northwind, source_kind: "manual", field_key: "company.website", observed_value: "northwind.example.test" }),
  source(2, { company_id: C.northwind, source_kind: "csv", field_key: "company.phone", observed_value: "+44 20 7946 0000", confidence: 90 }),
  source(3, { company_id: C.northwind, contact_id: P.avery, source_kind: "public_dataset", provider_key: "example-registry", external_record_id: "rec-1001", field_key: "contact.title", observed_value: "Head of Operations", confidence: 75, source_url: "https://registry.example.test/rec-1001" }),
  source(4, { contact_id: P.jordan, source_kind: "website", field_key: "contact.email", observed_value: "jordan.pike@northwind.example.test", confidence: 60 }),
  source(5, { company_id: C.lumen, source_kind: "csv", field_key: "company.employee_range", observed_value: { min: 10, max: 50 }, confidence: 85 }),
  source(6, { company_id: C.gammaCo, workspace_id: GAMMA, source_kind: "manual", field_key: "company.name", observed_value: "Gamma Only Co" }),
  // P1-E3: a durable provider reference linking a (mock) Place ID to an existing company. No Places content.
  source(7, { company_id: C.lumen, source_kind: "api", provider_key: "google_places", external_record_id: "mock-place-003", field_key: "company.provider_reference", observed_value: null }),
];
const LEAD_SCORES = [
  { id: fid("70000000", 1), workspace_id: BETA, company_id: C.northwind, icp_profile_id: BETA_ICP, icp_revision: 3, score: 84, grade: "A", breakdown: null, status: "scored", scored_at: days(1), created_at: days(1), updated_at: days(1), input_fingerprint: null, coverage_percent: 75, explanation: null, effective_weights: null, exclusion_reasons: null },
  { id: fid("70000000", 2), workspace_id: BETA, company_id: C.northwind, icp_profile_id: BETA_ICP, icp_revision: 2, score: 71, grade: "B", breakdown: null, status: "stale", scored_at: days(12), created_at: days(12), updated_at: days(12), input_fingerprint: null, coverage_percent: null, explanation: null, effective_weights: null, exclusion_reasons: null },
  { id: fid("70000000", 3), workspace_id: BETA, company_id: C.brightwave, icp_profile_id: BETA_ICP, icp_revision: 3, score: null, grade: null, breakdown: null, status: "pending", scored_at: null, created_at: days(1), updated_at: days(1) },
];
const SUPPRESSIONS = [
  { id: fid("80000000", 1), workspace_id: BETA, company_id: C.cedar, contact_id: null, scope: "company", reason: "Existing partner; contact through the partnership team only.", active: true, created_by: null, created_at: days(3), updated_at: days(3) },
  { id: fid("80000000", 2), workspace_id: BETA, company_id: C.northwind, contact_id: P.jordan, scope: "contact", reason: "Asked not to be contacted.", active: true, created_by: null, created_at: days(5), updated_at: days(5) },
];
// P1-E2 staging tables start empty; the review creates imports through the UI.
const IMPORT_BATCHES = [];
const IMPORT_ROWS = [];
// P1-E3 discovery tables start empty; the review runs searches through the UI.
const DISCOVERY_RUNS = [];
const DISCOVERY_CANDIDATES = [];
const PROVIDER_USAGE = [];
// P1-E4 enrichment tables start empty.
const ENRICHMENT_RUNS = [];
const ENRICHMENT_RESULTS = [];
// P1-E5 contact-discovery tables start empty.
const CONTACT_RUNS = [];
// P1-E6 signal observations start empty.
const SIGNAL_OBSERVATIONS = [];
// P1-E7 contact workflow (Today fixtures below, only with MOCK_TODAY=1).
const CONTACT_ATTEMPTS = [];
const FOLLOW_UP_TASKS = [];
// The review-only "service role" key for the trusted score writer. Not a secret; never valid anywhere else.
const SERVICE_REVIEW_KEY = "review-only-service-role-key-not-a-secret";
const CONTACT_CANDIDATES = [];
const LEAD_TABLES = {
  contact_attempts: CONTACT_ATTEMPTS,
  follow_up_tasks: FOLLOW_UP_TASKS,
  company_signal_observations: SIGNAL_OBSERVATIONS,
  contact_discovery_runs: CONTACT_RUNS,
  contact_discovery_candidates: CONTACT_CANDIDATES,
  company_enrichment_runs: ENRICHMENT_RUNS,
  company_enrichment_results: ENRICHMENT_RESULTS,
  discovery_runs: DISCOVERY_RUNS,
  discovery_candidates: DISCOVERY_CANDIDATES,
  provider_usage_events: PROVIDER_USAGE,
  companies: COMPANIES,
  contacts: CONTACTS,
  lead_sources: LEAD_SOURCES,
  lead_scores: LEAD_SCORES,
  suppression_records: SUPPRESSIONS,
  import_batches: IMPORT_BATCHES,
  import_rows: IMPORT_ROWS,
};
const COMPANY_UPDATE_COLUMNS = new Set(["qualification_state", "qualification_reason"]);
const isMemberOfWorkspace = (user, workspaceId) => orgIdsFor(user).has(orgOfWorkspace(workspaceId));
const ICP_CONFIG_COLUMNS = [
  "name",
  "description",
  "schema_version",
  "ideal_customer",
  "target_geographies",
  "decision_maker_titles",
  "buying_signals",
  "exclusion_signals",
  "scoring_model",
];
const ICP_UPDATE_COLUMNS = new Set([...ICP_CONFIG_COLUMNS, "is_default", "archived_at"]);
const WORKSPACE_UPDATE_COLUMNS = new Set(["name", "slug", "description", "website_url", "primary_domain", "logo_url", "settings", "timezone", "archived_at"]);
const orgOfWorkspace = (workspaceId) => WORKSPACES.find((w) => w.id === workspaceId)?.organization_id;
const isAdminOf = (user, organizationId) =>
  !!user && MEMBERSHIPS.some((m) => m.user_id === user.id && m.organization_id === organizationId && (m.role === "owner" || m.role === "admin"));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function session(user) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const access_token = [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat, exp }),
    "mock-signature",
  ].join(".");
  return {
    access_token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh.${user.id}`,
    user: userJson(user),
  };
}

function userJson(user) {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: now,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

function userFromAuth(req) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  try {
    const { sub } = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return USERS.find((u) => u.id === sub) ?? null;
  } catch {
    return null;
  }
}

const orgIdsFor = (user) => new Set(MEMBERSHIPS.filter((m) => m.user_id === user?.id).map((m) => m.organization_id));
const embedOrg = (row, select) =>
  select.includes("organization:") ? { ...row, organization: ORGS.find((o) => o.id === row.organization_id) } : row;

function applyFilters(rows, params) {
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (raw.startsWith("eq.")) rows = rows.filter((r) => String(r[key]) === raw.slice(3));
    else if (raw === "is.null") rows = rows.filter((r) => r[key] === null);
    else if (raw.startsWith("gte.")) rows = rows.filter((r) => String(r[key]) >= raw.slice(4));
    else if (raw.startsWith("lt.")) rows = rows.filter((r) => String(r[key]) < raw.slice(3));
    else if (raw.startsWith("in.(")) {
      const set = new Set(raw.slice(4, -1).split(","));
      rows = rows.filter((r) => set.has(String(r[key])));
    }
  }
  return rows;
}

const compare = (a, b) =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? ""));
const wantsRows = (req) => String(req.headers.prefer ?? "").includes("return=representation");
const isFinalBatch = (batchId) => ["completed", "cancelled"].includes(IMPORT_BATCHES.find((b) => b.id === batchId)?.status);

// ---- P1-E2 RPC stand-ins (mirror supabase/migrations/20261010000000_manual_csv_ingestion.sql) ----
function listCompaniesRpc(a) {
  const profile = ICP_PROFILES.find((x) => x.workspace_id === a.p_workspace_id && x.is_default && !x.archived_at);
  let rows = COMPANIES.filter((c) => c.workspace_id === a.p_workspace_id && !c.archived_at).map((c) => {
    const s = profile && LEAD_SCORES.find((x) => x.company_id === c.id && x.icp_profile_id === profile.id && ["scored", "excluded"].includes(x.status) && x.icp_revision === profile.revision);
    const any = profile && LEAD_SCORES.some((x) => x.company_id === c.id && x.icp_profile_id === profile.id && ["scored", "excluded", "stale"].includes(x.status));
    const state = !s ? (any ? "outdated" : "none") : s.input_fingerprint === scoringInput(a.p_workspace_id, c.id, profile.id)?.fingerprint ? (s.status === "excluded" ? "excluded" : "current") : "outdated";
    return {
      id: c.id, canonical_name: c.canonical_name, normalized_name: c.normalized_name, primary_domain: c.primary_domain, location: c.location,
      qualification_state: c.qualification_state, updated_at: c.updated_at, grade: state === "current" ? s.grade : null, score: state === "current" ? s.score : null,
      score_state: state, coverage_percent: state === "current" || state === "excluded" ? s.coverage_percent : null,
      restricted: SUPPRESSIONS.some((r) => r.company_id === c.id && r.scope === "company" && r.active),
      contact_count: CONTACTS.filter((k) => k.company_id === c.id && !k.archived_at).length,
    };
  });
  rows = rows.filter(
    (b) =>
      (a.p_qualification == null || b.qualification_state === a.p_qualification) &&
      (a.p_grade == null || (["A", "B", "C"].includes(a.p_grade) ? b.grade === a.p_grade : b.score_state === a.p_grade)) &&
      (a.p_restricted == null || b.restricted === a.p_restricted) &&
      (a.p_has_contact == null || b.contact_count > 0 === a.p_has_contact) &&
      (a.p_country == null || b.location?.countryCode === a.p_country),
  );
  const qual = ["qualified", "needs_review", "unreviewed", "unqualified"];
  const key = {
    name: (r) => [r.normalized_name],
    qualification: (r) => [qual.indexOf(r.qualification_state)],
    grade: (r) => [["A", "B", "C"].indexOf(r.grade) + 1 || { excluded: 4, outdated: 5 }[r.score_state] || 6],
  }[a.p_sort];
  rows.sort((x, y) => {
    if (key) {
      const d = compare(key(x)[0], key(y)[0]);
      if (d) return d;
    } else {
      const d = compare(y.updated_at, x.updated_at);
      if (d) return d;
    }
    return compare(x.normalized_name, y.normalized_name) || compare(x.id, y.id);
  });
  const total = rows.length;
  const limit = Math.min(Math.max(a.p_limit ?? 25, 1), 100);
  const offset = Math.max(a.p_offset ?? 0, 0);
  return rows.slice(offset, offset + limit).map((r) => {
    const out = { ...r, total_count: total };
    delete out.normalized_name;
    return out;
  });
}

// ---- P1-E6: scoring input (mirrors public.scoring_input) ----
const canonical = (v) =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v ?? null);
function scoringInput(ws, companyId, profileId) {
  const c = COMPANIES.find((x) => x.id === companyId && x.workspace_id === ws && !x.archived_at);
  const p = ICP_PROFILES.find((x) => x.id === profileId && x.workspace_id === ws && !x.archived_at);
  if (!c || !p) return null;
  const input = {
    v: 1,
    company: {
      id: c.id, name: c.canonical_name, industry: c.industry ?? null, description: c.description ?? null,
      employee_count_min: c.employee_count_min, employee_count_max: c.employee_count_max,
      country: c.location?.countryCode ?? null, region: c.location?.region ?? null, city: c.location?.city ?? null,
    },
    tags: [...new Set(LEAD_SOURCES.filter((e) => e.workspace_id === ws && e.company_id === c.id && !e.contact_id && e.field_key === "company.tags" && typeof e.observed_value === "string").map((e) => e.observed_value))].sort(),
    contacts: CONTACTS.filter((k) => k.workspace_id === ws && k.company_id === c.id && !k.archived_at && k.status !== "left_company")
      .map((k) => ({ title: k.job_title ?? null })).sort((x, y) => (x.title ?? "").localeCompare(y.title ?? "")),
    signals: SIGNAL_OBSERVATIONS.filter((o) => o.workspace_id === ws && o.company_id === c.id && o.icp_profile_id === p.id && o.icp_revision === p.revision)
      .map((o) => ({ kind: o.signal_kind, id: o.signal_id, state: o.state })).sort((x, y) => `${x.kind}${x.id}`.localeCompare(`${y.kind}${y.id}`)),
    icp: {
      id: p.id, revision: p.revision, ideal_customer: p.ideal_customer, target_geographies: p.target_geographies, decision_maker_titles: p.decision_maker_titles,
      buying_signals: p.buying_signals, exclusion_signals: p.exclusion_signals, scoring_model: p.scoring_model,
    },
  };
  return { input, fingerprint: createHash("sha256").update(canonical(input)).digest("hex") };
}
function saveLeadScoreRpc(a) {
  const fail = (status, code, message) => ({ status, error: { code, message } });
  const p = ICP_PROFILES.find((x) => x.id === a.p_icp_profile_id && x.workspace_id === a.p_workspace_id && !x.archived_at);
  if (!p) return fail(403, "42501", "profile");
  if (p.revision !== a.p_icp_revision) return fail(400, "55000", "profile changed");
  if (scoringInput(a.p_workspace_id, a.p_company_id, p.id)?.fingerprint !== a.p_input_fingerprint) return fail(400, "55000", "inputs changed");
  if (a.p_status === "scored") {
    const t = p.scoring_model.thresholds;
    if (a.p_grade !== (a.p_score >= t.a ? "A" : a.p_score >= t.b ? "B" : "C")) return fail(400, "23514", "grade");
  }
  const ts = new Date().toISOString();
  const fields = {
    score: a.p_score, grade: a.p_grade, breakdown: a.p_breakdown, status: a.p_status, scored_at: ts, input_fingerprint: a.p_input_fingerprint,
    coverage_percent: a.p_coverage_percent, explanation: a.p_explanation, effective_weights: a.p_effective_weights, exclusion_reasons: a.p_exclusion_reasons, updated_at: ts,
  };
  let row = LEAD_SCORES.find((x) => x.company_id === a.p_company_id && x.icp_profile_id === p.id && x.icp_revision === p.revision);
  if (row) Object.assign(row, fields);
  else {
    row = { id: crypto.randomUUID(), workspace_id: a.p_workspace_id, company_id: a.p_company_id, icp_profile_id: p.id, icp_revision: p.revision, created_at: ts, ...fields };
    LEAD_SCORES.push(row);
  }
  return { data: row.id };
}
function observationError(o) {
  const p = ICP_PROFILES.find((x) => x.id === o.icp_profile_id && x.workspace_id === o.workspace_id);
  if (!p || p.revision !== o.icp_revision) return { code: "55000", message: "revision" };
  const list = o.signal_kind === "buying" ? p.buying_signals : p.exclusion_signals;
  if (!(list ?? []).some((x) => x.id === o.signal_id)) return { code: "23514", message: "signal" };
  if (!["present", "absent"].includes(o.state)) return { code: "23514", message: "state" };
  return null;
}

// ---- P1-E7: contact workflow (mirrors supabase/migrations/20261015000000_today_contact_workflow.sql) ----
const TRUSTED_WRITES = [];
const DISPOSITIONS = ["no_answer", "left_voicemail", "connected_interested", "connected_not_interested", "callback_requested", "follow_up_needed", "wrong_number", "do_not_contact", "other"];
const NEXT_KINDS = { no_answer: ["retry_call"], left_voicemail: ["retry_call"], connected_interested: ["follow_up"], callback_requested: ["callback"], follow_up_needed: ["follow_up"], other: ["callback", "follow_up", "retry_call"] };
function contactBlocker(ws, companyId, contactId) {
  const c = COMPANIES.find((x) => x.id === companyId && x.workspace_id === ws);
  const k = CONTACTS.find((x) => x.id === contactId && x.company_id === companyId && x.workspace_id === ws);
  if (!c || c.archived_at) return "company_unavailable";
  if (!k || k.archived_at) return "contact_unavailable";
  if (SUPPRESSIONS.some((r) => r.active && r.workspace_id === ws && r.company_id === companyId && r.scope === "company")) return "company_restricted";
  if (SUPPRESSIONS.some((r) => r.active && r.workspace_id === ws && r.company_id === companyId && r.scope === "contact" && r.contact_id === contactId)) return "contact_restricted";
  if (k.status === "left_company") return "contact_left";
  if (!k.phone || !k.phone.trim()) return "no_phone";
  return null;
}
const blockerError = (b) =>
  !b ? null : b.endsWith("_restricted") ? { status: 400, error: { code: "VL001", message: b } } : b.endsWith("_unavailable") ? { status: 403, error: { code: "42501", message: b } } : { status: 400, error: { code: "VL002", message: b } };
const bad = (message) => ({ status: 400, error: { code: "22023", message } });
const futureOk = (due) => due && Date.parse(due) > Date.now() && Date.parse(due) < Date.now() + 5 * 365 * 86_400_000;
function closeTasks(where, status, actor) {
  const ts = new Date().toISOString();
  for (const t of FOLLOW_UP_TASKS.filter((x) => x.status === "open" && where(x))) {
    Object.assign(t, status === "completed" ? { status, completed_at: ts, completed_by: actor } : { status, cancelled_at: ts, cancelled_by: actor }, { updated_at: ts });
  }
}
function workflowRpc(user, fn, a) {
  const ws = a.p_workspace_id;
  const ts = new Date().toISOString();
  if (fn === "record_contact_attempt") {
    const prev = CONTACT_ATTEMPTS.find((x) => x.workspace_id === ws && x.request_id === a.p_request_id);
    if (prev) return prev.contact_id === a.p_contact_id ? { data: { attempt_id: prev.id, task_id: FOLLOW_UP_TASKS.find((t) => t.source_attempt_id === prev.id)?.id ?? null, replayed: true } } : bad("request id reused");
    if (!CONTACTS.some((k) => k.id === a.p_contact_id && k.company_id === a.p_company_id && k.workspace_id === ws)) return { status: 403, error: { code: "42501", message: "contact not available" } };
    if (!DISPOSITIONS.includes(a.p_disposition)) return bad("disposition");
    const blocker = contactBlocker(ws, a.p_company_id, a.p_contact_id);
    if (!(a.p_disposition === "do_not_contact" && blocker === "no_phone") && blockerError(blocker)) return blockerError(blocker);
    const allowed = NEXT_KINDS[a.p_disposition] ?? [];
    if (["callback_requested", "follow_up_needed"].includes(a.p_disposition) && (!a.p_next_kind || !a.p_next_due_at)) return bad("due required");
    if (!!a.p_next_kind !== !!a.p_next_due_at || (a.p_next_kind && !allowed.includes(a.p_next_kind))) return bad("next action");
    if (a.p_next_kind && !futureOk(a.p_next_due_at)) return bad("future");
    const note = a.p_note?.trim() || null;
    if (a.p_disposition === "other" && !note) return bad("note");
    if ((a.p_disposition === "do_not_contact") !== !!a.p_suppression_scope) return bad("scope");
    if (a.p_source_task_id) {
      const t = FOLLOW_UP_TASKS.find((x) => x.id === a.p_source_task_id && x.workspace_id === ws && x.company_id === a.p_company_id && x.contact_id === a.p_contact_id);
      if (!t || t.status !== "open") return { status: 400, error: { code: "VL003", message: "task closed" } };
    }
    const attempt = { id: crypto.randomUUID(), workspace_id: ws, company_id: a.p_company_id, contact_id: a.p_contact_id, source_task_id: a.p_source_task_id ?? null, request_id: a.p_request_id, channel: "phone", disposition: a.p_disposition, note, attempted_at: ts, created_by: user.id, created_at: ts };
    CONTACT_ATTEMPTS.push(attempt);
    if (a.p_source_task_id) closeTasks((t) => t.id === a.p_source_task_id, "completed", user.id);
    let taskId = null;
    if (a.p_next_kind) {
      closeTasks((t) => t.workspace_id === ws && t.contact_id === a.p_contact_id, "cancelled", user.id);
      taskId = crypto.randomUUID();
      FOLLOW_UP_TASKS.push({ id: taskId, workspace_id: ws, company_id: a.p_company_id, contact_id: a.p_contact_id, source_attempt_id: attempt.id, kind: a.p_next_kind, due_at: new Date(a.p_next_due_at).toISOString(), status: "open", note: a.p_next_note?.trim() || null, created_by: user.id, created_at: ts, updated_at: ts, completed_at: null, completed_by: null, cancelled_at: null, cancelled_by: null });
    }
    if (a.p_disposition === "do_not_contact") {
      const contact = a.p_suppression_scope === "contact" ? a.p_contact_id : null;
      if (!SUPPRESSIONS.some((r) => r.active && r.company_id === a.p_company_id && r.scope === a.p_suppression_scope && (r.contact_id ?? null) === contact)) {
        SUPPRESSIONS.push({ id: crypto.randomUUID(), workspace_id: ws, company_id: a.p_company_id, contact_id: contact, scope: a.p_suppression_scope, reason: a.p_suppression_reason?.trim() || null, active: true, created_by: user.id, created_at: ts, updated_at: ts });
      }
      closeTasks((t) => t.workspace_id === ws && t.company_id === a.p_company_id && (a.p_suppression_scope === "company" || t.contact_id === a.p_contact_id), "cancelled", user.id);
    }
    return { data: { attempt_id: attempt.id, task_id: taskId, replayed: false } };
  }
  if (fn === "schedule_follow_up") {
    if (!CONTACTS.some((k) => k.id === a.p_contact_id && k.company_id === a.p_company_id && k.workspace_id === ws)) return { status: 403, error: { code: "42501", message: "contact not available" } };
    const err = blockerError(contactBlocker(ws, a.p_company_id, a.p_contact_id));
    if (err) return err;
    if (!["callback", "follow_up", "retry_call"].includes(a.p_kind)) return bad("kind");
    if (!futureOk(a.p_due_at)) return bad("future");
    if (FOLLOW_UP_TASKS.some((t) => t.contact_id === a.p_contact_id && t.status === "open")) return { status: 400, error: { code: "VL004", message: "open task exists" } };
    const id = crypto.randomUUID();
    FOLLOW_UP_TASKS.push({ id, workspace_id: ws, company_id: a.p_company_id, contact_id: a.p_contact_id, source_attempt_id: null, kind: a.p_kind, due_at: new Date(a.p_due_at).toISOString(), status: "open", note: a.p_note?.trim() || null, created_by: user.id, created_at: ts, updated_at: ts, completed_at: null, completed_by: null, cancelled_at: null, cancelled_by: null });
    return { data: id };
  }
  if (["reschedule_follow_up", "complete_follow_up", "cancel_follow_up"].includes(fn)) {
    const t = FOLLOW_UP_TASKS.find((x) => x.id === a.p_task_id && x.workspace_id === ws);
    if (!t) return { status: 403, error: { code: "42501", message: "task not available" } };
    if (t.status !== "open") return { status: 400, error: { code: "VL003", message: "task closed" } };
    if (fn === "reschedule_follow_up") {
      const err = blockerError(contactBlocker(ws, t.company_id, t.contact_id));
      if (err) return err;
      if (!futureOk(a.p_due_at)) return bad("future");
      Object.assign(t, { due_at: new Date(a.p_due_at).toISOString(), updated_at: ts });
    } else closeTasks((x) => x.id === t.id, fn === "complete_follow_up" ? "completed" : "cancelled", user.id);
    return { data: null };
  }
  if (fn === "today_ready_candidates") {
    const profile = ICP_PROFILES.find((x) => x.workspace_id === ws && x.is_default && !x.archived_at);
    if (!profile) return { data: [] };
    const latest = (contactId) => CONTACT_ATTEMPTS.filter((x) => x.contact_id === contactId).sort((x, y) => y.attempted_at.localeCompare(x.attempted_at))[0];
    const rows = COMPANIES.filter((c) => c.workspace_id === ws && !c.archived_at).flatMap((c) => {
      const sc = LEAD_SCORES.find((x) => x.company_id === c.id && x.icp_profile_id === profile.id && x.icp_revision === profile.revision && x.status === "scored" && ["A", "B"].includes(x.grade));
      if (!sc || sc.input_fingerprint !== scoringInput(ws, c.id, profile.id)?.fingerprint) return [];
      const last = CONTACT_ATTEMPTS.filter((x) => x.company_id === c.id).sort((x, y) => y.attempted_at.localeCompare(x.attempted_at))[0];
      return [{
        company_id: c.id, canonical_name: c.canonical_name, normalized_name: c.normalized_name, location: c.location, qualification_state: c.qualification_state,
        company_restricted: SUPPRESSIONS.some((r) => r.active && r.company_id === c.id && r.scope === "company"),
        grade: sc.grade, score: sc.score, coverage_percent: sc.coverage_percent,
        contacts: CONTACTS.filter((k) => k.company_id === c.id && !k.archived_at).map((k) => {
          const l = latest(k.id);
          return {
            id: k.id, full_name: k.full_name, job_title: k.job_title, phone: k.phone, is_primary: k.is_primary, status: k.status,
            restricted: SUPPRESSIONS.some((r) => r.active && r.company_id === c.id && r.scope === "contact" && r.contact_id === k.id),
            open_task_due_at: FOLLOW_UP_TASKS.find((t) => t.contact_id === k.id && t.status === "open")?.due_at ?? null,
            latest_attempt: l ? { disposition: l.disposition, attempted_at: l.attempted_at } : null,
          };
        }),
        last_attempt: last ? { disposition: last.disposition, attempted_at: last.attempted_at, contact_name: CONTACTS.find((k) => k.id === last.contact_id)?.full_name } : null,
      }];
    });
    rows.sort((x, y) => x.grade.localeCompare(y.grade) || y.score - x.score || x.normalized_name.localeCompare(y.normalized_name));
    return { data: rows.map((r) => { const out = { ...r, total_count: rows.length }; delete out.normalized_name; return out; }) };
  }
  if (fn === "today_due_tasks") {
    const rows = FOLLOW_UP_TASKS.filter((t) => t.workspace_id === ws && t.status === "open" && t.due_at < new Date(a.p_until).toISOString())
      .sort((x, y) => x.due_at.localeCompare(y.due_at) || x.id.localeCompare(y.id))
      .map((t) => {
        const c = COMPANIES.find((x) => x.id === t.company_id);
        const k = CONTACTS.find((x) => x.id === t.contact_id);
        return {
          id: t.id, kind: t.kind, due_at: t.due_at, note: t.note, created_at: t.created_at,
          company_id: c.id, company_name: c.canonical_name, company_archived: !!c.archived_at,
          company_restricted: SUPPRESSIONS.some((r) => r.active && r.company_id === c.id && r.scope === "company"),
          contact_id: k.id, contact_name: k.full_name, job_title: k.job_title, phone: k.phone, contact_status: k.status, contact_archived: !!k.archived_at,
          contact_restricted: SUPPRESSIONS.some((r) => r.active && r.company_id === c.id && r.scope === "contact" && r.contact_id === k.id),
        };
      });
    return { data: rows.slice(0, a.p_limit ?? 200).map((r) => ({ ...r, total_count: rows.length })) };
  }
  return null;
}

function stageRowsRpc(a) {
  let n = 0;
  for (const x of a.p_rows ?? []) {
    const r = IMPORT_ROWS.find((y) => y.id === x.id && y.workspace_id === a.p_workspace_id && y.import_batch_id === a.p_batch_id && y.commit_result === null);
    if (!r) continue;
    Object.assign(r, x, { id: r.id, updated_at: new Date().toISOString() });
    n++;
  }
  return n;
}

function ingestLeadRpc(user, a) {
  const ws = a.p_workspace_id;
  const ts = new Date().toISOString();
  const fail = (status, code, message) => ({ status, error: { code, message } });
  let row = null;
  if (a.p_import_row_id) {
    row = IMPORT_ROWS.find((r) => r.id === a.p_import_row_id && r.workspace_id === ws);
    if (!row) return fail(403, "42501", "import row not found");
    if (row.commit_result) {
      return { data: { already_committed: true, commit_result: row.commit_result, company_id: row.committed_company_id, contact_id: row.committed_contact_id } };
    }
    if (IMPORT_BATCHES.find((b) => b.id === row.import_batch_id)?.status !== "processing") return fail(400, "55000", "import batch is not being committed");
  }
  let erun = null;
  if (a.p_enrichment_run_id) {
    erun = ENRICHMENT_RUNS.find((r) => r.id === a.p_enrichment_run_id && r.workspace_id === ws);
    if (!erun) return fail(403, "42501", "enrichment run not found");
    if (erun.commit_result) return { data: { already_committed: true, commit_result: erun.commit_result, company_id: erun.committed_company_id, contact_id: null } };
    if (erun.status !== "processing") return fail(400, "55000", "enrichment run is not being committed");
  }
  const f = a.p_company?.fields ?? {};
  let company;
  let companyAction;
  const domainTaken = (domain, exceptId) => domain && COMPANIES.some((c) => c.workspace_id === ws && !c.archived_at && c.primary_domain === domain && c.id !== exceptId);
  if (a.p_company?.id) {
    company = COMPANIES.find((c) => c.id === a.p_company.id && c.workspace_id === ws && !c.archived_at);
    if (!company) return fail(403, "42501", "company not found");
    if (domainTaken(f.primary_domain, company.id)) return fail(409, "23505", "duplicate key value");
    Object.assign(company, f, { updated_at: ts });
    companyAction = "merged";
  } else {
    if (domainTaken(f.primary_domain)) return fail(409, "23505", "duplicate key value");
    company = {
      id: crypto.randomUUID(), workspace_id: ws, website_url: null, primary_domain: null, primary_phone: null, primary_phone_normalized: null,
      location: null, employee_count_min: null, employee_count_max: null, industry: null, description: null, qualification_state: "unreviewed", qualification_reason: null,
      notes: null, archived_at: null, created_by: user.id, created_at: ts, updated_at: ts, ...f,
    };
    companyAction = "created";
  }
  let contact = null;
  let contactAction = null;
  const k = a.p_contact?.fields ?? {};
  if (a.p_contact) {
    const hasPrimary = CONTACTS.some((x) => x.company_id === company.id && x.is_primary && !x.archived_at);
    if (a.p_contact.id) {
      contact = CONTACTS.find((x) => x.id === a.p_contact.id && x.company_id === company.id && !x.archived_at);
      if (!contact) return fail(403, "42501", "contact not found at this company");
      Object.assign(contact, k, { updated_at: ts });
      contactAction = "merged";
    } else {
      if (a.p_contact.is_primary && hasPrimary) return fail(409, "23505", "duplicate key value");
      contact = {
        id: crypto.randomUUID(), workspace_id: ws, company_id: company.id, first_name: null, last_name: null, job_title: null, seniority: null,
        email: null, normalized_email: null, phone: null, phone_normalized: null, linkedin_url: null, status: "active", notes: null,
        archived_at: null, created_by: user.id, created_at: ts, updated_at: ts, ...k,
        is_primary: !!a.p_contact.is_primary || (!!a.p_contact.primary_if_none && !hasPrimary),
      };
      contactAction = "created";
    }
  }
  // All checks passed: write everything (one "transaction").
  if (companyAction === "created") COMPANIES.push(company);
  if (contactAction === "created") CONTACTS.push(contact);
  const identityExists = (pk, ext, fk) =>
    ext && LEAD_SOURCES.some((x) => x.workspace_id === ws && x.provider_key === pk && x.external_record_id === ext && x.field_key === fk && x.company_id === company.id);
  for (const e of a.p_evidence ?? []) {
    if (e.subject === "contact" && !contact) continue;
    if (identityExists(e.provider_key, e.external_record_id, e.field_key)) continue; // on conflict do nothing
    LEAD_SOURCES.push({
      id: crypto.randomUUID(), workspace_id: ws, company_id: company.id, contact_id: e.subject === "contact" ? contact.id : null,
      provider_key: e.provider_key ?? null, external_record_id: e.external_record_id ?? null, source_url: null, field_key: e.field_key, observed_value: e.observed_value,
      confidence: null, source_kind: e.source_kind, observed_at: ts, created_by: user.id, created_at: ts,
      import_batch_id: row?.import_batch_id ?? null, import_row_id: row?.id ?? null,
    });
  }
  if (row) Object.assign(row, { commit_result: companyAction, committed_company_id: company.id, committed_contact_id: contact?.id ?? null, updated_at: ts });
  let linked = false;
  if (erun) {
    const found = erun.discovery_candidate_id && DISCOVERY_CANDIDATES.find((c) => c.id === erun.discovery_candidate_id && c.workspace_id === ws);
    // Only while the reference still waits (or already is this company), as in the SQL function.
    const cand = found && (found.decision === "needs_enrichment" || found.match_company_id === company.id) ? found : null;
    if (cand) {
      if (!identityExists(cand.provider_key, cand.external_record_id, "company.provider_reference")) {
        LEAD_SOURCES.push({
          id: crypto.randomUUID(), workspace_id: ws, company_id: company.id, contact_id: null, provider_key: cand.provider_key, external_record_id: cand.external_record_id,
          source_url: null, field_key: "company.provider_reference", observed_value: null, confidence: null, source_kind: "api", observed_at: ts, created_by: user.id, created_at: ts,
          import_batch_id: null, import_row_id: null,
        });
      }
      linked = true;
      if (cand.decision === "needs_enrichment") {
        Object.assign(cand, { decision: "selected", match_state: "existing_company", match_company_id: company.id, decided_by: user.id, decided_at: ts, updated_at: ts });
        refreshDiscoveryCounts(cand.discovery_run_id);
      }
    }
    Object.assign(erun, {
      status: "completed", completed_at: ts, commit_result: companyAction, committed_company_id: company.id,
      commit_notes: Array.isArray(a.p_notes) ? a.p_notes : erun.commit_notes, updated_at: ts,
    });
  }
  return { data: { already_committed: false, commit_result: companyAction, company_id: company.id, contact_id: contact?.id ?? null, contact_result: contactAction, identity_linked: linked } };
}

function refreshDiscoveryCounts(runId) {
  const run = DISCOVERY_RUNS.find((r) => r.id === runId);
  if (!run) return;
  const cs = DISCOVERY_CANDIDATES.filter((c) => c.discovery_run_id === runId);
  run.candidate_count = cs.length;
  run.selected_count = cs.filter((c) => c.decision === "selected" || c.decision === "needs_enrichment").length;
  run.dismissed_count = cs.filter((c) => c.decision === "dismissed").length;
}

// ---- P1-E3: FICTIONAL Places API (New) Text Search responses for UI review ----
// textQuery decides the scenario: "zzz-none" → no results, "zzz-fail" → provider
// outage (503), "zzz-quota" → 429 RESOURCE_EXHAUSTED; anything else → two pages.
const REVIEW_KEY = "review-only-key";
const FLAKY = new Map();
const MOCK_PLACES = [
  ["mock-place-001", "Maple Row Bookkeeping", "10 Sample Street, Sample City", "accounting"],
  ["mock-place-002", "Brightline Print Studio", "22 Example Avenue, Sample City", "print_shop"],
  ["mock-place-003", "Lumen Field Instruments", "5 Placeholder Road, Sample City", "store"],
  ["mock-place-004", "Northgate Ledger Services", "77 Demo Lane, Sample City", "accounting"],
  ["mock-place-005", "Copperleaf Office Supply", "3 Fixture Court, Sample City", "store"],
  ["mock-place-006", "Willowbank Tax Desk", "41 Testing Row, Sample City", "accounting"],
  ["mock-place-007", "Harborview Copy Centre", "8 Mock Plaza, Sample City", "print_shop"],
].map(([id, name, address, type]) => ({ id, displayName: { text: name, languageCode: "en" }, formattedAddress: address, primaryType: type }));
MOCK_PLACES[1].attributions = [{ provider: "Example Data Partner", providerUri: "https://partner.example.test" }];

async function googleTextSearch(req, res) {
  const body = await readJson(req);
  if (req.headers["x-goog-api-key"] !== REVIEW_KEY) return send(res, 403, { error: { code: 403, status: "PERMISSION_DENIED", message: "mock" } });
  if (!String(req.headers["x-goog-fieldmask"] ?? "").includes("places.id")) return send(res, 400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "mock" } });
  const q = String(body.textQuery ?? "");
  if (q.includes("zzz-none")) return send(res, 200, {});
  if (q.includes("zzz-fail")) return send(res, 503, { error: { code: 503, status: "UNAVAILABLE", message: "mock" } });
  if (q.includes("zzz-quota")) return send(res, 429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "mock" } });
  // "zzz-flaky": the first search (both bounded attempts) fails, a later retry succeeds.
  if (q.includes("zzz-flaky") && (FLAKY.get(q) ?? 0) < 2) {
    FLAKY.set(q, (FLAKY.get(q) ?? 0) + 1);
    return send(res, 503, { error: { code: 503, status: "UNAVAILABLE", message: "mock" } });
  }
  const size = Math.min(Math.max(Number(body.pageSize) || 20, 1), 20);
  const start = body.pageToken === "mock-page-2" ? 5 : 0;
  const places = MOCK_PLACES.slice(start, start === 0 ? Math.min(5, size) : MOCK_PLACES.length);
  return send(res, 200, start === 0 ? { places, nextPageToken: "mock-page-2" } : { places });
}

// ---- P1-E4: FICTIONAL enrichment provider (Hunter API v2 shapes) for UI review ----
// Domain Finder: company "zzz-none…" → no suggestions, "zzz-quota…" → 429;
// otherwise two suggestions derived from the name.
// Company Enrichment by domain: nodata.example.test → 404, quota.example.test → 429,
// restricted.example.test → 451, flaky.example.test → 503 twice then data,
// lumen.example.test → the existing Beta company (merge review with conflicts);
// anything else → a company derived from the domain.
const HUNTER_REVIEW_KEY = "review-only-hunter-key";
const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";
const titleOf = (domain) => {
  const first = domain.split(".")[0].replace(/-group$/, "");
  return first.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
};
function hunterDomainFinder(url, res) {
  const company = url.searchParams.get("company") ?? "";
  if (company.length < 3) return send(res, 400, { errors: [{ id: "wrong_params", code: 400, details: "mock" }] });
  if (company.includes("zzz-none")) return send(res, 200, { data: [], meta: { results: 0 } });
  if (company.includes("zzz-quota")) return send(res, 429, { errors: [{ id: "too_many_requests", code: 429, details: "mock" }] });
  const base = slug(company);
  return send(res, 200, {
    data: [
      { domain: base + ".example.test", company_name: company, logo: null, email_count: 8 },
      { domain: base + "-group.example.test", company_name: company + " Group", logo: null, email_count: 2 },
    ],
    meta: { results: 2 },
  });
}
function hunterCompany(url, res) {
  const domain = (url.searchParams.get("domain") ?? "").toLowerCase();
  if (domain === "nodata.example.test") return send(res, 404, { errors: [{ id: "not_found", code: 404, details: "mock" }] });
  if (domain === "quota.example.test") return send(res, 429, { errors: [{ id: "too_many_requests", code: 429, details: "mock" }] });
  if (domain === "restricted.example.test") return send(res, 451, { errors: [{ id: "unavailable", code: 451, details: "mock" }] });
  if (domain === "flaky.example.test" && (FLAKY.get(domain) ?? 0) < 2) {
    FLAKY.set(domain, (FLAKY.get(domain) ?? 0) + 1);
    return send(res, 503, { errors: [{ code: 503, details: "mock" }] });
  }
  if (domain === "lumen.example.test") {
    return send(res, 200, {
      data: {
        id: "mock-hc-lumen", name: "Lumen Field Instruments GmbH", domain, description: "Fictional maker of field measurement instruments.",
        category: { industry: "Scientific instruments" }, tags: ["Instruments"], phone: "+49 89 0000 0001",
        geo: { city: "Augsburg", state: "Bavaria", countryCode: "DE" }, metrics: { employees: "51-200" },
        site: { emailAddresses: ["someone@lumen.example.test"] }, twitter: { handle: "mock" },
      },
      meta: { domain },
    });
  }
  return send(res, 200, {
    data: {
      id: "mock-hc-" + slug(domain), name: titleOf(domain) + " Ltd", domain,
      description: "Fictional company record for " + domain + ", served by the UI-review mock.",
      category: { industry: "Office services", sector: "Mock" }, tags: ["Mock", "Fictional"], phone: "+1 555 0100 " + (100 + ([...domain].reduce((a, c) => a + c.charCodeAt(0), 0) % 900)),
      geo: { streetAddress: "9 Review Road", city: "Sample City", state: "Ontario", postalCode: "Z0Z 0Z0", countryCode: "CA", lat: 1, lng: 2 },
      metrics: { employees: "11-50", trafficRank: "mock" }, site: { emailAddresses: ["hidden@" + domain] }, linkedin: { handle: "mock" }, tech: ["mock"],
    },
    meta: { domain },
  });
}

// ---- P1-E5: FICTIONAL Domain Search (Hunter API v2 shape) for UI review ----
// By domain: northwind.example.test → a mixed team (existing, restricted, same
// name, email owned at another company, new people in every role group, one
// result without a name); lumen.example.test → two new people;
// brightwave.example.test → three new people. Others → no results.
// job_titles containing "zzz-none" → no results, "zzz-quota" → 429,
// "zzz-flaky" → 503 twice then results. decision_maker=true keeps only people
// flagged as decision makers. The mock does not emulate Hunter's title matching.
const person = (first, last, email, position, o = {}) => ({
  value: email, type: "personal", confidence: 80, first_name: first, last_name: last, position, seniority: null, department: null,
  decision_maker: false, linkedin: null, twitter: "mock", phone_number: null, verification: { date: "2026-09-30", status: "valid" },
  sources: [{ domain: "pages.example.test", uri: "https://pages.example.test/team", extracted_on: "2026-01-01", last_seen_on: "2026-09-01", still_on_page: true }],
  ...o,
});
const TEAMS = {
  "northwind.example.test": [
    person("Avery", "Stone", "avery.stone@northwind.example.test", "Head of Operations", { seniority: "executive", department: "operations", decision_maker: true, confidence: 96 }),
    person("Jordan", "Pike", "jordan.pike@northwind.example.test", "Finance Lead", { seniority: "senior", department: "finance", confidence: 88 }),
    person("Sam", "Ortiz", "sam.ortiz@northwind.example.test", "Office Manager", { seniority: "junior", department: "administrative", confidence: 60, verification: { status: "unknown" } }),
    person("Riley", "Brandt", "riley.brandt@lumen.example.test", "Operations Director", { seniority: "executive", department: "operations", confidence: 70 }),
    person("Casey", "Rowe", "casey.rowe@northwind.example.test", "Operations Director", { seniority: "executive", department: "operations", decision_maker: true, confidence: 94, phone_number: "+44 20 7946 0123", linkedin: "https://profiles.example.test/casey-rowe" }),
    person("Drew", "Lin", "drew.lin@northwind.example.test", "Senior Operations Manager", { seniority: "senior", department: "operations", confidence: 82, verification: { status: "accept_all" } }),
    person("Quinn", "Hart", "quinn.hart@northwind.example.test", "Assistant Office Manager", { seniority: "junior", department: "administrative", confidence: 55, verification: { status: "unknown" } }),
    person("Parker", "Vale", "parker.vale@northwind.example.test", "Chief Executive Officer", { seniority: "executive", department: "executive", decision_maker: true, confidence: 91 }),
    person("Rowan", "Ellis", "rowan.ellis@northwind.example.test", "Data Analyst", { seniority: "junior", department: "it", confidence: 40, verification: { status: "unknown" } }),
    person(null, null, "x7@northwind.example.test", "Analyst"),
  ],
  "lumen.example.test": [
    person("Lee", "Marsh", "lee.marsh@lumen.example.test", "Operations Manager", { seniority: "senior", department: "operations", confidence: 87 }),
    person("Noor", "Field", "noor.field@lumen.example.test", "Head of Operations", { seniority: "executive", department: "operations", decision_maker: true, confidence: 93 }),
  ],
  "brightwave.example.test": [
    person("Tam", "Reed", "tam.reed@brightwave.example.test", "Operations Director", { seniority: "executive", department: "operations", decision_maker: true, confidence: 95 }),
    person("Ola", "West", "ola.west@brightwave.example.test", "Office Manager", { seniority: "junior", department: "administrative", confidence: 70, verification: { status: "accept_all" } }),
    person("Kit", "Moss", "kit.moss@brightwave.example.test", "Finance Lead", { seniority: "senior", department: "finance", confidence: 77 }),
  ],
};
function hunterDomainSearch(url, res) {
  const domain = (url.searchParams.get("domain") ?? "").toLowerCase();
  const titles = (url.searchParams.get("job_titles") ?? "").toLowerCase();
  if (url.searchParams.get("type") !== "personal" || Number(url.searchParams.get("limit")) > 10 || url.searchParams.get("offset") !== "0") {
    return send(res, 400, { errors: [{ id: "wrong_params", code: 400, details: "mock: expected personal, limit<=10, offset 0" }] });
  }
  if (titles.includes("zzz-quota")) return send(res, 429, { errors: [{ code: 429, details: "mock" }] });
  if (titles.includes("zzz-flaky") && (FLAKY.get("ds:" + domain) ?? 0) < 2) {
    FLAKY.set("ds:" + domain, (FLAKY.get("ds:" + domain) ?? 0) + 1);
    return send(res, 503, { errors: [{ code: 503, details: "mock" }] });
  }
  let emails = titles.includes("zzz-none") ? [] : (TEAMS[domain] ?? (titles.includes("zzz-flaky") ? TEAMS["lumen.example.test"] : []));
  if (url.searchParams.get("decision_maker") === "true") emails = emails.filter((e) => e.decision_maker);
  return send(res, 200, { data: { domain, organization: "Mock Org", pattern: "{first}.{last}", emails: emails.slice(0, 10) }, meta: { results: emails.length, limit: 10, offset: 0 } });
}

function refreshContactCounts(runId) {
  const run = CONTACT_RUNS.find((r) => r.id === runId);
  if (!run) return;
  const cs = CONTACT_CANDIDATES.filter((c) => c.contact_discovery_run_id === runId);
  Object.assign(run, {
    result_count: cs.length,
    selected_count: cs.filter((c) => c.decision === "selected").length,
    dismissed_count: cs.filter((c) => c.decision === "dismissed").length,
    saved_count: cs.filter((c) => c.commit_result).length,
  });
}

function commitContactCandidateRpc(user, a) {
  const ws = a.p_workspace_id;
  const fail = (status, code, message) => ({ status, error: { code, message } });
  const c = CONTACT_CANDIDATES.find((x) => x.id === a.p_candidate_id && x.workspace_id === ws);
  if (!c) return fail(403, "42501", "candidate not found");
  if (c.commit_result) return { data: { already_committed: true, commit_result: c.commit_result, contact_id: c.committed_contact_id } };
  if (CONTACT_RUNS.find((r) => r.id === c.contact_discovery_run_id)?.status !== "review") return fail(400, "55000", "run not in review");
  if (c.decision !== "selected" || c.match_state === "conflict") return fail(400, "55000", "not selected");
  if (c.selected_action === "merge") {
    if (a.p_contact?.id !== c.matched_contact_id) return fail(403, "42501", "merge target");
  } else if (CONTACTS.some((k) => k.workspace_id === ws && k.normalized_email === c.normalized_email && !k.archived_at)) {
    return fail(409, "23505", "email exists");
  }
  const out = ingestLeadRpc(user, { p_workspace_id: ws, p_company: { id: c.company_id, fields: {} }, p_contact: a.p_contact, p_evidence: a.p_evidence });
  if (out.error) return out;
  const result = c.selected_action === "merge" ? "merged" : "created";
  Object.assign(c, { commit_result: result, committed_contact_id: out.data.contact_id, updated_at: new Date().toISOString() });
  refreshContactCounts(c.contact_discovery_run_id);
  return { data: { already_committed: false, commit_result: result, contact_id: out.data.contact_id } };
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readJson(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  try {
    return JSON.parse(data || "{}");
  } catch {
    return {};
  }
}

// P1-E6: the pre-existing Northwind result is current for the fixture data (its fingerprint is computed now).
LEAD_SCORES[0].input_fingerprint = scoringInput(BETA, C.northwind, BETA_ICP).fingerprint;

// P1-E7 Today fixtures (MOCK_TODAY=1 only): FICTIONAL generic companies on Beta with current
// default-ICP results, contacts, a little history and tasks relative to "now".
if (process.env.MOCK_TODAY === "1") {
  const T = (n) => fid("31000000", n);
  const K = (n) => fid("41000000", n);
  const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
  const add = (n, name, o) => COMPANIES.push(company({ id: T(n), canonical_name: name, normalized_name: name.toLowerCase(), industry: "Data analytics", location: { countryCode: "CA", region: "Ontario", city: "Toronto", postalCode: null, addressLine1: null, addressLine2: null }, updated_at: days(1), ...o }));
  add(1, "Harbor Line Logistics", {});
  add(2, "Juniper Analytics", { qualification_state: "qualified" });
  add(3, "Maple Office Supply", {});
  add(4, "Quarry Point Studio", {});
  add(5, "Slate Ridge Partners", {});
  add(6, "Orchid Data Works", {});
  add(7, "Willow Creek Services", {});
  const person = (n, companyN, full, title, phone, o = {}) => CONTACTS.push(contact({ id: K(n), company_id: T(companyN), full_name: full, job_title: title, phone, ...o }));
  person(1, 1, "Robin Hale", "Operations Director", "+1 416 555 0101");
  person(2, 1, "Casey Fox", "Office Manager", "+1 416 555 0102", { is_primary: true });
  person(3, 2, "Drew Lane", "Head of Operations", "+1 416 555 0201", { is_primary: true });
  person(4, 2, "Morgan Ash", "Finance Lead", "+1 416 555 0202");
  person(5, 3, "Jamie Cole", "Finance Lead", "+1 416 555 0301");
  person(6, 3, "Sky Vale", "Office Manager", "+1 416 555 0302");
  person(7, 4, "Quinn Ray", "Operations Manager", null, { is_primary: true });
  person(8, 5, "Alex Moor", "Operations Director", "+1 416 555 0501");
  person(9, 6, "Remy Stone", "Operations Director", "+1 416 555 0601");
  person(10, 7, "Pat Rivers", "Operations Manager", "+1 416 555 0701", { is_primary: true });
  person(11, 7, "Lou Brandt", "Office Manager", "+1 416 555 0702");
  const score = (companyN, grade, value, coverage) =>
    LEAD_SCORES.push({ id: crypto.randomUUID(), workspace_id: BETA, company_id: T(companyN), icp_profile_id: BETA_ICP, icp_revision: 3, score: value, grade, breakdown: null, status: "scored", scored_at: days(1), created_at: days(1), updated_at: days(1), input_fingerprint: scoringInput(BETA, T(companyN), BETA_ICP).fingerprint, coverage_percent: coverage, explanation: null, effective_weights: null, exclusion_reasons: null, scored_by: null });
  score(1, "A", 88, 90);
  score(2, "A", 79, 70);
  score(3, "B", 62, 85);
  score(4, "B", 55, 60);
  score(5, "C", 40, 80);
  score(6, "A", 91, 75);
  score(7, "B", 58, 65);
  // Orchid's data changed after scoring → Outdated (never Ready).
  COMPANIES.find((c) => c.id === T(6)).description = "Changed after the last evaluation.";
  // Sky Vale is restricted (contact scope); one blocked retry task stays visible under Needs attention.
  SUPPRESSIONS.push({ id: fid("81000000", 1), workspace_id: BETA, company_id: T(3), contact_id: K(6), scope: "contact", reason: "Asked not to be called.", active: true, created_by: null, created_at: days(1), updated_at: days(1) });
  const task = (n, contactN, companyN, kind, due, note = null) =>
    FOLLOW_UP_TASKS.push({ id: fid("91000000", n), workspace_id: BETA, company_id: T(companyN), contact_id: K(contactN), source_attempt_id: null, kind, due_at: due, status: "open", note, created_by: USERS[0].id, created_at: days(3), updated_at: days(3), completed_at: null, completed_by: null, cancelled_at: null, cancelled_by: null });
  // Keep "later today" / "due now" inside the current UTC day (the Beta workspace starts in UTC).
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 86_400_000;
  const laterToday = Math.min(Date.now() + 3 * 3_600_000, dayEnd - 10 * 60_000);
  const dueNow = Math.max(Date.now() - 3_600_000, dayStart.getTime() + 60_000);
  task(1, 10, 7, "callback", new Date(dayStart.getTime() - 9 * 3_600_000).toISOString(), "Asked for a call back after their planning meeting."); // yesterday 15:00 UTC
  task(2, 2, 1, "callback", new Date(laterToday > Date.now() + 60_000 ? laterToday : Date.now() + 3 * 3_600_000).toISOString(), "Prefers afternoons.");
  task(3, 4, 2, "follow_up", new Date(Math.min(dueNow, Date.now() - 60_000)).toISOString(), "Send over the pricing questions first.");
  task(4, 6, 3, "retry_call", hours(-2));
  // Yesterday's attempt on Drew Lane (eligible again today).
  CONTACT_ATTEMPTS.push({ id: fid("92000000", 1), workspace_id: BETA, company_id: T(2), contact_id: K(3), source_task_id: null, request_id: crypto.randomUUID(), channel: "phone", disposition: "no_answer", note: null, attempted_at: new Date(Date.now() - 24 * 3_600_000).toISOString(), created_by: USERS[0].id, created_at: days(1) });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    if (req.method === "POST" && p === "/auth/v1/token") {
      const body = await readJson(req);
      const grant = url.searchParams.get("grant_type");
      let user = null;
      if (grant === "password" && body.password === PASSWORD) user = USERS.find((u) => u.email === body.email);
      if (grant === "refresh_token") user = USERS.find((u) => `refresh.${u.id}` === body.refresh_token);
      if (!user) return send(res, 400, { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(res, 200, session(user));
    }

    if (p === "/auth/v1/user") {
      const user = userFromAuth(req);
      return user ? send(res, 200, userJson(user)) : send(res, 401, { code: "bad_jwt", msg: "invalid JWT" });
    }

    if (p === "/auth/v1/logout") return send(res, 204);

    // Review-only introspection (counts and states, no secrets): lets the review assert that nothing was recorded.
    if (req.method === "GET" && p === "/__review/workflow") {
      return send(res, 200, {
        attempts: CONTACT_ATTEMPTS.map((a) => ({ contact_id: a.contact_id, disposition: a.disposition, source_task_id: a.source_task_id, created_by: a.created_by })),
        tasks: FOLLOW_UP_TASKS.map((t) => ({ id: t.id, contact_id: t.contact_id, kind: t.kind, status: t.status, due_at: t.due_at, created_at: t.created_at, created_by: t.created_by })),
        suppressions: SUPPRESSIONS.filter((r) => r.active).map((r) => ({ company_id: r.company_id, contact_id: r.contact_id, scope: r.scope })),
        trustedWrites: TRUSTED_WRITES.length,
        qualification: COMPANIES.map((c) => ({ id: c.id, q: c.qualification_state })),
        scores: LEAD_SCORES.map((x) => ({ company_id: x.company_id, grade: x.grade, score: x.score, status: x.status, fp: x.input_fingerprint })),
        timezone: Object.fromEntries(WORKSPACES.map((w) => [w.slug, w.timezone])),
        providerUsage: PROVIDER_USAGE.length,
      });
    }

    if (req.method === "GET" && p.startsWith("/rest/v1/")) {
      const user = userFromAuth(req);
      const visible = orgIdsFor(user);
      const select = url.searchParams.get("select") ?? "*";
      const table = p.slice("/rest/v1/".length);
      let rows;
      if (table === "workspaces") rows = WORKSPACES.filter((w) => visible.has(w.organization_id));
      else if (table === "memberships") rows = MEMBERSHIPS.filter((m) => visible.has(m.organization_id));
      else if (table === "organizations") rows = ORGS.filter((o) => visible.has(o.id));
      else if (table === "icp_profiles") rows = ICP_PROFILES.filter((r) => visible.has(orgOfWorkspace(r.workspace_id)));
      else if (LEAD_TABLES[table]) rows = LEAD_TABLES[table].filter((r) => visible.has(orgOfWorkspace(r.workspace_id)));
      else return send(res, 404, { message: "not found" });
      rows = applyFilters(rows, url.searchParams).map((r) => embedOrg(r, select));
      const order = url.searchParams.get("order");
      if (order) {
        const [col, dir] = order.split(".");
        rows.sort((a, b) => compare(a[col], b[col]) * (dir === "desc" ? -1 : 1));
      }
      const offset = Number(url.searchParams.get("offset")) || 0;
      const limit = Number(url.searchParams.get("limit"));
      const total = rows.length;
      rows = rows.slice(offset, limit > 0 ? offset + limit : undefined);
      if (String(req.headers.prefer ?? "").includes("count=exact")) {
        res.writeHead(200, { "content-type": "application/json", "content-range": `${offset}-${offset + rows.length - 1}/${total}` });
        return res.end(JSON.stringify(rows));
      }
      return send(res, 200, rows);
    }

    // ---- P1-E2: RPCs (JS stand-ins for the SQL functions; no constraint checking beyond the few the UI shows) ----
    if (req.method === "POST" && p.startsWith("/rest/v1/rpc/")) {
      const user = userFromAuth(req);
      const args = await readJson(req);
      const fn = p.slice("/rest/v1/rpc/".length);
      // P1-E7: the trusted score writer is executable only with the service key (never a user session),
      // and the acting user it names must still be a member.
      if (fn === "save_lead_score_trusted") {
        const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        if (req.headers.apikey !== SERVICE_REVIEW_KEY || bearer !== SERVICE_REVIEW_KEY) return send(res, 401, { code: "42501", message: "permission denied for function save_lead_score_trusted" });
        const actor = USERS.find((u) => u.id === args.p_actor_user_id);
        if (!isMemberOfWorkspace(actor, args.p_workspace_id)) return send(res, 403, { code: "42501", message: "not a member of this workspace" });
        const out = saveLeadScoreRpc(args);
        if (!out.error) TRUSTED_WRITES.push({ actor: actor.id, company: args.p_company_id });
        return out.error ? send(res, out.status, out.error) : send(res, 200, out.data);
      }
      if (!isMemberOfWorkspace(user, args.p_workspace_id)) return send(res, 403, { code: "42501", message: "permission denied" });
      const workflow = workflowRpc(user, fn, args);
      if (workflow) return workflow.error ? send(res, workflow.status, workflow.error) : send(res, 200, workflow.data ?? null);
      if (fn === "list_companies") return send(res, 200, listCompaniesRpc(args));
      if (fn === "stage_import_rows") return send(res, 200, stageRowsRpc(args));
      if (fn === "scoring_input") return send(res, 200, scoringInput(args.p_workspace_id, args.p_company_id, args.p_icp_profile_id));
      if (fn === "commit_contact_candidate") {
        const out = commitContactCandidateRpc(user, args);
        return out.error ? send(res, out.status, out.error) : send(res, 200, out.data);
      }
      if (fn === "ingest_lead") {
        const out = ingestLeadRpc(user, args);
        return out.error ? send(res, out.status, out.error) : send(res, 200, out.data);
      }
      return send(res, 404, { message: `mock: unknown rpc ${fn}` });
    }

    // ---- P1-E4: fake enrichment provider (reached via HUNTER_API_ENDPOINT in review runs only) ----
    if (req.method === "GET" && p.startsWith("/hunter/v2/")) {
      if (req.headers["x-api-key"] !== HUNTER_REVIEW_KEY || url.searchParams.has("api_key")) return send(res, 401, { errors: [{ code: 401, details: "mock" }] });
      if (p === "/hunter/v2/domain-finder") return hunterDomainFinder(url, res);
      if (p === "/hunter/v2/companies/find") return hunterCompany(url, res);
      if (p === "/hunter/v2/domain-search") return hunterDomainSearch(url, res);
      return send(res, 404, {});
    }

    // ---- P1-E6: signal observations (members; unknown = delete) ----
    if (p === "/rest/v1/company_signal_observations" && ["POST", "PATCH", "DELETE"].includes(req.method)) {
      const user = userFromAuth(req);
      const ts = new Date().toISOString();
      if (req.method === "DELETE") {
        const targets = applyFilters(SIGNAL_OBSERVATIONS, url.searchParams).filter((r) => isMemberOfWorkspace(user, r.workspace_id));
        for (const t of targets) SIGNAL_OBSERVATIONS.splice(SIGNAL_OBSERVATIONS.indexOf(t), 1);
        return wantsRows(req) ? send(res, 200, targets) : send(res, 204);
      }
      const body = await readJson(req);
      if (req.method === "POST") {
        const r = Array.isArray(body) ? body[0] : body;
        if (!isMemberOfWorkspace(user, r.workspace_id)) return send(res, 403, { code: "42501", message: "row-level security" });
        const err = observationError(r);
        if (err) return send(res, 400, err);
        if (SIGNAL_OBSERVATIONS.some((o) => o.company_id === r.company_id && o.icp_profile_id === r.icp_profile_id && o.icp_revision === r.icp_revision && o.signal_kind === r.signal_kind && o.signal_id === r.signal_id)) {
          return send(res, 409, { code: "23505", message: "duplicate" });
        }
        const row = { id: crypto.randomUUID(), note: null, source_evidence_id: null, created_by: user.id, observed_at: ts, created_at: ts, updated_at: ts, ...r };
        SIGNAL_OBSERVATIONS.push(row);
        return wantsRows(req) ? send(res, 201, [row]) : send(res, 201);
      }
      const targets = applyFilters(SIGNAL_OBSERVATIONS, url.searchParams).filter((r) => isMemberOfWorkspace(user, r.workspace_id));
      for (const t of targets) {
        const err = observationError({ ...t, ...body });
        if (err) return send(res, 400, err);
        Object.assign(t, body, { observed_at: ts, updated_at: ts });
      }
      return wantsRows(req) ? send(res, 200, targets) : send(res, 204);
    }

    // ---- P1-E5: contact discovery runs and candidates by any workspace member ----
    const contactTable = { "/rest/v1/contact_discovery_runs": CONTACT_RUNS, "/rest/v1/contact_discovery_candidates": CONTACT_CANDIDATES }[p];
    if (contactTable && (req.method === "POST" || req.method === "PATCH")) {
      const user = userFromAuth(req);
      const body = await readJson(req);
      const ts = new Date().toISOString();
      if (req.method === "POST") {
        const items = Array.isArray(body) ? body : [body];
        if (!items.every((r) => isMemberOfWorkspace(user, r.workspace_id))) return send(res, 403, { code: "42501", message: "row-level security" });
        const created = [];
        for (const r of items) {
          if (contactTable === CONTACT_RUNS) {
            created.push({
              id: crypto.randomUUID(), icp_profile_id: null, icp_revision: null, status: "draft", selected_titles: [], decision_maker_only: false, requested_limit: 10,
              result_count: 0, selected_count: 0, dismissed_count: 0, saved_count: 0, error_code: null, created_by: user.id, created_at: ts, updated_at: ts,
              completed_at: null, cancelled_at: null, ...r,
            });
          } else {
            const run = CONTACT_RUNS.find((x) => x.id === r.contact_discovery_run_id && x.workspace_id === r.workspace_id && x.company_id === r.company_id);
            if (!run) return send(res, 409, { code: "23503", message: "foreign key" });
            if (run.status !== "searching") return send(res, 400, { code: "55000", message: "run not searching" });
            created.push({ id: crypto.randomUUID(), decision: "unreviewed", selected_action: null, commit_result: null, committed_contact_id: null, decided_by: null, decided_at: null, created_at: ts, updated_at: ts, ...r });
          }
        }
        contactTable.push(...created);
        if (contactTable === CONTACT_CANDIDATES) for (const c of created) refreshContactCounts(c.contact_discovery_run_id);
        return wantsRows(req) ? send(res, 201, created) : send(res, 201);
      }
      const targets = applyFilters(contactTable, url.searchParams).filter((r) => isMemberOfWorkspace(user, r.workspace_id));
      if (contactTable === CONTACT_RUNS) {
        if (targets.some((r) => ["completed", "cancelled"].includes(r.status))) return send(res, 400, { code: "55000", message: "run is final" });
      } else {
        for (const c of targets) {
          if (c.commit_result) return send(res, 400, { code: "55000", message: "saved" });
          if (CONTACT_RUNS.find((r) => r.id === c.contact_discovery_run_id)?.status !== "review") return send(res, 400, { code: "55000", message: "run not in review" });
          if (body.decision === "selected" && c.match_state === "conflict") return send(res, 400, { code: "23514", message: "conflict" });
        }
      }
      for (const row of targets) {
        if (contactTable === CONTACT_CANDIDATES && body.decision && body.decision !== row.decision) Object.assign(row, { decided_by: user.id, decided_at: ts });
        Object.assign(row, body, { updated_at: ts });
        if (contactTable === CONTACT_CANDIDATES) refreshContactCounts(row.contact_discovery_run_id);
      }
      return wantsRows(req) ? send(res, 200, targets) : send(res, 204);
    }

    // ---- P1-E4: enrichment runs (insert/update) and results (insert only) by any workspace member ----
    const enrichmentTable = { "/rest/v1/company_enrichment_runs": ENRICHMENT_RUNS, "/rest/v1/company_enrichment_results": ENRICHMENT_RESULTS }[p];
    if (enrichmentTable && (req.method === "POST" || req.method === "PATCH")) {
      const user = userFromAuth(req);
      const body = await readJson(req);
      const ts = new Date().toISOString();
      if (req.method === "POST") {
        const r = Array.isArray(body) ? body[0] : body;
        if (!isMemberOfWorkspace(user, r.workspace_id)) return send(res, 403, { code: "42501", message: "row-level security" });
        let row;
        if (enrichmentTable === ENRICHMENT_RUNS) {
          if (r.input_kind === "discovery_reference" && (!r.discovery_candidate_id || r.manual_company_name)) return send(res, 400, { code: "23514", message: "check" });
          row = {
            id: crypto.randomUUID(), discovery_candidate_id: null, target_company_id: null, manual_company_name: null, requested_domain: null, resolved_domain: null,
            status: "draft", error_code: null, match_state: null, match_reason: null, matched_company_id: null, decision: null, committed_company_id: null, commit_result: null,
            commit_notes: null, created_by: user.id, created_at: ts, updated_at: ts, completed_at: null, cancelled_at: null, ...r,
          };
        } else {
          const run = ENRICHMENT_RUNS.find((x) => x.id === r.enrichment_run_id && x.workspace_id === r.workspace_id);
          if (!run) return send(res, 409, { code: "23503", message: "foreign key" });
          if (run.status !== "enriching") return send(res, 400, { code: "55000", message: "not enriching" });
          if (ENRICHMENT_RESULTS.some((x) => x.enrichment_run_id === r.enrichment_run_id)) return send(res, 409, { code: "23505", message: "duplicate" });
          row = { id: crypto.randomUUID(), created_at: ts, ...r };
        }
        enrichmentTable.push(row);
        return wantsRows(req) ? send(res, 201, [row]) : send(res, 201);
      }
      if (enrichmentTable === ENRICHMENT_RESULTS) return send(res, 401, { code: "42501", message: "permission denied" });
      const targets = applyFilters(ENRICHMENT_RUNS, url.searchParams).filter((r) => isMemberOfWorkspace(user, r.workspace_id));
      if (targets.some((r) => ["completed", "cancelled"].includes(r.status))) return send(res, 400, { code: "55000", message: "run is final" });
      for (const row of targets) Object.assign(row, body, { updated_at: ts });
      return wantsRows(req) ? send(res, 200, targets) : send(res, 204);
    }

    // ---- P1-E3: fake Places API (New) Text Search (reached via GOOGLE_PLACES_ENDPOINT in review runs only) ----
    if (req.method === "POST" && p === "/v1/places:searchText") return googleTextSearch(req, res);

    // ---- P1-E3: discovery writes by any workspace member ----
    const discoveryTable = { "/rest/v1/discovery_runs": DISCOVERY_RUNS, "/rest/v1/discovery_candidates": DISCOVERY_CANDIDATES, "/rest/v1/provider_usage_events": PROVIDER_USAGE }[p];
    if (discoveryTable && (req.method === "POST" || req.method === "PATCH")) {
      const user = userFromAuth(req);
      const body = await readJson(req);
      const ts = new Date().toISOString();
      if (req.method === "POST") {
        const items = Array.isArray(body) ? body : [body];
        if (!items.every((r) => isMemberOfWorkspace(user, r.workspace_id))) return send(res, 403, { code: "42501", message: "row-level security" });
        const created = [];
        for (const r of items) {
          if (discoveryTable === DISCOVERY_CANDIDATES) {
            const run = DISCOVERY_RUNS.find((x) => x.id === r.discovery_run_id && x.workspace_id === r.workspace_id);
            if (!run) return send(res, 409, { code: "23503", message: "foreign key" });
            if (["completed", "cancelled"].includes(run.status)) return send(res, 400, { code: "55000", message: "run is final" });
            const dup = DISCOVERY_CANDIDATES.find((x) => x.discovery_run_id === r.discovery_run_id && x.provider_key === r.provider_key && x.external_record_id === r.external_record_id);
            if (dup) {
              if (String(req.headers.prefer ?? "").includes("ignore-duplicates")) continue;
              return send(res, 409, { code: "23505", message: "duplicate" });
            }
            created.push({ id: crypto.randomUUID(), position: 0, match_state: null, match_company_id: null, decision: "unreviewed", decided_by: null, decided_at: null, created_at: ts, updated_at: ts, ...r });
          } else if (discoveryTable === DISCOVERY_RUNS) {
            created.push({
              id: crypto.randomUUID(), icp_profile_id: null, icp_revision: null, geography: null, language_code: null, region_code: null,
              status: "running", requested_result_count: null, pages_loaded: 0, has_more: false, error_code: null, candidate_count: 0,
              selected_count: 0, dismissed_count: 0, created_by: user.id, created_at: ts, updated_at: ts, completed_at: null, cancelled_at: null, ...r,
            });
          } else {
            created.push({ id: crypto.randomUUID(), discovery_run_id: null, enrichment_run_id: null, contact_discovery_run_id: null, company_id: null, estimated_credit_millis: null, requested_fields: null, result_count: 0, sku_hint: null, estimated_cost_micros: null, pricing_reference: null, occurred_at: ts, created_by: user.id, ...r });
          }
        }
        discoveryTable.push(...created);
        if (discoveryTable === DISCOVERY_CANDIDATES) for (const c of created) refreshDiscoveryCounts(c.discovery_run_id);
        return wantsRows(req) ? send(res, 201, created) : send(res, 201);
      }
      if (discoveryTable === PROVIDER_USAGE) return send(res, 401, { code: "42501", message: "permission denied" });
      const targets = applyFilters(discoveryTable, url.searchParams).filter((r) => isMemberOfWorkspace(user, r.workspace_id));
      const runOf = (r) => (discoveryTable === DISCOVERY_RUNS ? r : DISCOVERY_RUNS.find((x) => x.id === r.discovery_run_id));
      if (targets.some((r) => ["completed", "cancelled"].includes(runOf(r)?.status))) return send(res, 400, { code: "55000", message: "run is final" });
      for (const row of targets) {
        if (discoveryTable === DISCOVERY_CANDIDATES && body.decision && body.decision !== row.decision) Object.assign(row, { decided_by: user.id, decided_at: ts });
        Object.assign(row, body, { updated_at: ts });
        if (discoveryTable === DISCOVERY_CANDIDATES) refreshDiscoveryCounts(row.discovery_run_id);
      }
      return wantsRows(req) ? send(res, 200, targets) : send(res, 204);
    }

    // ---- P1-E2: inserts by any workspace member (imports, restrictions) ----
    if (req.method === "POST" && ["/rest/v1/import_batches", "/rest/v1/import_rows", "/rest/v1/suppression_records"].includes(p)) {
      const user = userFromAuth(req);
      const table = p.slice("/rest/v1/".length);
      const body = await readJson(req);
      const items = Array.isArray(body) ? body : [body];
      if (!items.every((r) => isMemberOfWorkspace(user, r.workspace_id))) {
        return send(res, 403, { code: "42501", message: "new row violates row-level security policy" });
      }
      const ts = new Date().toISOString();
      const created = [];
      for (const r of items) {
        if (table === "suppression_records") {
          const dup = SUPPRESSIONS.some((s) => s.active && s.company_id === r.company_id && (s.contact_id ?? null) === (r.contact_id ?? null));
          if (dup) return send(res, 409, { code: "23505", message: "duplicate key value" });
          created.push({ id: crypto.randomUUID(), contact_id: null, reason: null, active: true, created_by: user.id, created_at: ts, updated_at: ts, ...r });
        } else if (table === "import_batches") {
          created.push({
            id: crypto.randomUUID(), status: "mapping", mapping: null, valid_rows: 0, invalid_rows: 0, created_rows: 0, merged_rows: 0,
            skipped_rows: 0, failed_rows: 0, created_by: user.id, created_at: ts, updated_at: ts, completed_at: null, archived_at: null, ...r,
          });
        } else {
          created.push({
            id: crypto.randomUUID(), normalized_data: null, validation_errors: null, match_state: "unprocessed", match_reason: null,
            matched_company_id: null, matched_contact_id: null, matched_import_row_id: null, decision: null, commit_result: null,
            commit_notes: null, committed_company_id: null, committed_contact_id: null, created_at: ts, updated_at: ts, ...r,
          });
        }
      }
      LEAD_TABLES[table].push(...created);
      return wantsRows(req) ? send(res, 201, created) : send(res, 201);
    }

    // ---- P1-E2: updates (imports: members; restrictions: owner/admin, others change zero rows) ----
    if (req.method === "PATCH" && ["/rest/v1/import_batches", "/rest/v1/import_rows", "/rest/v1/suppression_records"].includes(p)) {
      const user = userFromAuth(req);
      const table = p.slice("/rest/v1/".length);
      const body = await readJson(req);
      const targets = applyFilters(LEAD_TABLES[table], url.searchParams).filter((r) =>
        table === "suppression_records" ? isAdminOf(user, orgOfWorkspace(r.workspace_id)) : isMemberOfWorkspace(user, r.workspace_id),
      );
      if (table === "import_batches" && targets.some((b) => ["completed", "cancelled"].includes(b.status) && Object.keys(body).some((k) => k !== "archived_at"))) {
        return send(res, 400, { code: "55000", message: "import batch is final" });
      }
      if (table === "import_rows" && targets.some((r) => r.commit_result !== null || isFinalBatch(r.import_batch_id))) {
        return send(res, 400, { code: "55000", message: "import row is final" });
      }
      for (const row of targets) Object.assign(row, body, { updated_at: new Date().toISOString() });
      return wantsRows(req) ? send(res, 200, targets) : send(res, 204);
    }

    // Writes used by Settings (P0-E1-S2). Owner/admin only, mimicking RLS:
    // refused UPDATEs affect zero rows; refused INSERTs return 42501.
    if (req.method === "PATCH" && (p === "/rest/v1/workspaces" || p === "/rest/v1/icp_profiles")) {
      const user = userFromAuth(req);
      const body = await readJson(req);
      const table = p.slice("/rest/v1/".length);
      const source = table === "workspaces" ? WORKSPACES : ICP_PROFILES;
      const orgOf = (r) => (table === "workspaces" ? r.organization_id : orgOfWorkspace(r.workspace_id));
      const allowed = table === "workspaces" ? WORKSPACE_UPDATE_COLUMNS : ICP_UPDATE_COLUMNS;
      if (Object.keys(body).some((k) => !allowed.has(k))) return send(res, 401, { code: "42501", message: "permission denied" });
      const targets = applyFilters(source, url.searchParams).filter((r) => isAdminOf(user, orgOf(r)));
      for (const row of targets) {
        if (table === "icp_profiles" && ICP_CONFIG_COLUMNS.some((k) => k in body && JSON.stringify(body[k]) !== JSON.stringify(row[k]))) {
          row.revision += 1;
        }
        Object.assign(row, body, { updated_at: new Date().toISOString() });
      }
      return send(res, 200, targets);
    }

    // Company qualification (P1-E1): any member of the workspace, mimicking RLS.
    if (req.method === "PATCH" && p === "/rest/v1/companies") {
      const user = userFromAuth(req);
      const body = await readJson(req);
      if (Object.keys(body).some((k) => !COMPANY_UPDATE_COLUMNS.has(k))) return send(res, 401, { code: "42501", message: "permission denied" });
      const targets = applyFilters(COMPANIES, url.searchParams).filter((r) => isMemberOfWorkspace(user, r.workspace_id));
      for (const row of targets) Object.assign(row, body, { updated_at: new Date().toISOString() });
      return send(res, 200, targets);
    }

    if (req.method === "POST" && p === "/rest/v1/icp_profiles") {
      const user = userFromAuth(req);
      const body = await readJson(req);
      if (!isAdminOf(user, orgOfWorkspace(body.workspace_id))) {
        return send(res, 403, { code: "42501", message: "new row violates row-level security policy" });
      }
      if (body.is_default && ICP_PROFILES.some((r) => r.workspace_id === body.workspace_id && r.is_default && !r.archived_at)) {
        return send(res, 409, { code: "23505", message: "duplicate key value" });
      }
      const row = {
        id: crypto.randomUUID(),
        description: null,
        is_default: false,
        archived_at: null,
        schema_version: 1,
        revision: 1,
        ideal_customer: null,
        target_geographies: null,
        decision_maker_titles: null,
        buying_signals: null,
        exclusion_signals: null,
        scoring_model: null,
        ...body,
        created_by: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      ICP_PROFILES.push(row);
      return send(res, 201, [row]);
    }

    send(res, 404, { message: `mock: unhandled ${req.method} ${p}` });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock-supabase (UI review only) on http://127.0.0.1:${PORT}`));
