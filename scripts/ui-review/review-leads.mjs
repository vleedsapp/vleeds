/**
 * UI review for P1-E1 (lead core: Leads page + company drawer).
 *
 * Uses the UI-review mock's FICTIONAL fixtures: Alpha has no companies (empty
 * state), Beta has five, Gamma (another organization) has one that Org A users
 * must never see. Checks truthful rendering, drawer behaviour (URL state,
 * focus, Escape), qualification saving, restriction display, mobile cards and
 * sheet, overflow and keyboard access; writes screenshots 01-11.
 *
 * Prereqs: npm run build; (re)start node scripts/ui-review/mock-supabase.mjs;
 * npx next start -p 3000; npm i --no-save puppeteer-core.
 * Run: node scripts/ui-review/review-leads.mjs [outDir]
 */
import puppeteer from "puppeteer-core";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "docs/reports/screenshots/P1-E1";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ALPHA = "20000000-0000-4000-a000-00000000000a";
const BETA = "20000000-0000-4000-a000-00000000000b";
const LEADS = (ws) => `${BASE}/w/${ws}/leads`;
const fid = (prefix, n) => `${prefix}-0000-4000-a000-${String(n).padStart(12, "0")}`;
const CO = { northwind: fid("30000000", 1), cedar: fid("30000000", 3), brightwave: fid("30000000", 4), gamma: fid("30000000", 9) };
const VIEW = {
  desktop: { width: 1440, height: 900 },
  m390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  m360: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
const requests = [];
const bodies = [];

async function newPage(viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.setDefaultNavigationTimeout(90_000);
  page.setDefaultTimeout(60_000);
  page.on("request", (r) => requests.push(r.url()));
  page.on("response", async (r) => {
    try {
      if (/html|x-component|json|javascript/.test(r.headers()["content-type"] ?? "")) bodies.push(await r.text());
    } catch {}
  });
  return { ctx, page };
}
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const text = (page, sel) => page.$eval(sel, (e) => e.innerText).catch(() => "");
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
const drawerSel = (desktop) => (desktop ? "aside[aria-labelledby^=company-]" : "dialog[open]");
async function scrollDrawerTo(page, desktop, heading) {
  await page.evaluate((sel, h) => {
    const root = document.querySelector(sel);
    const el = [...root.querySelectorAll("h3")].find((x) => x.textContent.startsWith(h));
    el?.scrollIntoView({ block: "start" });
    if (sel.startsWith("aside")) window.scrollTo(0, 0);
  }, drawerSel(desktop), heading);
  await settle(300);
}

// =============================================================================
// Desktop
// =============================================================================
{
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "owner.a@example.test");

  await go(page, LEADS(ALPHA));
  const empty = await text(page, "main");
  check("empty workspace shows the truthful empty state and no table", empty.includes("No companies yet") && empty.includes("All companies (0)") && !(await page.$("main table")));
  await shot(page, "01-leads-empty-desktop");

  await go(page, LEADS(BETA));
  const rows = await page.$$eval("main table tbody tr", (els) => els.map((e) => e.innerText));
  check("populated workspace lists its 5 companies (none from another organization)", rows.length === 5 && !rows.some((r) => r.includes("Gamma Only Co")), String(rows.length));
  const headers = await page.$$eval("main table thead th", (els) => els.map((e) => e.innerText.trim()));
  check("columns are real data only (no fit, signal or call column)", JSON.stringify(headers) === JSON.stringify(["Grade", "Company", "Primary contact", "Qualification", "Sources", "Updated"]), JSON.stringify(headers));
  const nw = rows.find((r) => r.includes("Northwind Analytics")) ?? "";
  check("current score shows a grade; pending/unscored rows show none", (await page.$("main table [aria-label='Grade A']")) !== null && rows.find((r) => r.includes("Brightwave"))?.includes("—"));
  check("row shows primary contact, qualification, sources", nw.includes("Avery Stone") && nw.includes("Needs review") && nw.includes("4 sources"), nw.replace(/\s+/g, " "));
  check("company restriction is stated in text on the row", rows.find((r) => r.includes("Cedar Point Studio"))?.includes("Restricted"));
  check("no Call buttons anywhere on the Leads page", !(await page.$("main button::-p-text(Call)")));
  await shot(page, "02-leads-populated-fixture-desktop");

  // keyboard: Tab to the company link and open it with Enter
  await page.focus(`main table a[data-company-link="${CO.northwind}"]`);
  await Promise.all([page.waitForFunction((id) => location.search.includes(id), {}, CO.northwind), page.keyboard.press("Enter")]);
  await page.waitForSelector(drawerSel(true));
  await settle(700);
  check("opening a company puts its id in the URL (shareable)", page.url().endsWith(`?company=${CO.northwind}`), page.url());
  check("drawer title receives focus", await page.evaluate(() => document.activeElement?.id?.endsWith("-title")));
  const d = await text(page, drawerSel(true));
  check("drawer shows company facts", d.includes("Northwind Analytics") && d.includes("London") && d.includes("50–200 employees") && d.includes("+44 20 7946 0000") && d.includes("https://www.northwind.example.test"));
  check("drawer shows the current grade and keeps the older revision labelled outdated", d.includes("Revision 3") && d.includes("84") && d.includes("Outdated: profile changed"));
  check("drawer has no call/email/automation actions", !(await page.$(`${drawerSel(true)} button::-p-text(Call)`)) && !d.includes("Email sequence"));
  check("selected row is marked as current", (await page.$(`main table a[aria-current=true][data-company-link="${CO.northwind}"]`)) !== null);
  await shot(page, "03-company-detail-desktop");

  await scrollDrawerTo(page, true, "Contacts");
  const contacts = await page.$$eval(`${drawerSel(true)} section[aria-labelledby$=-contacts] li`, (els) => els.map((e) => e.innerText));
  check("all contacts listed, primary first, statuses and restrictions in text", contacts.length === 3 && contacts[0].includes("Avery Stone") && contacts[0].includes("Primary") && contacts.some((c) => c.includes("Left company")) && contacts.some((c) => c.includes("Jordan Pike") && c.includes("Contact restricted")), JSON.stringify(contacts.map((c) => c.split("\n")[0])));
  await shot(page, "04-company-contacts-desktop");

  await scrollDrawerTo(page, true, "Sources");
  const sources = await page.$$eval(`${drawerSel(true)} ul[aria-label='Source evidence'] li`, (els) => els.map((e) => e.innerText));
  check("source evidence lists company and contact evidence with kind, provider and confidence", sources.length === 4 && sources.some((s) => s.includes("Public dataset (example-registry)") && s.includes("Confidence 75%") && s.includes("Avery Stone")) && sources.some((s) => s.includes("CSV import") && s.includes("Phone")), String(sources.length));
  await shot(page, "05-source-evidence-desktop");

  // qualification
  await scrollDrawerTo(page, true, "Qualification");
  await page.click(`${drawerSel(true)} input[type=radio][value=qualified]`);
  await page.type(`${drawerSel(true)} input[id^=qualification-reason-]`, "Fits the default profile.");
  await page.click(`${drawerSel(true)} button::-p-text(Save qualification)`);
  await page.waitForFunction(() => document.querySelector("[aria-live=polite]")?.textContent === "Saved", { timeout: 30_000 }).catch(() => {});
  await settle(700);
  const rowAfter = await page.$$eval("main table tbody tr", (els) => els.map((e) => e.innerText).find((t) => t.includes("Northwind")));
  check("qualification saves and the table updates in place", rowAfter?.includes("Qualified") && (await text(page, drawerSel(true))).includes("Saved"), rowAfter?.replace(/\s+/g, " "));
  await shot(page, "06-qualified-company-desktop");

  // Escape closes and returns focus
  await page.focus(`${drawerSel(true)} input[type=radio][value=qualified]`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !location.search.includes("company="), { timeout: 30_000 }).catch(() => {});
  await settle(700);
  check("Escape closes the drawer and clears the URL", !(await page.$(drawerSel(true))) && !page.url().includes("company="), page.url());
  check("focus returns to the company link", await page.evaluate((id) => document.activeElement?.getAttribute("data-company-link") === id, CO.northwind));

  await go(page, `${LEADS(BETA)}?company=${CO.cedar}`);
  await page.waitForSelector(drawerSel(true));
  const cedar = await text(page, drawerSel(true));
  check("company restriction is stated in the drawer", cedar.includes("Company restricted") && cedar.includes("Do not contact this company.") && cedar.includes("Existing partner"));
  await shot(page, "07-suppressed-company-desktop");

  await go(page, `${LEADS(BETA)}?company=${CO.gamma}`);
  check("another organization's company id opens nothing", !(await page.$(drawerSel(true))) && !(await text(page, "main")).includes("Gamma Only Co"));
  await go(page, `${LEADS(BETA)}?company=not-a-uuid`);
  check("malformed company id opens nothing", !(await page.$(drawerSel(true))));
  check("desktop: no horizontal overflow", await noOverflow(page));
  const nav = await page.$$eval("aside nav[aria-label=Primary] a", (els) => els.map((e) => e.textContent.trim()));
  check("canonical navigation unchanged", JSON.stringify(nav) === JSON.stringify(["Today", "Discover", "Leads", "Campaigns", "Settings"]), JSON.stringify(nav));
  await ctx.close();
}

