/**
 * UI review for P1-E4 (Hunter company enrichment).
 *
 * Uses MOCKED provider responses only (scripts/ui-review/mock-supabase.mjs
 * serves fictional Hunter API v2-shaped Domain Finder / Company Enrichment
 * answers); no real Hunter credits are consumed. Two phases, each against a
 * fresh mock and the production build:
 *
 *   node review-enrichment.mjs <outDir> unconfigured
 *     server started with the discovery mock but WITHOUT HUNTER_API_KEY
 *   node review-enrichment.mjs <outDir> configured
 *     server started with GOOGLE_PLACES_API_KEY=review-only-key,
 *     GOOGLE_PLACES_ENDPOINT=http://127.0.0.1:54321/v1/places:searchText,
 *     HUNTER_API_KEY=review-only-hunter-key and
 *     HUNTER_API_ENDPOINT=http://127.0.0.1:54321/hunter/v2
 *
 * Screenshots 01–15 (docs/reports/screenshots/P1-E4/).
 */
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MOCK = "http://127.0.0.1:54321";
const OUT = process.argv[2] ?? "docs/reports/screenshots/P1-E4";
const PHASE = process.argv[3] ?? "configured";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ALPHA = "20000000-0000-4000-a000-00000000000a";
const BETA = "20000000-0000-4000-a000-00000000000b";
const LUMEN = "30000000-0000-4000-a000-000000000002";
const CEDAR = "30000000-0000-4000-a000-000000000003";
const DISCOVER = `${BASE}/w/${BETA}/discover`;
const LEADS = `${BASE}/w/${BETA}/leads`;
const VIEW = {
  desktop: { width: 1440, height: 900 },
  m390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  m360: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const SLOW = { timeout: 180_000 };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + String(detail).slice(0, 400) : ""}`);
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
  await settle();
}
async function fill(page, sel, value) {
  await page.focus(sel);
  await page.$eval(sel, (e) => e.select());
  await page.keyboard.press("Backspace");
  if (value) await page.type(sel, value);
}
async function search(page, query) {
  await fill(page, "#dc-query", query);
  await press(page, "main form button[type=submit]");
  await settle(300);
  await page.waitForFunction(() => document.querySelector("main form button[type=submit]")?.textContent.includes("Find companies") && !document.querySelector("main form button[type=submit]")?.disabled, SLOW);
  await settle(700);
}
async function candidateButton(page, externalId, label) {
  await page.evaluate((id, l) => {
    const row = [...document.querySelectorAll(`[data-candidate="${id}"]`)].find((r) => r.offsetParent !== null);
    [...row.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(l)).click();
  }, externalId, label);
  await settle(400);
  await page.waitForFunction((id) => ![...document.querySelectorAll(`[data-candidate="${id}"] button`)].some((b) => b.disabled), SLOW, externalId).catch(() => {});
  await settle(600);
}
const rowText = (page, externalId) =>
  page.evaluate((id) => [...document.querySelectorAll(`[data-candidate="${id}"]`)].find((r) => r.offsetParent !== null)?.innerText.replace(/\s+/g, " ") ?? "", externalId);

// ---- sheet helpers -----------------------------------------------------------
const SHEET = "dialog[open][aria-labelledby=config-sheet-title]";
const sheetText = (page) => text(page, SHEET);
const submitLabel = (page) => page.$eval(`${SHEET} button[type=submit]`, (b) => b.textContent.trim()).catch(() => "");
async function idle(page) {
  await settle(600);
  await page.waitForFunction((s) => {
    const b = document.querySelector(`${s} button[type=submit]`);
    return b && !b.disabled;
  }, SLOW, SHEET);
  await settle(500);
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
const radio = (page, value) => press(page, `${SHEET} input[type=radio][value="${value}"]`);
const alertText = (page) => text(page, `${SHEET} [role=alert]`);
async function closeSheet(page) {
  const label = await submitLabel(page);
  if (label === "Done") await submit(page);
  else await press(page, `${SHEET} button[aria-label=Close]`);
  await page.waitForFunction((s) => !document.querySelector(s), SLOW, SHEET);
  await settle(800);
}
/** Domain stage: enter a domain under "Enter another domain" (or the only field) and enrich. */
async function enrichOther(page, domain) {
  if (await page.$(`${SHEET} input[value=other]`)) await radio(page, "other");
  await settle(200);
  await fill(page, `${SHEET} input[inputmode=url]`, domain);
  await submit(page);
  await idle(page);
}

// =============================================================================
if (PHASE === "unconfigured") {
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "owner.a@example.test");
  await go(page, DISCOVER);
  const t = await text(page, "section[aria-labelledby=company-data-heading]");
  check("without HUNTER_API_KEY Discover loads; Company data says enrichment is not configured", t.includes("Company enrichment is not configured yet") && !t.includes("Enrich a company"));
  check("discovery search stays usable", !!(await page.$("#dc-query")));
  await search(page, "bookkeeping");
  await candidateButton(page, "mock-place-001", "Select");
  check("a selected reference stays saved for enrichment, without a Find company data action", (await rowText(page, "mock-place-001")).includes("Saved for enrichment") && !(await rowText(page, "mock-place-001")).includes("Find company data"));
  await page.$eval("section[aria-labelledby=company-data-heading]", (e) => e.scrollIntoView({ block: "center" }));
  await settle(300);
  await shot(page, "01-enrichment-not-configured-desktop");
  check("desktop: no overflow", await noOverflow(page));
  await go(page, `${LEADS}?company=${CEDAR}`);
  check("company drawer has no Enrich company action when not configured", !(await text(page, "main")).includes("Enrich company"));
  await page.setViewport(VIEW.m360);
  await go(page, DISCOVER);
  check("360px: not-configured state fits", (await text(page, "main")).includes("not configured yet") && (await noOverflow(page)));
  await ctx.close();
} else {
  // ===========================================================================
  // Desktop: discovery reference → domain suggestions → enrichment → create
  // ===========================================================================
  {
    const { ctx, page } = await newPage(VIEW.desktop);
    await login(page, "owner.a@example.test");
    await go(page, DISCOVER);
    const panel = await text(page, "section[aria-labelledby=company-data-heading]");
    check("Company data panel: usage indicator with estimated credits, no hard-coded balance", panel.includes("Hunter this month") && panel.includes("Estimated credits: 0") && !/remaining/i.test(panel), panel.slice(0, 200));
    check("selecting a result never spends credits on its own", panel.includes("Company enrichments: 0"));

    await search(page, "bookkeeping");
    await candidateButton(page, "mock-place-001", "Select");
    check("a selected new reference offers Find company data", (await rowText(page, "mock-place-001")).includes("Find company data"));
    await page.$eval("tr[data-candidate=mock-place-001]", (e) => e.scrollIntoView({ block: "center" }));
    await shot(page, "02-discover-find-company-data-desktop");

    await candidateButton(page, "mock-place-001", "Find company data");
    await stage(page, "Choose domain");
    const s1 = await sheetText(page);
    check("domain suggestions from the transient name (free lookup)", s1.includes("maple-row-bookkeeping.example.test") && s1.includes("maple-row-bookkeeping-group.example.test"), s1.slice(0, 300));
    check("suggestions are semantic radio controls in a labelled group", (await page.$$eval(`${SHEET} fieldset input[type=radio]`, (r) => r.length)) === 3 && (await page.$eval(`${SHEET} fieldset legend`, (l) => l.textContent)) === "Possible domains");
    check("suggestions are attributed to the provider, quietly", s1.includes("Domain suggestions provided by Hunter"));
    check("the credit-bearing action states its estimate", (await submitLabel(page)) === "Enrich company · estimated 0.2 credit", await submitLabel(page));
    check("loading/result is announced", (await text(page, `${SHEET} p[role=status]`)).includes("possible domains found"));
    check("focus stays inside the sheet", await page.evaluate((s) => document.querySelector(s).contains(document.activeElement), SHEET));
    await shot(page, "03-domain-suggestions-desktop");

    await radio(page, "other");
    await settle(300);
    await enrichOther(page, "nodata.example.test");
    const nf = await alertText(page);
    check("404 enrichment shows the calm not-found message (not an app failure)", nf.includes("Hunter couldn't find company data for this domain.") && !/404|mock|errors/.test(nf), nf);
    check("after not-found the user can enter another domain", !!(await page.$(`${SHEET} input[inputmode=url]`)));
    await shot(page, "04-domain-manual-entry-desktop");

    await enrichOther(page, "maple-row-bookkeeping.example.test");
    await stage(page, "Review company data");
    const rv = await sheetText(page);
    check("review shows durable company data and the Vleeds match", rv.includes("Vleeds match: New company") && rv.includes("Office services") && rv.includes("11–50 employees") && rv.includes("Sample City"), rv.slice(0, 400));
    check("review compares named fields (no colour-only meaning)", JSON.stringify(await page.$$eval(`${SHEET} table tbody th`, (e) => e.map((x) => x.textContent))) === JSON.stringify(["Company name", "Domain", "Industry", "Location", "Phone", "Employees", "Description"]));
    check("no personal provider data reaches the browser (site emails, social handles)", !rv.includes("hidden@") && !(await page.content()).includes("hidden@"));
    check("Create is suggested for a new company", await page.$eval(`${SHEET} input[value=create]`, (r) => r.checked));
    await shot(page, "05-company-enrichment-review-desktop");
    await submit(page);
    await stage(page, "Company created");
    const done = await sheetText(page);
    check("result: company created, evidence added, Google reference linked, credits used", done.includes("Hunter evidence added") && done.includes("Discovery reference linked") && done.includes("Estimated Hunter credits used: 0.2"), done);
    await shot(page, "07-company-enrichment-created-desktop");
    await closeSheet(page);
    check("the open search now shows the reference as an existing company", (await rowText(page, "mock-place-001")).includes("Existing company") && (await rowText(page, "mock-place-001")).includes("Selected"));

    // Existing-company match (same domain) → merge with conflicts kept
    await candidateButton(page, "mock-place-002", "Select");
    await candidateButton(page, "mock-place-002", "Find company data");
    await stage(page, "Choose domain");
    await enrichOther(page, "lumen.example.test");
    await stage(page, "Review company data");
    const ex = await sheetText(page);
    check("same domain → Existing company with explanation", ex.includes("Vleeds match: Existing company") && ex.includes("Lumen Field Instruments has the same domain"), ex.slice(0, 300));
    check("Create separately is unavailable and explains why", (await page.$eval(`${SHEET} input[value=create]`, (r) => r.disabled)) && ex.includes("can't be created twice"));
    check("conflicting values are kept (labelled, not colour-only)", ex.includes("Keeps existing") && ex.includes("Will fill"));
    await shot(page, "06-company-enrichment-existing-match-desktop");
    await submit(page);
    await stage(page, "Company updated");
    const merged = await sheetText(page);
    check("merge result reports kept values", merged.includes("Kept company name") && merged.includes("Kept the existing location") && merged.includes("Kept existing employee"), merged);
    await shot(page, "08-company-enrichment-merged-desktop");
    await closeSheet(page);

    // Done reviewing; a later search sees both Place IDs as existing companies.
    await press(page, "section[aria-labelledby=results-heading] button::-p-text(Done reviewing)");
    await page.waitForFunction(() => !document.querySelector("section[aria-labelledby=results-heading]"), SLOW);
    await settle(800);
    await search(page, "bookkeeping again");
    check("Place ID linked by enrichment shows Existing company in a later search", (await rowText(page, "mock-place-001")).includes("Existing company"));
    check("…and the merged reference too, linked to the existing company", (await rowText(page, "mock-place-002")).includes("Existing company") && (await page.$eval("tr[data-candidate=mock-place-002] a[href*='company=']", (a) => a.getAttribute("href"))).endsWith(LUMEN));

    // A reference saved in a finished search can still be enriched (no transient name left)
    await candidateButton(page, "mock-place-004", "Select");
    await press(page, "section[aria-labelledby=results-heading] button::-p-text(Done reviewing)");
    await page.waitForFunction(() => !document.querySelector("section[aria-labelledby=results-heading]"), SLOW);
    await page.reload({ waitUntil: "networkidle0" });
    await settle(800);
    const waiting = await text(page, "section[aria-labelledby=company-data-heading]");
    check("references saved earlier are listed without provider names", waiting.includes("Saved for enrichment (1)") && waiting.includes("bookkeeping again") && !waiting.includes("Northgate"));
    await press(page, "section[aria-labelledby=company-data-heading] li button");
    await stage(page, "Identify company");
    check("a historical reference asks for a name or domain (nothing recovered)", (await sheetText(page)).includes("no longer shown") && (await page.$eval(`${SHEET} input[id$=name]`, (i) => i.value)) === "");
    await radio(page, "domain");
    await settle(200);
    await fill(page, `${SHEET} input[inputmode=url]`, "https://www.northgate-ledger.example.test/about");
    await submit(page);
    await stage(page, "Review company data");
    await submit(page);
    await stage(page, "Company created");
    check("historical reference: created and linked even though its search is finished", (await sheetText(page)).includes("Discovery reference linked"));
    await closeSheet(page);

    // Usage
    await page.reload({ waitUntil: "networkidle0" });
    await settle(800);
    const usage = await text(page, "section[aria-labelledby=company-data-heading]");
    check("usage: domain requests, enrichments and estimated credits (this month)", usage.includes("Domain resolution: 2 requests") && usage.includes("Company enrichments: 3") && usage.includes("Estimated credits: 0.6"), usage.slice(0, 300));
    check("usage explains the provider account is authoritative", usage.includes("account is the authoritative balance"));
    await page.$eval("section[aria-labelledby=company-data-heading]", (e) => e.scrollIntoView({ block: "center" }));
    await shot(page, "09-company-enrichment-usage-desktop");

    // Errors: quota, restricted, no suggestions, transient + retry, skip
    const manual = async (by, value) => {
      await press(page, "section[aria-labelledby=company-data-heading] button::-p-text(Enrich a company)");
      await stage(page, "Identify company");
      await radio(page, by);
      await settle(200);
      await fill(page, by === "domain" ? `${SHEET} input[inputmode=url]` : `${SHEET} input[id$=name]`, value);
      await submit(page);
      await idle(page);
    };
    await manual("domain", "quota.example.test");
    const q = await alertText(page);
    check("quota exhaustion shows a calm quota message", q.includes("quota") && !/429|mock/.test(q), q);
    await shot(page, "10-company-enrichment-provider-error-desktop");
    await closeSheet(page);
    await manual("domain", "restricted.example.test");
    check("a 451 restriction shows a neutral unavailable message", (await alertText(page)).includes("isn't available from the provider"));
    await closeSheet(page);
    await manual("name", "zzz-none company");
    check("no domain suggestions → message and a domain field", (await alertText(page)).includes("No domain suggestions") && !!(await page.$(`${SHEET} input[inputmode=url]`)));
    await closeSheet(page);
    await manual("name", "ab");
    check("company name too short is refused before any request", (await alertText(page)).includes("at least 3 characters"));
    await closeSheet(page);
    await manual("domain", "flaky.example.test");
    check("temporary provider issue offers Try again", (await alertText(page)).includes("temporarily unavailable") && !!(await page.$(`${SHEET} button::-p-text(Try again)`)));
    await press(page, `${SHEET} button::-p-text(Try again)`);
    await stage(page, "Review company data");
    check("retry succeeds", (await sheetText(page)).includes("Vleeds match"));
    await radio(page, "skip");
    await submit(page);
    await stage(page, "Skipped");
    check("skip writes nothing", (await sheetText(page)).includes("Nothing was written to Leads"));
    await closeSheet(page);
    check("desktop: no horizontal overflow", await noOverflow(page));
    await ctx.close();
  }

  // ===========================================================================
  // Existing company → Enrich company (company drawer)
  // ===========================================================================
  {
    const { ctx, page } = await newPage(VIEW.desktop);
    await login(page, "member.a@example.test");
    await go(page, `${LEADS}?company=${CEDAR}`);
    check("company drawer offers Enrich company when configured", !!(await page.$("aside button::-p-text(Enrich company)")));
    await press(page, "aside button::-p-text(Enrich company)");
    await stage(page, "Identify company");
    check("the company's domain is prefilled; enrichment needs an explicit click", (await page.$eval(`${SHEET} input[inputmode=url]`, (i) => i.value)) === "cedarpoint.example.test" && (await submitLabel(page)).startsWith("Enrich company · estimated 0.2"));
    await submit(page);
    await stage(page, "Review company data");
    const r = await sheetText(page);
    check("existing company: intended match known, shows which fields will fill", r.includes("Enriching Cedar Point Studio") && r.includes("Will fill") && (await submitLabel(page)) === "Save enrichment");
    check("existing company: Create is not offered", !(await page.$(`${SHEET} input[value=create]:not([disabled])`)));
    await shot(page, "11-existing-company-enrich-desktop");
    await submit(page);
    await stage(page, "Company updated");
    await closeSheet(page);
    await page.reload({ waitUntil: "networkidle0" });
    await settle(800);
    const drawer = await text(page, "aside[aria-labelledby^=company-]");
    check("drawer shows the filled industry/description and Hunter evidence", drawer.includes("Office services") && drawer.includes("Fictional company record") && drawer.includes("(hunter)"), drawer.slice(0, 400));
    await ctx.close();
  }

  // ===========================================================================
  // Mobile
  // ===========================================================================
  for (const [name, vp] of [["390", VIEW.m390], ["360", VIEW.m360]]) {
    const { ctx, page } = await newPage(vp);
    await login(page, "owner.a@example.test");
    // 360px runs in another workspace of the same organization (fresh references, no links yet).
    await go(page, name === "390" ? DISCOVER : `${BASE}/w/${ALPHA}/discover`);
    const cand = name === "390" ? "mock-place-005" : "mock-place-001";
    await search(page, "mobile bookkeeping " + name);
    await candidateButton(page, cand, "Select");
    const btn = await page.evaluate((c) => {
      const li = [...document.querySelectorAll(`li[data-candidate=${c}]`)].find((r) => r.offsetParent !== null);
      return [...li.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().height));
    }, cand);
    check(`${name}px: Find company data and decision buttons are >=44px`, btn.length >= 2 && btn.every((h) => h >= 44), JSON.stringify(btn));
    await candidateButton(page, cand, "Find company data");
    await stage(page, "Choose domain");
    const radios = await page.$$eval(`${SHEET} fieldset label`, (ls) => ls.map((l) => Math.round(l.getBoundingClientRect().height)));
    check(`${name}px: domain choices fit and are >=44px`, radios.every((h) => h >= 44) && (await noOverflow(page)), JSON.stringify(radios));
    const sheetFits = await page.$eval(SHEET, (d) => d.scrollWidth <= d.clientWidth + 1);
    check(`${name}px: sheet has no horizontal overflow`, sheetFits);
    if (name === "390") await shot(page, "12-domain-suggestions-mobile");
    await submit(page);
    await stage(page, "Review company data");
    const stacked = await page.evaluate((s) => {
      const table = document.querySelector(`${s} table`);
      const dl = document.querySelector(`${s} dl`);
      return !!table && table.offsetParent === null && !!dl && dl.offsetParent !== null;
    }, SHEET);
    check(`${name}px: company review is stacked (no table)`, stacked);
    const save = await page.$eval(`${SHEET} button[type=submit]`, (b) => { const r = b.getBoundingClientRect(); return { height: r.height, bottom: r.bottom }; });
    check(`${name}px: Create/Merge/Skip and Save remain reachable`, save.height >= 44 && save.bottom <= vp.height + 1 && (await page.$$(`${SHEET} input[name$=decision]`)).length >= 2, JSON.stringify(save));
    if (name === "390") {
      await shot(page, "13-company-enrichment-review-mobile");
      await submit(page);
      await stage(page, "Company created");
      await shot(page, "14-company-enrichment-result-mobile");
      await closeSheet(page);
      await page.$eval("section[aria-labelledby=company-data-heading]", (e) => e.scrollIntoView({ block: "start" }));
      await press(page, "section[aria-labelledby=company-data-heading] button::-p-text(Enrich a company)");
      await stage(page, "Identify company");
      await radio(page, "domain");
      await settle(200);
      await fill(page, `${SHEET} input[inputmode=url]`, "quota.example.test");
      await submit(page);
      await idle(page);
      check("390px: provider error is shown calmly", (await alertText(page)).includes("quota"));
      await shot(page, "15-company-enrichment-error-mobile");
    }
    await closeSheet(page);
    check(`${name}px: no horizontal overflow`, await noOverflow(page));
    const bottom = await page.$$eval("nav[aria-label=Primary].fixed a", (els) => els.map((e) => e.textContent.trim()));
    check(`${name}px: bottom navigation unchanged`, JSON.stringify(bottom) === JSON.stringify(["Today", "Discover", "Leads", "Campaigns", "Settings"]), JSON.stringify(bottom));
    await ctx.close();
  }

  // ===========================================================================
  // Stored data: Google transient content never persisted (read back from the mock as the user)
  // ===========================================================================
  {
    const tok = await fetch(`${MOCK}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner.a@example.test", password: "vleeds-dev-password" }),
    }).then((r) => r.json());
    const get = (t) => fetch(`${MOCK}/rest/v1/${t}?select=*`, { headers: { authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
    const runs = await get("company_enrichment_runs");
    const stored = JSON.stringify([runs, await get("company_enrichment_results"), await get("lead_sources")]);
    check("discovery-reference runs store no name (transient Google content never persisted)", runs.filter((r) => r.input_kind === "discovery_reference").every((r) => r.manual_company_name === null) && runs.some((r) => r.input_kind === "discovery_reference"));
    // The mock enrichment provider derives its (durable) names from the domain, e.g. "Maple Row Bookkeeping Ltd";
    // what must never appear is the exact transient Google display name, address or category.
    const googleNames = ["Maple Row Bookkeeping", "Brightline Print Studio", "Copperleaf Office Supply", "Northgate Ledger Services"];
    check(
      "no Google names/addresses/categories in runs, results or evidence",
      !googleNames.some((n) => stored.includes(`"${n}"`)) && !/Sample Street|Example Avenue|Fixture Court|Demo Lane|print_shop|"accounting"/.test(stored),
    );
    check("Google identity evidence holds the Place ID only", JSON.parse(stored)[2].filter((e) => e.provider_key === "google_places" && e.external_record_id === "mock-place-001").every((e) => e.observed_value === null && e.field_key === "company.provider_reference"));
    check("no raw payload or personal email stored", !/hidden@|someone@|trafficRank|linkedin/.test(stored));
  }
}

// =============================================================================
check("browser never calls the provider or Supabase directly", !requests.some((u) => u.includes("hunter") || u.includes("googleapis.com") || u.includes(":54321")));
check("the Hunter API key never reaches the browser", !bodies.some((b) => b.includes("review-only-hunter-key") || b.includes("HUNTER_API_KEY")));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
