/**
 * UI review for P1-E2 (manual entry, CSV import, pagination/filters,
 * restrictions). Drives the real UI end to end against the UI-review mock,
 * with FICTIONAL generic data only (example.test domains), and writes
 * screenshots 01-17.
 *
 * Desktop (owner of Org A, Alpha workspace, which starts empty):
 *   manual company (validation, create, duplicate warnings), manual contact,
 *   a 34-row CSV import: 28 + 1 new, 1 domain match (merge), 1 possible
 *   duplicate (create separately), 1 in-file duplicate (skip), 2 invalid rows.
 *   Expected: 30 created, 1 merged, 1 skipped, 2 invalid, 0 failed.
 *   Then pagination (31 companies → 2 pages), filters, restrictions.
 * Member: can restrict, can't lift. Mobile (390/360, Beta): a short import.
 *
 * Prereqs: npm run build; (re)start node scripts/ui-review/mock-supabase.mjs
 * (in-memory: restart before every run); npx next start -p 3000;
 * npm i --no-save puppeteer-core.
 * Run: node scripts/ui-review/review-imports.mjs [outDir]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "docs/reports/screenshots/P1-E2";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ALPHA = "20000000-0000-4000-a000-00000000000a";
const BETA = "20000000-0000-4000-a000-00000000000b";
const LEADS = (ws) => `${BASE}/w/${ws}/leads`;
const VIEW = {
  desktop: { width: 1440, height: 900 },
  m390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  m360: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const SLOW = { timeout: 180_000 };

// ---- fixture files (fictional, generic) -------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vleeds-import-review-"));
const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (rows) => "\uFEFF" + rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
const HEAD = ["Company", "Website", "Phone", "City", "State", "Country", "Owner Name", "Owner Email", "Employees", "Notes"];
const generic = Array.from({ length: 28 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return [`Sample Company ${n}`, `https://sample${n}.example.test`, "", i % 2 ? "Toronto" : "Denver", i % 2 ? "Ontario" : "Colorado", i % 2 ? "CA" : "US", `Person ${n}`, `person${n}@sample${n}.example.test`, "25", ""];
});
const DESKTOP_CSV = path.join(TMP, "leads-desktop.csv");
fs.writeFileSync(
  DESKTOP_CSV,
  csv([
    HEAD,
    ["Harbor Lane Logistics LLC", "https://www.harborlane.example.test", "", "Atlanta", "Georgia", "US", "Casey Morgan", "casey.morgan@harborlane.example.test", "120", "From a trade list"],
    ["Harbor Lane Logistics", "", "+1 404 555 0199", "Atlanta", "Georgia", "US", "Robin Hale", "robin.hale@harborwest.example.test", "", ""],
    ["Quayside Tools, Inc.", "https://quayside.example.test", "+1 503 555 0142", "Portland", "Oregon", "US", "Lee Fox", "lee.fox@quayside.example.test", "40", "Line one\nLine two"],
    ["", "", "", "", "", "", "Jamie Doe", "jamie.doe@example.test", "", ""],
    ["Fernway Supplies", "https://fernway.example.test", "", "Austin", "Texas", "US", "Pat Lane", "not-an-email", "", ""],
    ["Quayside Tools", "https://quayside.example.test/contact", "", "Portland", "Oregon", "US", "", "", "", ""],
    [],
    ...generic,
  ]),
);
const MOBILE_CSV = path.join(TMP, "leads-mobile.csv");
fs.writeFileSync(
  MOBILE_CSV,
  csv([
    ["Company", "Domain", "City", "Region", "Country", "Contact", "Email"],
    ["Northwind Analytics Ltd", "northwind.example.test", "London", "", "GB", "Avery Stone", "avery.stone@northwind.example.test"],
    ["Brightwave Systems", "", "Sydney", "New South Wales", "AU", "Taylor Quinn", "taylor.quinn@example.test"],
    ["Orchard Lane Studio", "orchardlane.example.test", "Dublin", "", "IE", "", ""],
    ["", "", "", "", "", "Nameless Contact", ""],
  ]),
);
const NOT_CSV = path.join(TMP, "notes.txt");
fs.writeFileSync(NOT_CSV, "not a csv");

// ---- harness ------------------------------------------------------------------
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
// Long protocol timeout: imports run many server round trips on a slow development machine.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"], protocolTimeout: 600_000 });
const requests = [];
async function newPage(viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(90_000);
  page.on("request", (r) => requests.push(r.url()));
  return { ctx, page };
}
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const text = (page, sel) => page.$eval(sel, (e) => e.innerText).catch(() => "");
const waitText = (page, sel, needle, opts = SLOW) =>
  page.waitForFunction((s, n) => (document.querySelector(s)?.innerText ?? "").includes(n), opts, sel, needle).then(() => true, () => false);
async function login(page, email) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", "vleeds-dev-password");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), page.click("button[type=submit]")]);
}
async function go(page, url) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForSelector("main h1");
  await settle();
}
/** Replaces a field's value through real key events (React only sees input events). */
async function fill(page, sel, value) {
  await page.focus(sel);
  await page.$eval(sel, (e) => e.select());
  await page.keyboard.press("Backspace");
  if (value) await page.type(sel, value);
}
/** waitForSelector that prints the page text on timeout (for diagnosing slow or failed steps). */
async function waitFor(page, sel, opts = SLOW) {
  try {
    return await page.waitForSelector(sel, opts);
  } catch (e) {
    console.log(`TIMEOUT waiting for ${sel}; page: ${page.url()}\n${(await text(page, "main")).slice(0, 1500)}`);
    throw e;
  }
}
const submitSheet = (page) => page.$eval("dialog[open] button[type=submit]", (b) => b.click());
async function upload(page, file) {
  const input = await page.$("#csv-file");
  await input.uploadFile(file);
  await settle(300);
  await page.click("main button[type=submit]");
}
/** Changes a row decision in the visible review layout and waits for the server round trip. */
async function decide(page, rowNumber, value, scope) {
  await page.select(`${scope} select[data-row="${rowNumber}"]`, value);
  await page.waitForFunction((s, n, v) => document.querySelector(`${s} select[data-row="${n}"]`)?.value === v && !document.querySelector(`${s} select[data-row="${n}"]`)?.disabled, SLOW, scope, rowNumber, value);
  await settle(800);
}
async function openCompare(page, rowNumber, scope) {
  await page.evaluate((s, n) => {
    const sel = document.querySelector(`${s} select[data-row="${n}"]`);
    [...sel.parentElement.querySelectorAll("button")].find((b) => b.textContent.includes("Compare")).click();
  }, scope, rowNumber);
  await page.waitForSelector("dialog[open]");
  await settle(500);
}
async function runImport(page) {
  await page.evaluate(() => [...document.querySelectorAll("main button")].find((b) => /^Import \d/.test(b.textContent)).click());
  const done = await waitText(page, "main", "Import complete", { timeout: 300_000 });
  await settle(800);
  return { done };
}
const counts = (page) =>
  page.$$eval("main dl div", (els) => Object.fromEntries(els.map((d) => [d.querySelector("dt").textContent, Number(d.querySelector("dd").textContent.replace(/,/g, ""))])));

