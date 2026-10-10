/**
 * UI review for P0-E1-S2 (Settings: business profile + ICP configuration).
 *
 * Walks a fresh workspace through first-time configuration with GENERIC
 * fixture values, checking validation, truthful status pills, dirty-close
 * protection, keyboard/focus behaviour, role-based read-only state, mobile
 * sheets at 390/360px and overflow; writes screenshots 01-16.
 *
 * The example values below are UI-review fixtures only. They must never
 * appear in application code (enforced by tests/unit/business-agnostic.test.ts).
 *
 * Prereqs (fresh mock state, since the walkthrough starts unconfigured):
 *   npm run build
 *   node scripts/ui-review/mock-supabase.mjs      (restart before each run)
 *   npx next start -p 3000
 *   npm i --no-save puppeteer-core
 * Run:
 *   node scripts/ui-review/review-settings.mjs [outDir]
 */
import puppeteer from "puppeteer-core";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "docs/reports/screenshots/P0-E1-S2";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ALPHA = "20000000-0000-4000-a000-00000000000a";
const SETTINGS = `${BASE}/w/${ALPHA}/settings`;
const VIEW = {
  desktop: { width: 1440, height: 900 },
  m390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  m360: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const SECTIONS = ["ideal_customer", "geographies", "decision_makers", "buying_signals", "exclusion_signals", "scoring"];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
const browserRequests = [];

async function newPage(viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.setDefaultNavigationTimeout(90_000);
  page.setDefaultTimeout(60_000);
  page.on("request", (r) => browserRequests.push(r.url()));
  return { ctx, page };
}
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => {
  // Sheet screenshots start at the top of the editor so the whole form context is visible.
  await page.$eval("dialog[open] form > div:nth-child(2)", (e) => (e.scrollTop = 0)).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur?.());
  await settle(150);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const dialogOpen = (page) => page.$("dialog[open]").then(Boolean);

async function login(page, email) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", "vleeds-dev-password");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), page.click("button[type=submit]")]);
}
async function gotoSettings(page) {
  await page.goto(SETTINGS, { waitUntil: "networkidle0" });
  await page.waitForSelector("button[data-section=scoring]");
  await settle();
}
const pill = (page, section) => page.$eval(`button[data-section=${section}]`, (e) => e.innerText);
async function open(page, section) {
  await page.click(`button[data-section=${section}]`);
  await page.waitForSelector("dialog[open]");
  await settle();
}
async function fill(page, selector, text) {
  await page.focus(selector);
  await page.$eval(selector, (e) => e.select());
  await page.keyboard.press("Backspace");
  if (text) await page.type(selector, text);
}
/** Clicks Save; resolves "closed" or "error". */
async function save(page) {
  await page.click("dialog[open] button[type=submit]");
  const outcome = await Promise.race([
    page.waitForFunction(() => !document.querySelector("dialog[open]"), { timeout: 30_000 }).then(() => "closed"),
    page.waitForSelector("dialog[open] [role=alert]", { timeout: 30_000 }).then(() => "error"),
  ]).catch(() => "timeout");
  await settle(600);
  return outcome;
}
async function waitPill(page, section, text) {
  await page
    .waitForFunction((s, t) => document.querySelector(`button[data-section=${s}]`)?.innerText.includes(t), { timeout: 30_000 }, section, text)
    .catch(() => {});
  return (await pill(page, section)).includes(text);
}
const nth = (page, selector, i) => page.$$(selector).then((els) => els[i]);