// member: same data, can open drawer
{
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "member.a@example.test");
  await go(page, `${LEADS(BETA)}?company=${CO.northwind}`);
  await page.waitForSelector(drawerSel(true));
  check("a member sees the workspace's companies and the qualification control", (await page.$$("main table tbody tr")).length === 5 && !!(await page.$(`${drawerSel(true)} button::-p-text(Save qualification)`)));
  await ctx.close();
}

// =============================================================================
// Mobile
// =============================================================================
for (const [name, vp] of [["390", VIEW.m390], ["360", VIEW.m360]]) {
  const { ctx, page } = await newPage(vp);
  await login(page, "owner.a@example.test");
  await go(page, LEADS(ALPHA));
  check(`${name}px: empty state, no overflow`, (await text(page, "main")).includes("No companies yet") && (await noOverflow(page)));
  if (name === "390") await shot(page, "08-leads-empty-mobile");

  await go(page, LEADS(BETA));
  const cards = await page.$$("main ul[aria-label=Companies] li a");
  const boxes = await Promise.all(cards.map((c) => c.boundingBox()));
  check(`${name}px: companies render as cards with >=44px targets`, cards.length === 5 && boxes.every((b) => b && b.height >= 44));
  check(`${name}px: populated list has no overflow`, await noOverflow(page));
  if (name === "390") await shot(page, "09-leads-populated-mobile");

  await cards[0].click();
  await page.waitForSelector("dialog[open]");
  await settle(700);
  const m = await page.evaluate(() => {
    const r = document.querySelector("dialog[open]").getBoundingClientRect();
    return { right: r.right, top: r.top, height: r.height, width: r.width, inside: document.querySelector("dialog[open]").contains(document.activeElement) };
  });
  check(`${name}px: drawer is a full-height modal sheet with focus inside`, Math.abs(m.right - vp.width) <= 1 && m.top <= 1 && m.height >= vp.height - 1 && m.inside, JSON.stringify(m));
  check(`${name}px: sheet has no horizontal overflow`, await page.$eval("dialog[open]", (d) => d.scrollWidth <= d.clientWidth + 1));
  if (name === "390") {
    await shot(page, "10-company-detail-mobile");
    await scrollDrawerTo(page, false, "Sources");
    await shot(page, "11-source-evidence-mobile");
  }
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !location.search.includes("company="), { timeout: 30_000 }).catch(() => {});
  await settle(600);
  check(`${name}px: Escape closes the sheet`, !(await page.$("dialog[open]")) && !page.url().includes("company="));
  const bottom = await page.$$eval("nav[aria-label=Primary].fixed a", (els) => els.map((e) => e.textContent.trim()));
  check(`${name}px: bottom navigation unchanged`, bottom.length === 5 && bottom[2] === "Leads");
  await ctx.close();
}

// =============================================================================
const direct = requests.filter((u) => u.includes(":54321"));
check("browser never calls Supabase directly", direct.length === 0, direct.slice(0, 2).join(", "));
check("no other organization's fixture data reached the browser", !bodies.some((b) => b.includes("Gamma Only Co") || b.includes("Gamma Person")));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