// =============================================================================
// Desktop — manual entry
// =============================================================================
let harborId = null;
{
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "owner.a@example.test");
  await go(page, LEADS(ALPHA));
  check("empty workspace offers Add leads and Import a CSV", (await text(page, "main")).includes("No companies yet") && !!(await page.$("main a::-p-text(Import a CSV)")));

  await page.click("main button[aria-haspopup=menu]");
  await page.waitForSelector("[role=menu]");
  const items = await page.$$eval("[role=menu] [role=menuitem]", (els) => els.map((e) => e.innerText.split("\n")[0]));
  check("Add leads menu offers Add manually and Import CSV", JSON.stringify(items) === JSON.stringify(["Add manually", "Import CSV"]), JSON.stringify(items));
  await shot(page, "01-leads-add-menu-desktop");

  await page.click("[role=menu] ::-p-text(Add manually)");
  await page.waitForSelector("dialog[open]");
  await settle(500);
  await submitSheet(page);
  check("manual company: company name is required", await waitText(page, "dialog[open]", "Check the highlighted fields", { timeout: 60_000 }));
  check("manual company: the name field is marked invalid", !!(await page.$("#mc-name[aria-invalid=true]")));

  await fill(page, "#mc-name", "Harbor Lane Logistics");
  await fill(page, "#mc-website", "https://www.harborlane.example.test/about");
  await fill(page, "#mc-phone", "+1 404 555 0100");
  await page.select("#mc-country", "US");
  await fill(page, "#mc-region", "Georgia");
  await fill(page, "#mc-city", "Atlanta");
  await fill(page, "#mc-min", "50");
  await fill(page, "#mc-max", "200");
  await fill(page, "#mc-contact-name", "Casey Morgan");
  await fill(page, "#mc-contact-title", "Operations Manager");
  await fill(page, "#mc-contact-email", "Casey.Morgan@HarborLane.example.test");
  await shot(page, "02-manual-company-desktop");
  await submitSheet(page);
  await page.waitForFunction(() => location.search.includes("company="), SLOW);
  await page.waitForSelector("aside[aria-labelledby^=company-]");
  await settle(800);
  harborId = new URL(page.url()).searchParams.get("company");
  const drawer = await text(page, "aside[aria-labelledby^=company-]");
  check("manual company is created and opened in the drawer", drawer.includes("Harbor Lane Logistics") && drawer.includes("Atlanta"), page.url());
  check("domain is normalized from the website", drawer.includes("harborlane.example.test") && !drawer.includes("www.harborlane.example.test ·"));
  check("first contact is created as primary", drawer.includes("Casey Morgan") && drawer.includes("Primary") && drawer.toLowerCase().includes("casey.morgan@harborlane.example.test"));
  check("manual source evidence is recorded for the entered fields", (await page.$$("aside ul[aria-label='Source evidence'] li")).length >= 7 && drawer.includes("Source: Manual"));

  // duplicate: same domain (strong) → no separate create
  await page.click("main button[aria-haspopup=menu]");
  await page.click("[role=menu] ::-p-text(Add manually)");
  await page.waitForSelector("dialog[open]");
  await settle(400);
  await fill(page, "#mc-name", "Harbor Lane");
  await fill(page, "#mc-domain", "HARBORLANE.example.test");
  await submitSheet(page);
  const strong = await waitText(page, "dialog[open]", "This company may already exist", { timeout: 60_000 });
  const dlg = await text(page, "dialog[open]");
  check("same domain: duplicate warning names the existing company and blocks a second copy", strong && dlg.includes("Harbor Lane Logistics") && dlg.includes("can't be added again") && !dlg.includes("Add as a separate company"));
  check("duplicate warning offers Use existing", !!(await page.$("dialog[open] a::-p-text(Use existing)")));
  await shot(page, "03-manual-duplicate-warning-desktop");

  // duplicate: same name + place (weak) → may create separately
  await fill(page, "#mc-domain", "");
  await fill(page, "#mc-name", "Harbor Lane Logistics");
  await page.select("#mc-country", "US");
  await fill(page, "#mc-city", "Atlanta");
  await submitSheet(page);
  check("same name and place: warning allows Add as a separate company", await waitText(page, "dialog[open]", "Add as a separate company", { timeout: 60_000 }));
  await page.click("dialog[open] button::-p-text(Cancel)");
  await settle(500);
  check("cancel creates nothing", (await text(page, "main")).includes("All companies (1)"));

  // manual contact
  await page.click("aside button::-p-text(Add contact)");
  await page.waitForSelector("dialog[open]");
  await settle(400);
  check("primary contact can't be added twice (checkbox disabled)", !!(await page.$("dialog[open] input[type=checkbox][disabled]")));
  await fill(page, "#ac-full", "Drew Parker");
  await fill(page, "#ac-email", "casey.morgan@harborlane.example.test");
  await submitSheet(page);
  check("contact with an existing email (different case) is refused", await waitText(page, "dialog[open]", "already has this email", { timeout: 60_000 }));
  await fill(page, "#ac-email", "drew.parker@harborlane.example.test");
  await fill(page, "#ac-title", "Finance Lead");
  await submitSheet(page);
  await page.waitForFunction(() => !document.querySelector("dialog[open]"), SLOW);
  check("manual contact is added", await waitText(page, "aside[aria-labelledby^=company-]", "Contacts (2)"));
  await ctx.close();
}