// =============================================================================
// Owner, desktop: first-time configuration walkthrough
// =============================================================================
{
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "owner.a@example.test");
  await gotoSettings(page);

  const pills = await Promise.all(SECTIONS.map((s) => pill(page, s)));
  check("fresh workspace: all six ICP rows say Not configured", pills.every((t) => t.includes("Not configured")), JSON.stringify(pills.map((t) => t.split("\n").pop())));
  const laterRows = await page.$$eval("li[data-later-step]", (els) => els.map((e) => e.innerText));
  check("enrichment + calling rows stay inactive and not configured", laterRows.length === 2 && laterRows.every((t) => t.includes("Not configured") && t.includes("later setup step")) && !(await page.$("button[data-section=enrichment]")));
  check("owner sees the business profile Edit control", !!(await page.$("button[aria-haspopup=dialog]::-p-text(Edit)")));
  await shot(page, "01-settings-unconfigured-desktop");

  // ---- business profile: validation, dirty close, save -----------------------
  const editBtn = await page.$("button[aria-haspopup=dialog]::-p-text(Edit)");
  await editBtn.click();
  await page.waitForSelector("dialog[open] #bp-name");
  await settle();
  check("business profile editor opens as a modal dialog with focus inside", await page.evaluate(() => document.querySelector("dialog[open]")?.contains(document.activeElement)));
  await fill(page, "#bp-name", "");
  await fill(page, "#bp-domain", "not a domain");
  check("profile save with invalid input stays open with an error", (await save(page)) === "error");
  const nameAria = await page.$eval("#bp-name", (e) => [e.getAttribute("aria-invalid"), e.getAttribute("aria-describedby")]);
  check("profile field errors are linked with aria-describedby", nameAria[0] === "true" && nameAria[1] === "bp-name-error" && !!(await page.$("#bp-name-error")), JSON.stringify(nameAria));
  check("domain error shown inline", !!(await page.$("#bp-domain-error")));
  await fill(page, "#bp-name", "Alpha Workspace");
  await fill(page, "#bp-domain", "alpha.example.test");
  await fill(page, "#bp-description", "Generic development workspace used for UI review.");
  await shot(page, "02-business-profile-edit-desktop");
  check("profile saves and the sheet closes", (await save(page)) === "closed");
  const cardText = await page.$eval("section[aria-labelledby=business-profile-title]", (e) => e.innerText);
  check("business profile card updates in place without navigation", cardText.includes("used for UI review") && page.url() === SETTINGS);
  check("focus returns to the Edit button after save", await page.evaluate(() => document.activeElement?.textContent?.includes("Edit")));

  // dirty-close protection
  await (await page.$("button[aria-haspopup=dialog]::-p-text(Edit)")).click();
  await page.waitForSelector("dialog[open] #bp-name");
  await page.type("#bp-description", " Unsaved words.");
  await page.keyboard.press("Escape");
  await settle();
  const confirmText = await page.$eval("dialog[open]", (e) => e.innerText).catch(() => "");
  check("Escape on a dirty editor asks to discard instead of closing", (await dialogOpen(page)) && confirmText.includes("Discard your unsaved changes?"));
  check("focus moves to Keep editing", await page.evaluate(() => document.activeElement?.textContent === "Keep editing"));
  await page.click("dialog[open] button::-p-text(Keep editing)");
  await settle();
  check("Keep editing keeps the edits", (await page.$eval("#bp-description", (e) => e.value)).includes("Unsaved words."));
  await page.click("dialog[open] button[aria-label=Close]");
  await settle();
  await page.click("dialog[open] button::-p-text(Discard changes)");
  await settle();
  const afterDiscard = await page.$eval("section[aria-labelledby=business-profile-title]", (e) => e.innerText);
  check("Discard closes and leaves the saved profile unchanged", !(await dialogOpen(page)) && !afterDiscard.includes("Unsaved words."));
  await (await page.$("button[aria-haspopup=dialog]::-p-text(Edit)")).click();
  await page.waitForSelector("dialog[open] #bp-name");
  await page.type("#bp-description", " x");
  await page.click("dialog[open] button::-p-text(Cancel)");
  await settle();
  check("Cancel discards immediately", !(await dialogOpen(page)));

  // ---- ideal customer ----------------------------------------------------------
  await open(page, "ideal_customer");
  check("ICP editor shows first-time note", (await page.$eval("dialog[open]", (e) => e.innerText)).includes("Saving creates this workspace's default profile"));
  await fill(page, "#icp-description", "Established firms that rely on outside expertise.");
  for (const t of ["Professional Services", "Software"]) {
    await page.type("#icp-industries", t);
    await page.keyboard.press("Enter");
  }
  await page.type("#icp-industries", "software");
  await page.keyboard.press("Enter");
  check("duplicate industry tag is refused (case-insensitive)", !!(await page.$("#icp-industries-error")));
  await fill(page, "#icp-industries", "");
  await page.type("#icp-min", "50");
  await page.type("#icp-max", "10");
  check("company size min > max is rejected", (await save(page)) === "error" && !!(await page.$("#icp-max-error")));
  await fill(page, "#icp-max", "500");
  await page.type("#icp-characteristics", "Established business");
  await page.keyboard.press("Enter");
  await page.type("#icp-keywords", "consulting");
  await page.keyboard.press("Enter");
  await page.click("button[aria-label='Remove keyword consulting']");
  check("tag remove button works and is labelled", (await page.$$("ul[aria-label='Positive keywords'] li")).length === 0);
  await page.type("#icp-keywords", "advisory");
  await page.keyboard.press("Enter");
  await settle();
  await shot(page, "03-icp-editor-desktop");
  check("ICP saves (creates the default profile)", (await save(page)) === "closed");
  check("ideal customer status becomes Configured", await waitPill(page, "ideal_customer", "Configured"));

  // ---- geographies -------------------------------------------------------------
  await open(page, "geographies");
  await page.select("#geo-country", "US");
  await page.click("dialog[open] button::-p-text(Add target)");
  await page.select("#geo-country", "US");
  await page.type("#geo-region", "California");
  await page.click("dialog[open] button::-p-text(Add target)");
  await page.select("#geo-country", "US");
  await page.click("dialog[open] button::-p-text(Add target)");
  check("duplicate geography is refused", !!(await page.$("#geo-country-error")));
  await page.click("dialog[open] button::-p-text(Clear)");
  await page.select("#geo-country", "DE");
  await page.click("dialog[open] button::-p-text(Add target)");
  const germany = await page.$$eval("dialog[open] li", (els) => els.map((e) => e.innerText).find((t) => t.includes("Germany")));
  check("country-only target for another country is added", !!germany);
  await page.click("dialog[open] button[aria-label='Remove Germany']");
  await settle();
  const geoCount = await page.$$eval("dialog[open] ul li button[aria-label^=Remove]", (els) => els.length);
  check("geography remove works", geoCount === 2, String(geoCount));
  await page.click("dialog[open] button[aria-label^='Edit California']");
  await page.type("#geo-label", "California (state)");
  await page.click("dialog[open] button::-p-text(Update target)");
  await settle();
  check("geography edit updates the entry", (await page.$eval("dialog[open]", (e) => e.innerText)).includes("California (state)"));
  await shot(page, "04-geographies-desktop");
  check("geographies save", (await save(page)) === "closed");
  check("geographies status becomes Configured", await waitPill(page, "geographies", "Configured"));

  // ---- decision makers ---------------------------------------------------------
  await open(page, "decision_makers");
  await page.click("dialog[open] button::-p-text(Add role)");
  await settle(200);
  check("Add role focuses the new title field", await page.evaluate(() => /^dm-.*-title$/.test(document.activeElement?.id ?? "")));
  await page.keyboard.type("Founder");
  await page.click("dialog[open] button::-p-text(Add role)");
  await settle(200);
  await page.keyboard.type("Operations Director");
  await page.click("dialog[open] button::-p-text(Add role)");
  await settle(200);
  await page.keyboard.type("  founder ");
  check("duplicate decision-maker title is rejected", (await save(page)) === "error" && (await page.$eval("dialog[open]", (e) => e.innerText)).includes("already listed"));
  await (await nth(page, "dialog[open] button[aria-label^=Remove]", 2)).click();
  const prioritySelects = await page.$$("dialog[open] select[id$=-priority]");
  const priorities = await Promise.all(prioritySelects.map((s) => s.evaluate((e) => e.value)));
  check("first role defaults to primary, later roles to secondary", JSON.stringify(priorities) === '["primary","secondary"]', JSON.stringify(priorities));
  await prioritySelects[1].select("fallback");
  await prioritySelects[1].select("secondary");
  await settle();
  await shot(page, "05-decision-makers-desktop");
  check("decision makers save", (await save(page)) === "closed");
  check("decision-maker status becomes Configured", await waitPill(page, "decision_makers", "Configured"));

  // ---- buying signals ----------------------------------------------------------
  await open(page, "buying_signals");
  await page.click("dialog[open] button::-p-text(Add signal)");
  await settle(200);
  await page.keyboard.type("Hiring");
  await fill(page, "dialog[open] input[id$=-weight]", "60");
  await page.click("dialog[open] button::-p-text(Add signal)");
  await settle(200);
  await page.keyboard.type("Expansion");
  const weightIds = await page.$$eval("dialog[open] input[id$=-weight]", (els) => els.map((e) => `#${CSS.escape(e.id)}`));
  await fill(page, weightIds[1], "150");
  check("weight above 100 is rejected", (await save(page)) === "error" && (await page.$eval("dialog[open]", (e) => e.innerText)).includes("Use 1 to 100"));
  await fill(page, weightIds[1], "40");
  await page.type("dialog[open] textarea[id$=-description]", "Recently posted open roles.");
  const switches = await page.$$("dialog[open] input[role=switch]");
  await switches[1].evaluate((e) => e.click());
  check("signal enable switch toggles", (await switches[1].evaluate((e) => e.checked)) === false);
  await switches[1].evaluate((e) => e.click());
  await settle();
  await shot(page, "06-buying-signals-desktop");
  check("buying signals save", (await save(page)) === "closed");
  check("buying-signal status becomes Configured", await waitPill(page, "buying_signals", "Configured"));

  // ---- exclusions --------------------------------------------------------------
  await open(page, "exclusion_signals");
  check("saving an empty exclusion list is allowed", (await save(page)) === "closed");
  check("explicit empty exclusions show No exclusions", await waitPill(page, "exclusion_signals", "No exclusions"));
  await open(page, "exclusion_signals");
  await page.click("dialog[open] button::-p-text(Add exclusion)");
  await settle(200);
  await page.keyboard.type("Existing customer");
  await page.click("dialog[open] button::-p-text(Add exclusion)");
  await settle(200);
  await page.keyboard.type("Very small company");
  const penaltyRadios = await page.$$("dialog[open] input[type=radio][value=penalty]");
  await penaltyRadios[1].click();
  await fill(page, "dialog[open] input[id$=-penalty]", "");
  check("penalty behaviour requires a penalty", (await save(page)) === "error" && (await page.$eval("dialog[open]", (e) => e.innerText)).includes("Enter a penalty"));
  await page.type("dialog[open] input[id$=-penalty]", "15");
  await settle();
  await shot(page, "07-exclusion-signals-desktop");
  check("exclusions save", (await save(page)) === "closed");
  check("exclusion status becomes Configured", await waitPill(page, "exclusion_signals", "Configured"));

  // ---- scoring -----------------------------------------------------------------
  await open(page, "scoring");
  check("unsaved scoring shows suggested values (not saved)", (await page.$eval("#sc-a", (e) => e.value)) === "75" && (await pill(page, "scoring")).includes("Not configured"));
  await fill(page, "#sc-a", "50");
  await fill(page, "#sc-b", "50");
  check("A threshold must exceed B", (await save(page)) === "error" && !!(await page.$("#sc-a-error")));
  check("preview hides incoherent ranges", (await page.$eval("dialog[open]", (e) => e.innerText)).includes("to see the grade ranges"));
  await fill(page, "#sc-a", "80");
  await fill(page, "#sc-b", "55");
  await fill(page, "#sc-w-company_fit", "50");
  check("category weights must total 100", (await save(page)) === "error" && !!(await page.$("#sc-total-error")));
  await fill(page, "#sc-w-company_fit", "40");
  await settle();
  const bands = await page.$eval("ul[aria-label='Grade ranges']", (e) => e.innerText.replace(/\s+/g, " "));
  check("grade preview reflects the thresholds", bands.includes("80–100") && bands.includes("55–79") && bands.includes("0–54"), bands);
  await shot(page, "08-scoring-rules-desktop");
  check("scoring saves", (await save(page)) === "closed");
  check("scoring status becomes Configured", await waitPill(page, "scoring", "Configured"));

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("button[data-section=scoring]");
  await settle();
  const final = await Promise.all(SECTIONS.map((s) => pill(page, s)));
  check("after reload all six sections are Configured (persisted)", final.every((t) => t.includes("Configured")), JSON.stringify(final.map((t) => t.split("\n").pop())));
  await shot(page, "09-settings-configured-desktop");

  // ---- keyboard ------------------------------------------------------------------
  await page.focus("button[data-section=geographies]");
  await page.keyboard.press("Enter");
  await page.waitForSelector("dialog[open]");
  await settle();
  const sheetBox = await page.$eval("dialog[open]", (e) => e.getBoundingClientRect().toJSON());
  check("desktop editor is a right-side sheet", sheetBox.right >= 1439 && sheetBox.width <= 560 && sheetBox.height >= 899, JSON.stringify(sheetBox));
  // The page behind a modal <dialog> is inert: Tab may pass to the browser UI
  // (activeElement = body) but must never reach page content outside the sheet.
  let escaped = 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    escaped += await page.evaluate(() => {
      const a = document.activeElement;
      return a && a !== document.body && !document.querySelector("dialog[open]")?.contains(a) ? 1 : 0;
    });
  }
  check("Tab never reaches page content behind the open sheet (40 presses)", escaped === 0, `${escaped} escapes`);
  await page.keyboard.press("Escape");
  await settle();
  check("Escape closes a clean sheet", !(await dialogOpen(page)));
  check("focus returns to the row that opened the sheet", await page.evaluate(() => document.activeElement?.getAttribute("data-section") === "geographies"));
  check("desktop settings: no horizontal overflow", await noOverflow(page));
  await ctx.close();
}

