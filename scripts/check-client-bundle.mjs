#!/usr/bin/env node
/**
 * Fails if anything secret-looking is present in the browser bundle
 * (.next/static). Run after `next build` (wired into `npm run check:bundle`).
 *
 * Checks for:
 *  - Supabase secret keys (sb_secret_…) and service_role JWTs
 *  - names of server-only env vars (means server code leaked to the client)
 *  - Postgres connection strings
 *  - the literal VALUE of every non-NEXT_PUBLIC_ variable in .env* files
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STATIC_DIR = path.join(ROOT, ".next", "static");

const SERVER_ONLY_ENV_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_TEST_DB_URL",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "GOOGLE_PLACES_API_KEY",
  "GOOGLE_PLACES_ENDPOINT",
  "HUNTER_API_KEY",
  "HUNTER_API_ENDPOINT",
];

const PATTERNS = [
  { name: "Supabase secret key", re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  // Provider APIs are called only from the server (P1-E3).
  { name: "provider API endpoint (places.googleapis.com)", re: /places\.googleapis\.com/ },
  { name: "provider field mask header", re: /X-Goog-FieldMask/i },
  // Enrichment provider (P1-E4): server-only as well.
  { name: "provider API endpoint (api.hunter.io)", re: /api\.hunter\.io/ },
  { name: "enrichment / contact provider paths", re: /\/v2\/(?:domain-finder|domain-search|companies\/find)/ },
  // Trusted score persistence (P1-E7) is server-only: neither the writer nor its RPC may reach the browser.
  { name: "server-only score writer (save_lead_score_trusted)", re: /save_lead_score_trusted/ },
  { name: "server-only score writer (persistLeadScore)", re: /persistLeadScore/ },
  { name: "Postgres connection string", re: /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/ },
  ...SERVER_ONLY_ENV_NAMES.map((n) => ({ name: `server-only env var name ${n}`, re: new RegExp(`\\b${n}\\b`) })),
];

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

function secretEnvValues() {
  const values = [];
  for (const file of readdirSync(ROOT).filter((f) => f.startsWith(".env") && f !== ".env.example")) {
    for (const line of readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || m[1].startsWith("NEXT_PUBLIC_")) continue;
      const value = m[2].replace(/^['"]|['"]$/g, "");
      if (value.length >= 8) values.push({ name: m[1], value });
    }
  }
  return values;
}

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(js|mjs|css|html|json|txt|map)$/.test(entry)) yield full;
  }
}

if (!existsSync(STATIC_DIR)) {
  console.error("check-client-bundle: .next/static not found. Run `npm run build` first.");
  process.exit(2);
}

const secrets = secretEnvValues();
const findings = [];
let scanned = 0;

for (const file of files(STATIC_DIR)) {
  scanned++;
  const text = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);

  for (const { name, re } of PATTERNS) if (re.test(text)) findings.push(`${rel}: ${name}`);

  for (const m of text.matchAll(JWT_RE)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") findings.push(`${rel}: service_role JWT`);
    } catch {
      /* not a JWT */
    }
  }

  for (const { name, value } of secrets) if (text.includes(value)) findings.push(`${rel}: value of ${name}`);
}

// Development-only UI fixtures must not exist anywhere in a normal build.
let fixtureFilesScanned = 0;
if (process.env.VLEEDS_UI_FIXTURES !== "1") {
  const NEXT_DIR = path.join(ROOT, ".next");
  for (const sub of ["static", "server"]) {
    const dir = path.join(NEXT_DIR, sub);
    if (!existsSync(dir)) continue;
    for (const file of files(dir)) {
      fixtureFilesScanned++;
      const rel = path.relative(ROOT, file);
      if (/[\\/]ui-fixtures[\\/]/.test(rel)) findings.push(`${rel}: UI fixture route present in build`);
      else if (readFileSync(file, "utf8").includes("vleeds-ui-fixture-only")) findings.push(`${rel}: UI fixture data present in build`);
    }
  }
}

if (findings.length) {
  console.error(`check-client-bundle: FAILED — ${findings.length} finding(s) in ${scanned} files:`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `check-client-bundle: OK — scanned ${scanned} client files; no secrets, service-role keys, ` +
    `connection strings or server-only env names found (${secrets.length} secret env value(s) checked); ` +
    (process.env.VLEEDS_UI_FIXTURES === "1"
      ? "UI-fixture build: fixture absence check skipped."
      : `no UI fixture routes/data in ${fixtureFilesScanned} build files.`),
);