// =============================================================================
// Desktop — CSV import
// =============================================================================
{
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "owner.a@example.test");
  await go(page, `${LEADS(ALPHA)}/import`);
  check("import page shows the four steps with Upload current", (await page.$eval("nav[aria-label='Import steps'] [aria-current=step]", (e) => e.innerText)).includes("Upload"));
  check("CSV input has a label", await page.$eval("#csv-file", (i) => !!document.querySelector(`label[for=${i.id}]`)));
  await shot(page, "04-csv-upload-desktop");

  await upload(page, NOT_CSV);
  check("a non-CSV file is rejected with a clear message", await waitText(page, "main", "Choose a .csv file", { timeout: 30_000 }));

  await upload(page, DESKTOP_CSV);
  await page.waitForFunction(() => /\/import\/[0-9a-f-]{36}/.test(location.pathname), SLOW);
  await page.waitForSelector("#map-0");
  await settle(800);
  const suggested = await page.$$eval("main select[id^=map-]", (els) => els.map((e) => e.value));
  check("mapping suggests fields from header names; unknown columns default to Ignore", JSON.stringify(suggested) === JSON.stringify(["company_name", "website", "phone", "city", "region", "country", "", "", "", "company_notes"]), JSON.stringify(suggested));
  check("mapping shows sample values (quoted comma kept)", (await text(page, "main")).includes("Quayside Tools, Inc."));
  await page.select("#map-6", "contact_name");
  await page.select("#map-7", "contact_email");
  await page.select("#map-1", "contact_name");
  check("mapping the same field twice is flagged", await waitText(page, "main", "already mapped to another column", { timeout: 10_000 }));
  await page.select("#map-1", "website");
  await shot(page, "05-csv-column-mapping-desktop");
  await page.click("main button::-p-text(Continue to review)");
  await waitFor(page, "main nav[aria-label='Filter rows']");
  await settle(1000);

  const T = "main table";
  const summary = await text(page, "main");
  check("review: blank line dropped, 34 rows staged", summary.includes("34 rows in file"), summary.match(/(\d+) rows in file/)?.[0]);
  check("review: suggested decisions are counted before import", summary.includes("29 new companies") && summary.includes("2 merges") && summary.includes("2 invalid") && summary.includes("1 need a decision"));
  const rows = await page.$$eval(`${T} tbody tr`, (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  check("review: domain match against an existing company", rows[0]?.includes("Same domain as Harbor Lane Logistics"), rows[0]);
  check("review: name + place is a possible duplicate (no automatic merge)", rows[1]?.includes("Possible duplicate") && (await page.$eval(`${T} select[data-row="2"]`, (s) => s.value)) === "", rows[1]);
  check("review: quoted line break stays inside one row", rows[2]?.includes("Quayside Tools, Inc.") && rows.length === 34);
  check("review: missing company name is an error tied to the row", rows[3]?.includes("Missing company name") && rows[3]?.includes("Error"));
  check("review: invalid email is an error", rows[4]?.includes("Contact email") && rows[4]?.includes("Error"));
  check("review: in-file duplicate refers to the earlier row", rows[5]?.includes("Same domain as row 3"), rows[5]);
  check("row errors are programmatically associated with the decision control", await page.$eval(`${T} select[data-row="2"]`, (s) => !s.getAttribute("aria-describedby") || !!document.getElementById(s.getAttribute("aria-describedby"))));
  await shot(page, "06-csv-review-desktop");

  // matched row: Create separately is not available
  await openCompare(page, 1, T);
  const cmp = await text(page, "dialog[open]");
  check("compare shows imported vs existing side by side", cmp.includes("Imported") && cmp.includes("Existing") && cmp.includes("harborlane.example.test") && cmp.includes("Casey Morgan"));
  check("strong domain identity: Create new is disabled and explained", !!(await page.$("dialog[open] input[type=radio][value=create][disabled]")) && cmp.includes("can't be created twice"));
  await page.click("dialog[open] button::-p-text(Cancel)");
  await settle(400);

  // possible duplicate → create separately
  await openCompare(page, 2, T);
  await shot(page, "07-csv-duplicate-review-desktop");
  await page.click("dialog[open] input[type=radio][value=create]");
  await submitSheet(page);
  await page.waitForFunction(() => !document.querySelector("dialog[open]"), SLOW);
  await page.waitForFunction((s) => document.querySelector(`${s} select[data-row="2"]`)?.value === "create", SLOW, T);
  check("create-separately decision saved for the possible duplicate", true);
  await decide(page, 6, "skip", T);
  check("skip decision saved for the in-file duplicate", (await page.$eval(`${T} select[data-row="6"]`, (s) => s.value)) === "skip");

  await page.click("main nav[aria-label='Filter rows'] ::-p-text(Invalid)");
  await page.waitForFunction(() => location.search.includes("view=invalid"), SLOW);
  await settle(800);
  check("Invalid view lists only the 2 invalid rows", (await page.$$(`${T} tbody tr`)).length === 2);
  await shot(page, "08-csv-invalid-rows-desktop");

  const button = await page.$eval("main ::-p-text(Import 31 rows)", (b) => b.textContent).catch(() => "");
  check("confirmation button counts exactly create + merge decisions", button === "Import 31 rows", button);
  const { done } = await runImport(page);
  check("import completes and shows the report", done);
  await go(page, page.url().split("?")[0]); // leave the Invalid view: show all outcomes
  const c = await counts(page);
  check("report counts: 34 total, 30 created, 1 merged, 1 skipped, 2 invalid, 0 failed", c["Total rows"] === 34 && c.Created === 30 && c.Merged === 1 && c.Skipped === 1 && c.Invalid === 2 && c.Failed === 0, JSON.stringify(c));
  check("completed import shows the Import step as complete", (await page.$eval("nav[aria-label='Import steps']", (n) => n.textContent)).includes("Import (completed)"));
  await shot(page, "09-csv-import-summary-desktop");
  const outcomes = await page.$$eval(`${T} tbody tr`, (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  check("row outcomes: merged row shows its decision and reports kept values as conflicts", outcomes[0]?.includes("Merged") && outcomes[0]?.includes("Decision: Merge") && outcomes[0]?.includes("Kept"), outcomes[0]);
  check("row outcomes: created, invalid and skipped rows are labelled", outcomes[1]?.includes("Created") && outcomes[3]?.includes("Invalid") && outcomes[5]?.includes("Skipped"));

  await page.reload({ waitUntil: "networkidle0" });
  await settle(800);
  check("idempotency: a completed import offers no Import action after reload", !(await page.$("main ::-p-text(Import 31 rows)")) && (await text(page, "main")).includes("Import complete"));
  await go(page, `${LEADS(ALPHA)}/import`);
  check("recent imports list the completed file", (await text(page, "main")).includes("leads-desktop.csv") && (await text(page, "main")).includes("Completed"));
  await ctx.close();
}

// =============================================================================
// Desktop — lead management after import
// =============================================================================
{
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "owner.a@example.test");
  await go(page, `${LEADS(ALPHA)}?company=${harborId}`);
  await page.waitForSelector("aside[aria-labelledby^=company-]");
  const d = await text(page, "aside[aria-labelledby^=company-]");
  check("merge kept existing values and added the import as CSV evidence", d.includes("50–200 employees") && d.includes("Source: CSV import"));
  check("merge added no duplicate contact (email match)", d.includes("Contacts (2)"));

  await go(page, LEADS(ALPHA));
  const all = await text(page, "main");
  check("Leads shows 31 companies, 25 per page", all.includes("All companies (31)") && (await page.$$("main table tbody tr")).length === 25 && all.includes("of 2"));
  await page.click("main a[aria-label='Next page']");
  await page.waitForFunction(() => location.search.includes("page=2"), SLOW);
  await settle(800);
  check("page 2 shows the remaining 6", (await page.$$("main table tbody tr")).length === 6);
  await page.click("main table tbody tr a");
  await page.waitForFunction(() => location.search.includes("company="), SLOW);
  await page.waitForSelector("aside[aria-labelledby^=company-]");
  check("drawer opens from a paginated result and keeps the page", page.url().includes("page=2"), page.url());
  await go(page, `${LEADS(ALPHA)}?page=99`);
  check("an empty page beyond the end is handled", (await text(page, "main")).includes("This page is empty"));

  await go(page, LEADS(ALPHA));
  await page.select("main select[name=country]", "CA");
  await page.waitForFunction(() => location.search.includes("country=CA"), SLOW);
  await settle(800);
  check("country filter (14 companies in Canada)", (await text(page, "main")).includes("Matching companies (14)"));
  await page.select("main select[name=sort]", "name");
  await page.waitForFunction(() => location.search.includes("sort=name"), SLOW);
  await settle(800);
  const names = await page.$$eval("main table tbody tr", (els) => els.map((e) => e.querySelector("a")?.innerText.split("\n")[0] ?? ""));
  check("sort by company name", names.length === 14 && names.every((n, i) => i === 0 || names[i - 1].localeCompare(n) <= 0), names.slice(0, 3).join(" | "));
  await page.select("main select[name=country]", "");
  await page.waitForFunction(() => !location.search.includes("country="), SLOW);
  await page.select("main select[name=contact]", "yes");
  await page.waitForFunction(() => location.search.includes("contact=yes"), SLOW);
  await settle(800);
  check("has-contact filter (all 31 have contacts) keeps pagination", (await text(page, "main")).includes("Matching companies (31)") && (await text(page, "main")).includes("of 2"));
  await shot(page, "10-leads-paginated-filtered-desktop");

  // restrictions
  await go(page, `${LEADS(ALPHA)}?company=${harborId}`);
  await page.waitForSelector("aside[aria-labelledby^=company-]");
  await page.click("aside button[aria-label='Do not contact this company']");
  await settle(300);
  await page.keyboard.type("Asked to pause outreach this quarter."); // the reason field is focused
  await page.click("aside button[type=submit]::-p-text(Restrict)");
  check("company restriction is added with a reason", await waitText(page, "aside[aria-labelledby^=company-]", "Do not contact this company. Reason: Asked to pause outreach"));
  await page.click("aside button[aria-label='Do not contact Casey Morgan']");
  await page.click("aside button[type=submit]::-p-text(Restrict)");
  check("contact restriction is added (reason optional)", await waitText(page, "aside[aria-labelledby^=company-]", "Contact restricted"));
  await settle(600);
  await shot(page, "11-company-restriction-desktop");
  await page.click("aside button::-p-text(Lift restriction for Casey Morgan)");
  check("owner lifts the contact restriction", await page.waitForFunction(() => !document.querySelector("aside")?.innerText.includes("Contact restricted"), SLOW).then(() => true, () => false));
  await go(page, `${LEADS(ALPHA)}?restricted=yes`);
  check("restricted filter shows the restricted company", (await text(page, "main")).includes("Matching companies (1)") && (await text(page, "main")).includes("Harbor Lane Logistics"));
  check("desktop: no horizontal overflow", await noOverflow(page));
  await ctx.close();
}

// member: may restrict, may not lift
{
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "member.a@example.test");
  await go(page, `${LEADS(ALPHA)}?company=${harborId}`);
  await page.waitForSelector("aside[aria-labelledby^=company-]");
  const d = await text(page, "aside[aria-labelledby^=company-]");
  check("member sees why they can't lift a restriction", d.includes("Only an owner or admin can lift this restriction.") && !(await page.$("aside button::-p-text(Lift restriction)")));
  await page.click("aside button[aria-label='Do not contact Drew Parker']");
  await page.click("aside button[type=submit]::-p-text(Restrict)");
  check("member can add a contact restriction", await waitText(page, "aside[aria-labelledby^=company-]", "Contact restricted"));
  await ctx.close();
}

// =============================================================================
// Mobile — Beta workspace, short import
// =============================================================================
for (const [name, vp] of [["390", VIEW.m390], ["360", VIEW.m360]]) {
  const { ctx, page } = await newPage(vp);
  await login(page, "owner.a@example.test");
  await go(page, `${LEADS(BETA)}/import`);
  check(`${name}px: upload step fits`, await noOverflow(page));
  if (name === "390") await shot(page, "12-csv-upload-mobile");

  if (name === "390") {
    await upload(page, MOBILE_CSV);
    await waitFor(page, "#map-0");
    await settle(800);
    const mapped = await page.$$eval("main select[id^=map-]", (els) => els.map((e) => e.value));
    check("390px: mapping suggestions", JSON.stringify(mapped) === JSON.stringify(["company_name", "domain", "city", "region", "country", "contact_name", "contact_email"]), JSON.stringify(mapped));
    const box = await (await page.$("#map-0")).boundingBox();
    check("390px: mapping selects are full width and >=44px tall", box.height >= 44 && box.width > 300, JSON.stringify(box));
    check("390px: mapping has no overflow", await noOverflow(page));
    await shot(page, "13-csv-mapping-mobile");
    // Mobile emulation mis-positions coordinate clicks below the fold inside the shell's scroll area; activate the control directly.
    await page.$eval("main button::-p-text(Continue to review)", (b) => b.click());
    await waitFor(page, "main nav[aria-label='Filter rows']");
    await settle(1000);
    const L = "main ul[aria-label='Rows to review']";
    const cards = await page.$$eval(`${L} > li`, (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
    check("390px: review rows are cards", cards.length === 4 && !(await page.$("main table:not([hidden])").then((t) => t?.boundingBox())), String(cards.length));
    check("390px: review has no overflow", await noOverflow(page));
    await shot(page, "14-csv-review-mobile");
    await openCompare(page, 2, L);
    const sheet = await page.evaluate(() => {
      const r = document.querySelector("dialog[open]").getBoundingClientRect();
      return { bottom: Math.round(r.bottom), width: Math.round(r.width), inside: document.querySelector("dialog[open]").contains(document.activeElement) };
    });
    check("390px: duplicate review is a bottom sheet with focus inside", sheet.bottom >= vp.height - 1 && sheet.width >= vp.width - 1 && sheet.inside, JSON.stringify(sheet));
    await page.$eval("dialog[open] input[type=radio][value=merge]", (r) => r.click());
    await settle(300);
    await shot(page, "15-duplicate-review-mobile");
    const radio = await (await page.$("dialog[open] input[type=radio][value=merge]")).evaluate((r) => r.closest("label").getBoundingClientRect().height);
    check("390px: decision choices are >=44px targets", radio >= 44, String(radio));
    await submitSheet(page);
    await page.waitForFunction(() => !document.querySelector("dialog[open]"), SLOW);
    await page.waitForFunction((s) => document.querySelector(`${s} select[data-row="2"]`)?.value === "merge", SLOW, L);
    await settle(800);
    const { done } = await runImport(page);
    const c = await counts(page);
    check("390px: import completes (1 created, 2 merged, 1 invalid)", done && c.Created === 1 && c.Merged === 2 && c.Invalid === 1, JSON.stringify(c));
    check("390px: report has no overflow", await noOverflow(page));
    await shot(page, "16-import-summary-mobile");
  } else {
    // cancel an uncommitted import (with confirmation)
    await upload(page, MOBILE_CSV);
    await waitFor(page, "#map-0");
    await settle(800);
    await page.$eval("main button::-p-text(Cancel import)", (b) => b.click());
    check(`${name}px: cancelling asks for confirmation first`, await waitText(page, "main", "Cancel this import?", { timeout: 10_000 }));
    await page.$eval("main button::-p-text(Yes, cancel)", (b) => b.click());
    check(`${name}px: a cancelled import says nothing was added`, await waitText(page, "main", "This import was cancelled"));
  }

  await go(page, LEADS(BETA));
  await page.click("main button[aria-controls=lead-filters]");
  await settle(400);
  const sel = await (await page.$("main select[name=qualification]")).boundingBox();
  check(`${name}px: filters open on demand and selects are >=44px`, sel && sel.height >= 44);
  check(`${name}px: filters have no overflow`, await noOverflow(page));
  if (name === "390") await shot(page, "17-leads-filter-mobile");
  const bottom = await page.$$eval("nav[aria-label=Primary].fixed a", (els) => els.map((e) => e.textContent.trim()));
  check(`${name}px: bottom navigation unchanged`, bottom.length === 5 && bottom[2] === "Leads");
  await page.click("main button[aria-haspopup=menu]");
  await page.waitForSelector("[role=menu]");
  const menu = await (await page.$("[role=menu]")).boundingBox();
  check(`${name}px: Add leads menu fits the screen`, menu.x >= 0 && menu.x + menu.width <= vp.width + 1, JSON.stringify(menu));
  await ctx.close();
}

// =============================================================================
const direct = requests.filter((u) => u.includes(":54321"));
check("browser never calls Supabase directly", direct.length === 0, direct.slice(0, 2).join(", "));
await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