// =============================================================================
// Admin and member
// =============================================================================
{
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "multi@example.test"); // admin of Org A
  await gotoSettings(page);
  check("admin sees the Edit control", !!(await page.$("button[aria-haspopup=dialog]::-p-text(Edit)")));
  await open(page, "decision_makers");
  check("admin gets an editable sheet with Save", !!(await page.$("dialog[open] button[type=submit]")));
  await ctx.close();
}
{
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "member.a@example.test");
  await gotoSettings(page);
  check("member sees no business profile Edit control", !(await page.$("button[aria-haspopup=dialog]::-p-text(Edit)")));
  check("member sees the same truthful statuses", (await pill(page, "scoring")).includes("Configured"));
  await open(page, "decision_makers");
  const text = await page.$eval("dialog[open]", (e) => e.innerText);
  check(
    "member opens a read-only sheet (no Save, no inputs, explains why)",
    !(await page.$("dialog[open] button[type=submit]")) && !(await page.$("dialog[open] input, dialog[open] select")) && text.includes("Only owners and admins") && text.includes("Founder"),
  );
  await shot(page, "10-settings-member-readonly-desktop");
  await page.keyboard.press("Escape");
  await settle();
  check("read-only sheet closes with Escape without confirmation", !(await dialogOpen(page)));
  await open(page, "scoring");
  check("member scoring view is read-only", (await page.$eval("#sc-a", (e) => e.readOnly)) && !(await page.$("dialog[open] button[type=submit]")));
  await ctx.close();
}

