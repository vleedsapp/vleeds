/**
 * UI review for P1-E3 (Discover + Google Places interactive discovery).
 *
 * Uses MOCKED provider responses only (scripts/ui-review/mock-supabase.mjs
 * serves a fake Places API (New) Text Search with fictional places); no real
 * Google quota is consumed. Two phases, each against a fresh mock:
 *
 *   node review-discover.mjs <outDir> unconfigured
 *     server started WITHOUT GOOGLE_PLACES_API_KEY
 *   node review-discover.mjs <outDir> configured
 *     server started with GOOGLE_PLACES_API_KEY=review-only-key and
 *     GOOGLE_PLACES_ENDPOINT=http://127.0.0.1:54321/v1/places:searchText
 *
 * Screenshots 01-12 (+ 00 for the not-configured state).
 */
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "docs/reports/screenshots/P1-E3";
const PHASE = process.argv[3] ?? "configured";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ALPHA = "20000000-0000-4000-a000-00000000000a";
const BETA = "20000000-0000-4000-a000-00000000000b";
const LUMEN = "30000000-0000-4000-a000-000000000002";
const DISCOVER = (ws) => `${BASE}/w/${ws}/discover`;
const VIEW = {
  desktop: { width: 1440, height: 900 },
  m390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  m360: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const SLOW = { timeout: 180_000 };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"], protocolTimeout: 600_000 });
const requests = [];
const bodies = [];
async function newPage(viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(90_000);
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
async function fill(page, sel, value) {
  await page.focus(sel);
  await page.$eval(sel, (e) => e.select());
  await page.keyboard.press("Backspace");
  if (value) await page.type(sel, value);
}
const press = (page, sel) => page.$eval(sel, (b) => b.click());
/** Runs a search and waits until the action finished (button label returns). */
async function search(page, query) {
  await fill(page, "#dc-query", query);
  await press(page, "main form button[type=submit]");
  await settle(300);
  await page.waitForFunction(() => document.querySelector("main form button[type=submit]")?.textContent.includes("Find companies") && !document.querySelector("main form button[type=submit]")?.disabled, SLOW);
  await settle(700);
}
const results$ = "section[aria-labelledby=results-heading]";
/** Clicks a decision button in the visible layout for one candidate. */
async function decide(page, externalId, label) {
  await page.evaluate((id, l) => {
    const rows = [...document.querySelectorAll(`[data-candidate="${id}"]`)].filter((r) => r.getClientRects().length && r.offsetParent !== null);
    const btn = [...rows[0].querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(l));
    btn.click();
  }, externalId, label);
  await page.waitForFunction((id) => ![...document.querySelectorAll(`[data-candidate="${id}"] button`)].some((b) => b.disabled), SLOW, externalId);
  await settle(600);
}
const rowText = (page, externalId) =>
  page.evaluate((id) => [...document.querySelectorAll(`[data-candidate="${id}"]`)].find((r) => r.offsetParent !== null)?.innerText.replace(/\s+/g, " ") ?? "", externalId);
const visibleRows = (page) => page.evaluate(() => [...document.querySelectorAll("[data-candidate]")].filter((r) => r.offsetParent !== null).length);

// =============================================================================
if (PHASE === "unconfigured") {
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "owner.a@example.test");
  await go(page, DISCOVER(BETA));
  const t = await text(page, "main");
  check("without an API key Discover still loads with a calm not-configured state", t.includes("Company discovery is not configured yet") && !(await page.$("#dc-query")));
  check("not-configured state shows no provider attribution or results", !t.includes("Google Maps") && !(await page.$(results$)));
  check("recent activity still renders", t.includes("Recent discovery activity"));
  check("desktop: no overflow", await noOverflow(page));
  await shot(page, "00-discover-not-configured-desktop");
  await page.setViewport(VIEW.m360);
  await go(page, DISCOVER(ALPHA));
  check("360px: not-configured state fits", (await text(page, "main")).includes("not configured yet") && (await noOverflow(page)));
  await ctx.close();
} else {
  // ===========================================================================
  // Desktop
  // ===========================================================================
  {
    const { ctx, page } = await newPage(VIEW.desktop);
    await login(page, "owner.a@example.test");
    await go(page, DISCOVER(BETA));
    const ready = await text(page, "main");
    check("ready state: Find companies form, no search run on load", ready.includes("Find companies") && !(await page.$(results$)) && ready.includes("No searches yet"));
    const icp = await page.$eval("#dc-icp", (s) => ({ value: s.value, text: s.selectedOptions[0]?.textContent }));
    check("default ICP is preselected", icp.text?.includes("Default profile (default)"), JSON.stringify(icp));
    const geos = await page.$$eval("#dc-geo option", (o) => o.map((x) => x.textContent));
    check("ICP geographies are offered first, then other choices", JSON.stringify(geos) === JSON.stringify(["Toronto, Ontario, Canada", "Lyon, France", "Another location…", "No specific location"]), JSON.stringify(geos));
    check("query is prefilled from the ICP and editable; categories offered as suggestions", (await page.$eval("#dc-query", (i) => i.value)) === "Bookkeeping services" && ready.includes("Print shops"));
    check("search controls are labelled", await page.evaluate(() => ["dc-icp", "dc-query", "dc-geo", "dc-size"].every((id) => !!document.querySelector(`label[for=${id}]`))));
    await shot(page, "01-discover-ready-desktop");

    // manual query → results
    await search(page, "print and copy shops");
    const r = await text(page, results$);
    check("search shows results for the typed query and geography", r.includes("“print and copy shops” in Toronto, Ontario, Canada") && (await visibleRows(page)) === 5, r.slice(0, 120));
    const attribution = await page.$eval(`${results$} [translate=no]`, (e) => ({ text: e.textContent, color: getComputedStyle(e).color, ws: getComputedStyle(e).whiteSpace })).catch(() => null);
    check("Google Maps attribution is shown with the results, untranslated and unwrapped", attribution?.text === "Google Maps" && attribution.color === "rgb(94, 94, 94)" && attribution.ws === "nowrap", JSON.stringify(attribution));
    check("third-party attribution from the provider is shown too", r.includes("Example Data Partner"));
    check("columns: company, location, category, Vleeds status, decision", JSON.stringify(await page.$$eval(`${results$} thead th`, (e) => e.map((x) => x.textContent))) === JSON.stringify(["Company", "Location", "Category", "Vleeds status", "Decision"]));
    check("new provider ids show as New reference", (await rowText(page, "mock-place-001")).includes("New reference"));
    const existing = await rowText(page, "mock-place-003");
    const link = await page.$eval(`${results$} tr[data-candidate=mock-place-003] a[href*="company="]`, (a) => a.getAttribute("href")).catch(() => "");
    check("a Place ID linked through durable evidence shows Existing company with a link", existing.includes("Existing company") && link.endsWith(`?company=${LUMEN}`), link);
    check("usage: this search 1 request · 5 candidates; month total shown", r.includes("Google Places · 1 request · 5 candidates") && r.includes("This month"));
    check("ranking explanation is available under About these results", r.includes("About these results") && (await page.$eval(`${results$} details p`, (p) => p.textContent)).includes("relevance, distance and prominence"));
    check("result count is announced", (await text(page, "p[role=status]")).includes("5 companies found"));
    await shot(page, "02-discover-results-desktop");

    await decide(page, "mock-place-001", "Select");
    await decide(page, "mock-place-002", "Dismiss");
    await decide(page, "mock-place-004", "Select");
    check("select on a new reference saves it for enrichment", (await rowText(page, "mock-place-001")).includes("Saved for enrichment"));
    check("dismiss is recorded", (await rowText(page, "mock-place-002")).includes("Dismissed"));
    await decide(page, "mock-place-004", "Undo");
    check("a decision can be undone", (await rowText(page, "mock-place-004")).includes("Select"));
    await shot(page, "03-discover-selected-desktop");

    await decide(page, "mock-place-003", "Select");
    check("selecting an existing company marks it Selected (no duplicate company)", (await rowText(page, "mock-place-003")).includes("Selected"));
    await page.$eval(`${results$} tr[data-candidate=mock-place-003]`, (e) => e.scrollIntoView({ block: "center" }));
    await shot(page, "04-discover-existing-company-desktop");

    // load more
    await press(page, `${results$} button::-p-text(Load more)`);
    await page.waitForFunction(() => [...document.querySelectorAll("tr[data-candidate]")].length === 7, SLOW).catch(() => {});
    await settle(700);
    const more = await text(page, results$);
    check("Load more appends the next provider page", (await visibleRows(page)) === 7 && !more.includes("Load more"));
    check("usage counts both requests", more.includes("2 requests · 7 candidates"), more.match(/This search[^\n]*\n?[^\n]*/)?.[0]);
    await page.$eval(`${results$} dl`, (e) => e.scrollIntoView({ block: "center" }));
    await shot(page, "05-discover-usage-desktop");

    await press(page, `${results$} button::-p-text(Done reviewing)`);
    await page.waitForFunction((s) => !document.querySelector(s), SLOW, results$);
    await settle(1000);
    const hist = await text(page, "section[aria-labelledby=recent-discovery]");
    check("finished search appears in history with counts and status", hist.includes("print and copy shops") && hist.includes("7 references · 2 selected") && hist.includes("Completed"), hist.slice(0, 200));
    check("history shows no provider content (names/addresses are transient)", !hist.includes("Maple Row") && !hist.includes("Sample Street"));

    // no results
    await page.select("#dc-geo", "none");
    await search(page, "zzz-none generic");
    check("no results state", (await text(page, results$)).includes("No companies found"));
    await shot(page, "06-discover-no-results-desktop");

    // quota-style error
    await search(page, "zzz-quota generic");
    check("quota/rate response shows a calm message", (await text(page, `${results$} [role=alert]`)).includes("limiting requests"));

    // provider failure + retry
    await search(page, "zzz-flaky generic");
    const err = await text(page, `${results$} [role=alert]`);
    check("provider failure shows a calm message, no raw details", err.includes("temporarily unavailable") && !/UNAVAILABLE|503|mock/.test(err), err);
    check("a failed search offers Try again", !!(await page.$(`${results$} button::-p-text(Try again)`)));
    await shot(page, "07-discover-provider-error-desktop");
    await press(page, `${results$} button::-p-text(Try again)`);
    await page.waitForFunction(() => [...document.querySelectorAll("tr[data-candidate]")].length > 0, SLOW).catch(() => {});
    await settle(700);
    check("retry runs the search again and shows results", (await visibleRows(page)) === 5);
    check("an id from an earlier search shows Seen before", (await rowText(page, "mock-place-001")).includes("Seen before"));

    await press(page, `${results$} button::-p-text(Cancel search)`);
    await page.waitForFunction((s) => !document.querySelector(s), SLOW, results$);
    await settle(1000);
    const history = await text(page, "section[aria-labelledby=recent-discovery]");
    check("history lists completed, cancelled and failed searches", history.includes("Completed") && history.includes("Cancelled") && history.includes("Failed") && history.includes("Google Places"));
    check("failed searches can be retried from history", !!(await page.$("section[aria-labelledby=recent-discovery] button::-p-text(Retry)")));
    await page.$eval("section[aria-labelledby=recent-discovery]", (e) => e.scrollIntoView({ block: "start" }));
    await shot(page, "08-discover-history-desktop");

    await page.reload({ waitUntil: "networkidle0" });
    await settle(800);
    check("after a reload no provider content is shown from storage", !(await text(page, "main")).includes("Maple Row"));
    check("month usage persists (Vleeds accounting)", /this month: \d+ requests/.test(await text(page, "section[aria-labelledby=recent-discovery]")));
    check("desktop: no horizontal overflow", await noOverflow(page));
    const nav = await page.$$eval("aside nav[aria-label=Primary] a", (els) => els.map((e) => e.textContent.trim()));
    check("canonical navigation unchanged", JSON.stringify(nav) === JSON.stringify(["Today", "Discover", "Leads", "Campaigns", "Settings"]));
    await ctx.close();
  }

  // workspace without an ICP: search still possible with a typed location
  {
    const { ctx, page } = await newPage(VIEW.desktop);
    await login(page, "member.a@example.test");
    await go(page, DISCOVER(ALPHA));
    check("without an ICP the form explains profiles come from Settings", (await text(page, "main")).includes("No profile yet"));
    await page.select("#dc-geo", "custom");
    await page.waitForSelector("#dc-country");
    await page.select("#dc-country", "NZ");
    await fill(page, "#dc-city", "Sample Town");
    await search(page, "generic workshops");
    check("a member can search with a typed location", (await text(page, results$)).includes("in Sample Town, New Zealand") && (await visibleRows(page)) === 5);
    check("another workspace's provider links are not visible (no Existing company here)", !(await rowText(page, "mock-place-003")).includes("Existing company"));
    await ctx.close();
  }

  // ===========================================================================
  // Mobile
  // ===========================================================================
  for (const [name, vp] of [["390", VIEW.m390], ["360", VIEW.m360]]) {
    const { ctx, page } = await newPage(vp);
    await login(page, "owner.a@example.test");
    await go(page, DISCOVER(BETA));
    const btn = await (await page.$("main form button[type=submit]")).boundingBox();
    check(`${name}px: search form fits, button >=44px`, (await noOverflow(page)) && btn.height >= 44);
    if (name === "390") await shot(page, "09-discover-ready-mobile");
    // results must appear without the provider having been called on page load
    check(`${name}px: no search runs on load`, !(await page.$(results$)));
    await search(page, "generic services");
    check(`${name}px: results render as cards`, (await page.$$eval("ul[aria-label='Companies found by this search'] > li", (e) => e.filter((x) => x.offsetParent !== null).length)) === 5);
    const attr = await page.$eval(`${results$} [translate=no]`, (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    check(`${name}px: Google Maps attribution stays visible`, attr);
    check(`${name}px: results have no overflow`, await noOverflow(page));
    const sel = await page.evaluate(() => {
      const li = [...document.querySelectorAll("li[data-candidate]")].find((r) => r.offsetParent !== null);
      return [...li.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().height));
    });
    check(`${name}px: decision buttons are >=44px`, sel.length >= 2 && sel.every((h) => h >= 44), JSON.stringify(sel));
    if (name === "390") {
      await page.$eval(results$, (e) => e.scrollIntoView({ block: "start" }));
      await settle(300);
      await shot(page, "10-discover-results-mobile");
    }
    await decide(page, "mock-place-001", "Select");
    check(`${name}px: select works on a card`, (await rowText(page, "mock-place-001")).includes("Saved for enrichment"));
    if (name === "390") {
      await page.evaluate(() => document.querySelector("li[data-candidate=mock-place-001]")?.scrollIntoView({ block: "center" }));
      await shot(page, "11-discover-selected-mobile");
      await search(page, "zzz-fail generic");
      check("390px: provider error is shown calmly", (await text(page, `${results$} [role=alert]`)).includes("temporarily unavailable"));
      await page.$eval(results$, (e) => e.scrollIntoView({ block: "start" }));
      await shot(page, "12-discover-provider-error-mobile");
    }
    const bottom = await page.$$eval("nav[aria-label=Primary].fixed a", (els) => els.map((e) => e.textContent.trim()));
    check(`${name}px: bottom navigation unchanged`, bottom.length === 5 && bottom[1] === "Discover");
    await ctx.close();
  }
}

// =============================================================================
check("browser never calls Google or Supabase directly", !requests.some((u) => u.includes("googleapis.com") || u.includes(":54321")));
check("the API key never reaches the browser", !bodies.some((b) => b.includes("review-only-key")));
check("no continuation token is rendered into server HTML", !bodies.some((b) => b.startsWith("<!DOCTYPE") && b.includes("mock-page-2")));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
