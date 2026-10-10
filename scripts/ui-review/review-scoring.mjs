/**
 * UI review for P1-E6 (deterministic ICP evaluation + lead scoring).
 *
 * Uses the UI-review mock (scripts/ui-review/mock-supabase.mjs) with a
 * fictional Beta profile (criteria, signals, scoring model). Scores are
 * computed by the app's TypeScript engine on the server; nothing calls a
 * provider. Run against the production build with the Hunter mock configured
 * (used only to show "Outdated" after a company change via Enrich company):
 *
 *   node review-scoring.mjs <outDir>
 *
 * Screenshots 01–16 (docs/reports/screenshots/P1-E6/).
 */
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MOCK = "http://127.0.0.1:54321";
const OUT = process.argv[2] ?? "docs/reports/screenshots/P1-E6";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BETA = "20000000-0000-4000-a000-00000000000b";
const GAMMA = "20000000-0000-4000-a000-00000000000c";
const CO = (n) => `30000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const NORTHWIND = CO(1), LUMEN = CO(2), GAMMA_CO = CO(9);
const BETA_ICP = "50000000-0000-4000-a000-000000000001";
const LEADS = (ws, company, q = "") => `${BASE}/w/${ws}/leads${q}${company ? `${q ? "&" : "?"}company=${company}` : ""}`;
const VIEW = {
  desktop: { width: 1440, height: 900 },
  m390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  m360: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const SLOW = { timeout: 180_000 };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + String(detail).slice(0, 500) : ""}`);
};
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
const press = (page, sel) => page.$eval(sel, (b) => b.click());
async function login(page, email) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", "vleeds-dev-password");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), page.click("button[type=submit]")]);
}
async function go(page, url) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForSelector("main h1");
  await settle(800);
}

const DRAWER = "[aria-labelledby^=company-][aria-labelledby$=-title]";
const SHEET = "dialog[open][aria-labelledby=config-sheet-title]";
const drawerText = (page) => page.evaluate((s) => [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null || e.open)?.innerText ?? "", DRAWER);
const sheetText = (page) => text(page, SHEET);
const submitLabel = (page) => page.$eval(`${SHEET} button[type=submit]`, (b) => b.textContent.trim()).catch(() => "");
async function idle(page) {
  await settle(600);
  await page.waitForFunction((s) => {
    const b = document.querySelector(`${s} button[type=submit]`);
    return b && !b.disabled;
  }, SLOW, SHEET);
  await settle(600);
}
async function stage(page, heading) {
  try {
    await page.waitForFunction((s, h) => [...document.querySelectorAll(`${s} h3`)].some((x) => x.textContent.trim() === h), SLOW, SHEET, heading);
  } catch (e) {
    console.log(`STAGE "${heading}" not reached. Sheet shows:\n${(await sheetText(page)).slice(0, 800)}`);
    throw e;
  }
  await idle(page);
}
const submit = async (page) => {
  await press(page, `${SHEET} button[type=submit]`);
  await settle(300);
};
async function drawerButton(page, label) {
  await page.evaluate((s, l) => {
    const d = [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null || e.open);
    [...d.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(l)).click();
  }, DRAWER, label);
  await settle(800);
  await page.waitForSelector(SHEET);
  await settle(500);
}
async function closeSheet(page) {
  await press(page, `${SHEET} button[aria-label=Close]`);
  await page.waitForFunction((s) => !document.querySelector(s), SLOW, SHEET);
  await settle(1000);
}
const setSignal = (page, name, state) =>
  page.evaluate((s, n, st) => [...document.querySelectorAll(`${s} fieldset[data-signal]`)].find((f) => f.getAttribute("data-signal") === n).querySelector(`input[value=${st}]`).click(), SHEET, name, state);