// =============================================================================
// Mobile
// =============================================================================
for (const [name, vp] of [["390", VIEW.m390], ["360", VIEW.m360]]) {
  const { ctx, page } = await newPage(vp);
  await login(page, "owner.a@example.test");
  await gotoSettings(page);
  check(`${name}px: settings has no horizontal overflow`, await noOverflow(page));
  if (name === "390") await shot(page, "11-settings-mobile");

  const sheets = [
    ["edit", "12-business-profile-edit-mobile"],
    ["ideal_customer", "13-icp-editor-mobile"],
    ["geographies", "14-geographies-mobile"],
    ["decision_makers", "15-decision-makers-mobile"],
    ["buying_signals", null],
    ["exclusion_signals", null],
    ["scoring", "16-scoring-mobile"],
  ];
  let ok = true;
  const details = [];
  for (const [section, file] of sheets) {
    if (section === "edit") {
      await page.evaluate(() => window.scrollTo(0, 0));
      await (await page.$("button[aria-haspopup=dialog]::-p-text(Edit)")).click();
      await page.waitForSelector("dialog[open]");
      await settle();
    } else {
      await page.$eval(`button[data-section=${section}]`, (e) => e.scrollIntoView({ block: "center" }));
      await open(page, section);
    }
    const m = await page.evaluate(() => {
      const d = document.querySelector("dialog[open]");
      const r = d.getBoundingClientRect();
      const buttons = [...d.querySelectorAll("form > div:last-child button")].map((b) => b.getBoundingClientRect());
      const inner = d.querySelector("form > div:nth-child(2)");
      return {
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        footerVisible: buttons.every((b) => b.bottom <= window.innerHeight + 1),
        footerTargets: buttons.every((b) => b.height >= 44),
        innerOverflow: inner.scrollWidth > inner.clientWidth + 1,
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    const sheetOk = m.top <= vp.height * 0.1 && Math.abs(m.bottom - vp.height) <= 2 && m.width === vp.width && m.footerVisible && m.footerTargets && !m.innerOverflow && !m.pageOverflow;
    if (!sheetOk) details.push(`${section}: ${JSON.stringify(m)}`);
    ok &&= sheetOk;
    if (file && name === "390") await shot(page, file);
    await page.click("dialog[open] button::-p-text(Cancel), dialog[open] button::-p-text(Close)").catch(() => page.keyboard.press("Escape"));
    await settle();
  }
  check(`${name}px: every editor is a near-full-height bottom sheet, footer visible with 44px targets, no overflow`, ok, details.join(" | "));
  await ctx.close();
}

// =============================================================================
const fromBrowser = browserRequests.filter((u) => u.includes(":54321"));
check("browser never calls Supabase directly", fromBrowser.length === 0, fromBrowser.slice(0, 3).join(", "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
