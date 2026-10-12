/**
 * Real-stack navigation + Settings sheet regression check (P1-PILOT).
 *
 * Run against `next dev` (not a production build): both bugs it guards were
 * dev-only. Dev mode is where Next.js validates instant navigation and where
 * React Strict Mode double-runs effects.
 *  - Every workspace section must navigate client-side with no "Next.js
 *    encountered uncached data during prerendering or a navigation" error
 *    (each page segment needs its own loading.tsx).
 *  - Every Settings sheet must stay open after it is opened. ConfigSheet used
 *    to dismiss itself under Strict Mode.
 * Also checks: session survives refresh and navigation, workspace switcher,
 * company drawer route (when the workspace has a company), sign-out, and the
 * signed-out redirect to /login.
 *
 * Prereqs: real local stack (`npx supabase start`), `npm run dev`,
 *   npm i --no-save puppeteer-core
 * Run (credentials come from the environment, never from this file):
 *   node --env-file=.env.local scripts/ui-review/review-dev-navigation.mjs <workspaceId>
 * Uses VLEEDS_REVIEW_EMAIL/VLEEDS_REVIEW_PASSWORD if set, else
 * VLEEDS_LOCAL_TEST_EMAIL/VLEEDS_LOCAL_TEST_PASSWORD. CHROME_PATH overrides the
 * macOS Chrome location.
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const WS = process.argv[2];
const EMAIL = process.env.VLEEDS_REVIEW_EMAIL ?? process.env.VLEEDS_LOCAL_TEST_EMAIL;
const PASSWORD = process.env.VLEEDS_REVIEW_PASSWORD ?? process.env.VLEEDS_LOCAL_TEST_PASSWORD;
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!WS || !EMAIL || !PASSWORD) {
  console.error("usage: node --env-file=.env.local scripts/ui-review/review-dev-navigation.mjs <workspaceId>  (needs review credentials in the environment)");
  process.exit(2);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error("BASE_URL must be a local dev server.");
  process.exit(2);
}

const SECTIONS = ["today", "discover", "leads", "campaigns", "settings"];
const ICP_SECTIONS = ["ideal_customer", "geographies", "decision_makers", "buying_signals", "exclusion_signals", "scoring"];
const results = [];
const check = (name, ok, detail = "") => {
  results.push(!!ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.setDefaultTimeout(60_000);
let errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
const takeErrors = () => {
  const e = errors;
  errors = [];
  return e;
};
const path = () => new URL(page.url()).pathname;
const hasAuthCookie = async () => (await page.cookies()).some((c) => /^sb-.*-auth-token/.test(c.name));

// ---- sign in ---------------------------------------------------------------
await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await page.type("#email", EMAIL);
await page.type("#password", PASSWORD);
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), page.click("button[type=submit]")]);
check("sign-in leaves /login", path() !== "/login", path());
check("session cookie set", await hasAuthCookie());
await page.goto(`${BASE}/w/${WS}/today`, { waitUntil: "networkidle0" });
await settle(1500);
const loadErrors = takeErrors();
check("today loads (full page load) without errors", path().endsWith("/today") && loadErrors.length === 0, loadErrors.join(" | "));

// ---- client-side navigation through every section, twice ----------------------
for (const round of [1, 2]) {
  for (const s of [...SECTIONS.slice(1), SECTIONS[0]]) {
    const link = await page.$(`aside a[href$="/w/${WS}/${s}"], nav a[href$="/w/${WS}/${s}"]`);
    if (!link) {
      check(`nav link to ${s} exists`, false);
      continue;
    }
    await link.click();
    await page.waitForFunction((p) => location.pathname.endsWith(p), {}, `/${s}`);
    await page.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
    await settle(1200);
    const errs = takeErrors();
    check(`round ${round}: client nav → ${s} (no navigation/validation errors)`, errs.length === 0, errs.join(" | "));
  }
}

// ---- refresh keeps the session -------------------------------------------------
await page.goto(`${BASE}/w/${WS}/settings`, { waitUntil: "networkidle0" });
await page.reload({ waitUntil: "networkidle0" });
await settle(1000);
check("refresh on Settings stays signed in", path().endsWith("/settings") && (await hasAuthCookie()));
await page.waitForSelector("button[data-section=scoring]");

// ---- every Settings sheet opens AND stays open (Strict Mode regression) -------
const sheetStaysOpen = async (selector, label) => {
  await page.click(selector);
  const opened = await page.waitForSelector("dialog[open]", { timeout: 5_000 }).then(() => true).catch(() => false);
  await settle(800); // past the queued `close` event that used to dismiss it
  const stillOpen = !!(await page.$("dialog[open]"));
  check(`${label} sheet opens and stays open`, opened && stillOpen);
  if (stillOpen) {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"), { timeout: 5_000 }).catch(() => {});
    await settle(300);
  }
};
const role = await page.evaluate(() => (document.body.innerText.match(/Your role\n(\w+)/) || [])[1] ?? "");
if (/owner|admin/i.test(role)) await sheetStaysOpen("button::-p-text(Edit)", "business profile");
for (const s of ICP_SECTIONS) await sheetStaysOpen(`button[data-section=${s}]`, s);
const settingsErrors = takeErrors();
check("Settings: no console errors", settingsErrors.length === 0, settingsErrors.join(" | "));

// ---- workspace switcher ------------------------------------------------------
await page.click("button::-p-text(Switch workspace)");
const menu = await page.waitForSelector("[role=menu][aria-label=Workspaces]", { timeout: 5_000 }).catch(() => null);
const others = menu ? await page.$$eval(`[role=menu] a[href^="/w/"]:not([href*="${WS}"])`, (els) => els.map((e) => e.getAttribute("href"))) : [];
check("workspace switcher opens", !!menu, `${others.length} other workspace(s)`);
if (others.length) {
  await page.click(`[role=menu] a[href="${others[0]}"]`);
  await page.waitForFunction((h) => location.pathname === h, {}, others[0]);
  await page.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
  await settle(1000);
  check("switcher navigates to another workspace", path() === others[0], path());
  await page.goto(`${BASE}/w/${WS}/settings`, { waitUntil: "networkidle0" });
} else {
  await page.keyboard.press("Escape");
}

// ---- company drawer route ------------------------------------------------------
await page.goto(`${BASE}/w/${WS}/leads`, { waitUntil: "networkidle0" });
await settle(1000);
const companyLink = await page.$("a[data-company-link]");
if (companyLink) {
  const name = await companyLink.evaluate((e) => e.innerText.trim());
  await companyLink.click();
  await page.waitForFunction(() => new URLSearchParams(location.search).has("company"));
  await page.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
  await settle(1000);
  const drawer = await page.$eval("aside[aria-labelledby], dialog[open][aria-labelledby]", (e) => e.innerText).catch(() => "");
  check("company drawer opens via ?company=", drawer.includes(name), name);
  await page.reload({ waitUntil: "networkidle0" });
  await settle(800);
  const again = await page.$eval("aside[aria-labelledby], dialog[open][aria-labelledby]", (e) => e.innerText).catch(() => "");
  check("company drawer survives a refresh (shareable URL)", again.includes(name));
  const drawerErrors = takeErrors();
  check("leads + drawer: no console errors", drawerErrors.length === 0, drawerErrors.join(" | "));
} else {
  console.log("SKIP  company drawer: this workspace has no companies");
}

// ---- sign out, then signed-out redirect ---------------------------------------
await page.click("button::-p-text(Account menu)");
await page.waitForSelector("button::-p-text(Sign out)");
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), page.click("button::-p-text(Sign out)")]);
check("sign out returns to /login", path() === "/login", path());
await page.goto(`${BASE}/w/${WS}/settings`, { waitUntil: "networkidle0" });
check("signed out: workspace URL redirects to /login", path() === "/login", page.url().replace(BASE, ""));

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