/** From the result stage to signal review ("Review signals"; an outdated result is recalculated first). */
async function toSignals(page) {
  for (let i = 0; i < 2; i++) {
    const h = await page.$eval(`${SHEET} h3`, (e) => e.textContent.trim()).catch(() => "");
    if (h === "ICP and signal review") break;
    const clicked = await page.evaluate((s) => {
      const b = [...document.querySelectorAll(`${s} button`)].find((x) => x.textContent.trim() === "Review signals");
      b?.click();
      return !!b;
    }, SHEET);
    if (!clicked) {
      await submit(page); // Recalculate fit
      await stage(page, "Evaluation result");
    }
    await settle(400);
  }
  await stage(page, "ICP and signal review");
}
async function evaluate(page) {
  await page.evaluate((s) => document.querySelector(`${s} button[type=submit]`).click(), SHEET);
  await stage(page, "Evaluation result");
}
const scrollInSheet = (page, sel) =>
  page.evaluate((s, q) => {
    const el = document.querySelector(`${s} ${q}`);
    const box = el?.closest(".overflow-y-auto");
    if (el && box) box.scrollTop = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 16;
  }, SHEET, sel);
async function mock(method, pathname, body) {
  const tok = await fetch(`${MOCK}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner.a@example.test", password: "vleeds-dev-password" }) }).then((r) => r.json());
  const r = await fetch(`${MOCK}/rest/v1/${pathname}`, { method, headers: { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json", prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => null);
}
const usageCount = async () => (await mock("GET", "provider_usage_events?select=*")).length;
const rowText = (page, name) => page.evaluate((n) => [...document.querySelectorAll("main table tbody tr")].find((r) => r.innerText.includes(n))?.innerText.replace(/\s+/g, " ") ?? "", name);

// =============================================================================
const usageBefore = await usageCount();
{
  // No ICP configured (Gamma)
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "owner.b@example.test");
  await go(page, LEADS(GAMMA, GAMMA_CO));
  check("no ICP: the drawer says there is no default profile", (await drawerText(page)).includes("No default ideal customer profile."));
  await drawerButton(page, "Evaluate fit");
  await page.waitForFunction((s) => document.querySelector(`${s} [role=alert]`), SLOW, SHEET);
  check("no ICP: evaluating explains how to set one up (no score manufactured)", (await sheetText(page)).includes("Set up an ideal customer profile in Settings to evaluate fit."));
  await closeSheet(page);
  await ctx.close();
}

{
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "owner.a@example.test");
  await go(page, LEADS(BETA, NORTHWIND));
  let d = await drawerText(page);
  check("drawer shows the current default-ICP score: grade, fit, revision, current", d.includes("Grade A · 84 fit") && d.includes("Revision 3") && d.includes("Current"), d.slice(0, 600));
  check("Leads shows the current grade with its fit", (await rowText(page, "Northwind")).includes("84 fit") && !!(await page.$("main table [aria-label='Grade A']")));
  await shot(page, "01-evaluate-fit-desktop");

  await drawerButton(page, "Recalculate fit");
  await stage(page, "Evaluation result");
  await toSignals(page);
  const setup = await sheetText(page);
  check("signal review shows profile, revision, weights and grade thresholds", setup.includes("Default profile · revision 3") && setup.includes("Company fit 40") && setup.includes("A from 75 · B from 50"));
  check("configured signals with effects (weight / penalty / excludes)", setup.includes("Expanding operations") && setup.includes("Weight 60") && setup.includes("If present: −20") && setup.includes("If present: Excludes company"));
  check("signal choices are labelled radio controls in fieldsets", (await page.$$eval(`${SHEET} fieldset[data-signal] input[type=radio]`, (r) => r.length)) === 12 && (await page.$$eval(`${SHEET} fieldset[data-signal] legend`, (l) => l.length)) === 4);
  await setSignal(page, "Expanding operations", "present");
  await setSignal(page, "New office opening", "present");
  await setSignal(page, "Consumer-only business", "absent");
  await setSignal(page, "Uses a competing tool", "absent");
  await settle(300);
  await shot(page, "02-signal-review-desktop");
  await evaluate(page);
  let r = await sheetText(page);
  check("A grade: 80 / 100 fit (industry, size, characteristic, primary decision-maker, buying signals)", r.includes("80") && r.includes("/ 100 fit") && r.includes("Grade A") && r.includes("Current"), r.slice(0, 500));
  check("coverage is separate from fit and explained", r.includes("Coverage 100%") && r.includes("It doesn't change the fit score"));
  check("why: industry, size, characteristic, geography, decision-maker, signals", r.includes("Industry matches “Data analytics”") && r.includes("Employee range 50–200 fits target 10–200") && r.includes("“multi-location” found in company details") && r.includes("outside the target geographies") && r.includes("Primary decision-maker found") && r.includes("“Expanding operations” confirmed"));
  check("evaluation is announced", (await text(page, `${SHEET} p[role=status]`)).includes("grade A, fit 80"));
  await shot(page, "03-score-a-desktop");
  await scrollInSheet(page, "table");
  check("breakdown table: categories, fit %, weights, points (text, not colour)", JSON.stringify(await page.$$eval(`${SHEET} table tbody th`, (t) => t.map((x) => x.textContent))) === JSON.stringify(["Company fit", "Geography", "Decision makers", "Buying signals", "Fit score"]));
  await shot(page, "06-score-breakdown-desktop");

  // Penalty → B
  await toSignals(page);
  await setSignal(page, "Uses a competing tool", "present");
  await evaluate(page);
  r = await sheetText(page);
  check("penalty exclusion subtracts points: 80 − 20 = 60 → grade B", r.includes("Grade B") && r.includes("Exclusion penalty") && r.includes("−20") && r.includes("“Uses a competing tool” present: −20 points"), r.slice(0, 400));
  await shot(page, "04-score-b-desktop");
  await scrollInSheet(page, "table");
  await shot(page, "09-score-penalty-desktop");

  // Hard exclusion → Excluded
  await toSignals(page);
  await setSignal(page, "Consumer-only business", "present");
  await evaluate(page);
  r = await sheetText(page);
  check("hard exclusion: Excluded with its reason, no grade", r.includes("Excluded") && r.includes("Reason: Consumer-only business") && !r.includes("Grade A") && !r.includes("Grade B"));
  await shot(page, "08-score-excluded-desktop");
  await closeSheet(page);
  d = await drawerText(page);
  check("drawer shows Excluded (text) and signals summary", d.includes("Excluded") && d.includes("Signals 4 confirmed · 0 unknown"));
  check("Leads shows Excluded instead of a grade", (await rowText(page, "Northwind")).includes("Excluded"));

  // Signal change without recalculating → Outdated
  await drawerButton(page, "Recalculate fit");
  await stage(page, "Evaluation result");
  await toSignals(page);
  await setSignal(page, "Consumer-only business", "unknown");
  await press(page, `${SHEET} button::-p-text(Save signals only)`);
  await idle(page);
  await closeSheet(page);
  await page.reload({ waitUntil: "networkidle0" });
  await settle(800);
  d = await drawerText(page);
  check("signal change makes the score Outdated (data changed)", d.includes("Outdated") && d.includes("Company, contact or signal data changed"));
  check("Leads never shows an outdated result as current", (await rowText(page, "Northwind")).includes("Outdated"));

  // C grade: Lumen (location outside, no industry, no configured role)
  await go(page, LEADS(BETA, LUMEN));
  await drawerButton(page, "Evaluate fit");
  await stage(page, "ICP and signal review");
  await evaluate(page);
  r = await sheetText(page);
  check("C grade for a weak fit", r.includes("Grade C"), r.slice(0, 300));
  check("missing data is explained and guidance offered (no automatic action)", r.includes("Industry data unavailable") && r.includes("Improve data coverage") && r.includes("Company industry") && r.includes("2 buying-signal observations") && r.includes("Nothing runs automatically"));
  await shot(page, "05-score-c-desktop");
  await scrollInSheet(page, "#improve-coverage");
  await shot(page, "07-score-coverage-desktop");
  const coverageC = Number(r.match(/Coverage (\d+)%/)?.[1]);
  check("thin data → low coverage", coverageC > 0 && coverageC < 50, String(coverageC));
  await closeSheet(page);

  // Contact change (secondary decision-maker) → Outdated → Recalculate → current, higher fit
  await drawerButton(page, "Add contact");
  await page.type(`${SHEET} #ac-full`, "Pat Lane");
  await page.type(`${SHEET} #ac-title`, "Operations Manager");
  await submit(page);
  await page.waitForFunction((s) => !document.querySelector(s), SLOW, SHEET);
  await page.reload({ waitUntil: "networkidle0" });
  await settle(800);
  check("a new decision-maker contact makes the score Outdated", (await drawerText(page)).includes("Outdated"));
  await shot(page, "10-score-outdated-desktop");
  await drawerButton(page, "Recalculate fit");
  await stage(page, "Evaluation result");
  r = await sheetText(page);
  check("the sheet labels the stored result Outdated and offers Recalculate", r.includes("Outdated") && (await submitLabel(page)) === "Recalculate fit");
  await submit(page);
  await stage(page, "Evaluation result");
  r = await sheetText(page);
  check("recalculated: secondary decision-maker counted; current again", r.includes("Secondary decision-maker found") && r.includes("Current"));
  await shot(page, "11-score-recalculated-desktop");
  await closeSheet(page);

  // Company change (Enrich company fills industry/description) → Outdated
  await drawerButton(page, "Enrich company");
  await stage(page, "Identify company");
  await submit(page);
  await stage(page, "Review company data");
  await submit(page);
  await stage(page, "Company updated");
  await submit(page);
  await page.waitForFunction((s) => !document.querySelector(s), SLOW, SHEET);
  await page.reload({ waitUntil: "networkidle0" });
  await settle(800);
  check("a company data change (industry filled) makes the score Outdated", (await drawerText(page)).includes("Outdated"));

  // Alternate ICP and a profile without criteria
  await drawerButton(page, "Recalculate fit");
  await stage(page, "Evaluation result");
  await toSignals(page);
  await page.select(`${SHEET} select`, "50000000-0000-4000-a000-000000000002");
  await stage(page, "ICP and signal review");
  check("an alternate ICP can be chosen", (await sheetText(page)).includes("Second profile · revision 1"));
  await evaluate(page);
  r = await sheetText(page);
  check("alternate ICP: only configured categories count (geography 100 → A at its own thresholds)", r.includes("Grade A") && r.includes("100") && r.includes("Located in target geography Germany"), r.slice(0, 400));
  await toSignals(page);
  await page.select(`${SHEET} select`, "50000000-0000-4000-a000-000000000003");
  await stage(page, "ICP and signal review");
  check("an ICP without evaluable criteria says so and points to Settings", (await sheetText(page)).includes("This ICP does not have enough criteria configured to evaluate companies.") && (await sheetText(page)).includes("Configure the profile in Settings"));
  await closeSheet(page);
  await page.reload({ waitUntil: "networkidle0" });
  await settle(800);
  check("drawer keeps the default-ICP summary and lists other profiles' results", (await drawerText(page)).includes("Second profile"));

  // ICP revision change (owner edits the profile in Settings — simulated through the same API write)
  await mock("PATCH", `icp_profiles?id=eq.${BETA_ICP}`, { ideal_customer: { industries: ["Bookkeeping services", "Print shops", "Data analytics"], companySize: { minEmployees: 10, maxEmployees: 250 }, characteristics: ["multi-location"], keywords: [], notes: "Notes are never scored." } });
  await page.reload({ waitUntil: "networkidle0" });
  await settle(800);
  d = await drawerText(page);
  check("an ICP revision change makes the score Outdated (profile changed)", d.includes("Outdated") && d.includes("The profile changed"));
  await drawerButton(page, "Recalculate fit");
  await stage(page, "Evaluation result");
  await submit(page);
  await stage(page, "Evaluation result");
  check("recalculated against revision 4: current again", (await sheetText(page)).includes("revision 4") && (await sheetText(page)).includes("Current"));
  await closeSheet(page);

  // Leads filters
  await go(page, LEADS(BETA, null, "?grade=C"));
  check("grade filter C runs server-side (filtered heading)", (await text(page, "#companies-heading")).includes("Matching companies"));
  await go(page, LEADS(BETA, null, "?grade=outdated"));
  check("grade filter Outdated lists outdated results only", (await text(page, "main table tbody")).includes("Northwind") && !(await text(page, "main table tbody")).includes("Atlas"));
  await go(page, LEADS(BETA, null, "?grade=none"));
  check("grade filter Not scored", (await text(page, "main table tbody")).includes("Atlas") && !(await text(page, "main table tbody")).includes("Northwind"));
  const options = await page.$$eval("select[name=grade] option", (o) => o.map((x) => x.textContent));
  check("grade filter options", JSON.stringify(options) === JSON.stringify(["Any", "A", "B", "C", "Excluded", "Outdated", "Not scored"]));
  await go(page, LEADS(BETA, null, "?sort=grade"));
  await shot(page, "12-leads-scored-desktop");
  check("desktop: no horizontal overflow", await noOverflow(page));
  await ctx.close();
}

// =============================================================================
// Mobile
for (const [name, vp] of [["390", VIEW.m390], ["360", VIEW.m360]]) {
  const { ctx, page } = await newPage(vp);
  await login(page, "owner.a@example.test");
  await go(page, LEADS(BETA, NORTHWIND));
  await drawerButton(page, "Recalculate fit");
  await stage(page, "Evaluation result");
  await toSignals(page);
  const radios = await page.$$eval(`${SHEET} fieldset[data-signal] label:has(input[type=radio])`, (ls) => ls.map((l) => Math.round(l.getBoundingClientRect().height)));
  check(`${name}px: signal controls fit and are >=44px`, radios.length === 12 && radios.every((h) => h >= 44) && (await page.$eval(SHEET, (d) => d.scrollWidth <= d.clientWidth + 1)), JSON.stringify(radios));
  if (name === "390") await shot(page, "13-evaluate-fit-mobile");
  await setSignal(page, "Consumer-only business", "absent");
  await evaluate(page);
  check(`${name}px: result readable, breakdown fits`, (await sheetText(page)).includes("/ 100 fit") && (await page.$eval(SHEET, (d) => d.scrollWidth <= d.clientWidth + 1)));
  if (name === "390") {
    await shot(page, "14-score-result-mobile");
    await toSignals(page);
    await setSignal(page, "Consumer-only business", "present");
    await evaluate(page);
    check("390px: Excluded shown as text", (await sheetText(page)).includes("Reason: Consumer-only business"));
    await shot(page, "15-score-excluded-mobile");
    await toSignals(page);
    await setSignal(page, "Consumer-only business", "absent");
    await press(page, `${SHEET} button::-p-text(Save signals only)`);
    await idle(page);
    await closeSheet(page);
    await page.reload({ waitUntil: "networkidle0" });
    await settle(800);
    check("390px: Outdated shown in the drawer", (await drawerText(page)).includes("Outdated"));
    await shot(page, "16-score-outdated-mobile");
  } else {
    await closeSheet(page);
  }
  check(`${name}px: no horizontal overflow`, await noOverflow(page));
  const bottom = await page.$$eval("nav[aria-label=Primary].fixed a", (els) => els.map((e) => e.textContent.trim()));
  check(`${name}px: bottom navigation unchanged`, JSON.stringify(bottom) === JSON.stringify(["Today", "Discover", "Leads", "Campaigns", "Settings"]));
  await ctx.close();
}

// =============================================================================
const usageAfter = await usageCount();
check("scoring made no provider calls (usage events only from the one Enrich company step)", usageAfter - usageBefore === 1, `${usageBefore} → ${usageAfter}`);
const stored = await mock("GET", "lead_scores?select=*");
check("stored results carry fingerprint, coverage and explanation; excluded rows have reasons and no grade", stored.filter((s) => ["scored", "excluded"].includes(s.status) && s.explanation).every((s) => /^[0-9a-f]{64}$/.test(s.input_fingerprint) && s.coverage_percent !== null && (s.status !== "excluded" || (s.grade === null && s.exclusion_reasons?.length))));
const companies = await mock("GET", "companies?select=*");
check("qualification and restrictions are never changed by scoring", companies.find((c) => c.id === NORTHWIND)?.qualification_state === "needs_review");
check("browser never calls a provider or Supabase directly", !requests.some((u) => u.includes("hunter") || u.includes("googleapis.com") || u.includes(":54321")));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
