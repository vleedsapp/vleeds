/**
 * UI review for P1-E5 (decision-maker / contact discovery, Hunter Domain Search).
 *
 * MOCKED provider only (scripts/ui-review/mock-supabase.mjs serves fictional
 * Domain Search answers); no real Hunter credits are consumed. Two phases,
 * each against a fresh mock and the production build:
 *
 *   node review-contacts.mjs <outDir> unconfigured   (server without HUNTER_API_KEY)
 *   node review-contacts.mjs <outDir> configured     (HUNTER_API_KEY=review-only-hunter-key,
 *                                                     HUNTER_API_ENDPOINT=http://127.0.0.1:54321/hunter/v2)
 *
 * Screenshots 01–16 (docs/reports/screenshots/P1-E5/).
 */
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MOCK = "http://127.0.0.1:54321";
const OUT = process.argv[2] ?? "docs/reports/screenshots/P1-E5";
const PHASE = process.argv[3] ?? "configured";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BETA = "20000000-0000-4000-a000-00000000000b";
const GAMMA = "20000000-0000-4000-a000-00000000000c";
const CO = (n) => `30000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const NORTHWIND = CO(1), LUMEN = CO(2), CEDAR = CO(3), BRIGHTWAVE = CO(4), ATLAS = CO(5), GAMMA_CO = CO(9);
const LEADS = (ws, company) => `${BASE}/w/${ws}/leads?company=${company}`;
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
  await settle(800);
}
async function fill(page, sel, value) {
  await page.focus(sel);
  await page.$eval(sel, (e) => e.select());
  await page.keyboard.press("Backspace");
  if (value) await page.type(sel, value);
}

// drawer = desktop <aside> or the mobile <dialog>; the search sheet = the config-sheet dialog
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
async function openSearch(page) {
  await page.evaluate((s) => {
    const d = [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null || e.open);
    [...d.querySelectorAll("button")].find((b) => b.textContent.trim() === "Find decision makers").click();
  }, DRAWER);
  await stage(page, "Search setup");
}
async function closeSheet(page) {
  if ((await submitLabel(page)) === "Done") await submit(page);
  else await press(page, `${SHEET} button[aria-label=Close]`);
  await page.waitForFunction((s) => !document.querySelector(s), SLOW, SHEET);
  await settle(1000);
}
/** Clicks a candidate's button (visible layout) by its label start. */
async function candidate(page, email, label) {
  await page.evaluate((e, l) => {
    const row = [...document.querySelectorAll(`[data-candidate="${e}"]`)].find((r) => r.offsetParent !== null);
    [...row.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(l)).click();
  }, email, label);
  await idle(page);
}
const rowText = (page, email) =>
  page.evaluate((e) => [...document.querySelectorAll(`[data-candidate="${e}"]`)].find((r) => r.offsetParent !== null)?.innerText.replace(/\s+/g, " ") ?? "", email);
const rowButtons = (page, email) =>
  page.evaluate((e) => [...[...document.querySelectorAll(`[data-candidate="${e}"]`)].find((r) => r.offsetParent !== null).querySelectorAll("button")].map((b) => b.textContent.trim()), email);
/** Scrolls the sheet's own scroll area so the element is visible (scrollIntoView would move the fixed dialog on mobile). */
const scrollInSheet = (page, sel) =>
  page.evaluate((s, q) => {
    const el = document.querySelector(`${s} ${q}`);
    const box = el?.closest(".overflow-y-auto");
    if (el && box) box.scrollTop = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 16;
  }, SHEET, sel);
const toggleRole = (page, title) =>
  page.evaluate((s, t) => [...document.querySelectorAll(`${s} fieldset label`)].find((l) => l.textContent.includes(t)).querySelector("input").click(), SHEET, title);
const nw = (n) => `${n}@northwind.example.test`;

// =============================================================================
if (PHASE === "unconfigured") {
  const { ctx, page } = await newPage(VIEW.desktop);
  await login(page, "owner.a@example.test");
  await go(page, LEADS(BETA, NORTHWIND));
  const d = await drawerText(page);
  check("without HUNTER_API_KEY the drawer loads and says contact discovery is not configured", d.includes("Contact discovery is not configured yet.") && !d.includes("Find decision makers"));
  check("company enrichment stays hidden when not configured (P1-E4 unchanged)", !d.includes("Enrich company"));
  check("existing contacts still show", d.includes("Avery Stone"));
  await shot(page, "01-contact-discovery-not-configured-desktop");
  await page.setViewport(VIEW.m360);
  await go(page, LEADS(BETA, NORTHWIND));
  check("360px: not-configured drawer fits", (await drawerText(page)).includes("not configured yet") && (await noOverflow(page)));
  await ctx.close();
} else {
  // ===========================================================================
  // Desktop — Beta workspace (owner)
  // ===========================================================================
  {
    const { ctx, page } = await newPage(VIEW.desktop);
    await login(page, "owner.a@example.test");
    await go(page, LEADS(BETA, ATLAS));
    let d = await drawerText(page);
    check("company without a domain: asks for a domain, no search action", d.includes("Add or enrich this company with a domain before finding contacts.") && !d.includes("Find decision makers"));
    check("…while the existing Enrich company action stays available", d.includes("Enrich company"));
    await go(page, LEADS(BETA, CEDAR));
    d = await drawerText(page);
    check("restricted company: no credit-consuming search; says do not contact", d.includes("This company is marked do not contact.") && !d.includes("Find decision makers"));
    check("owners keep the existing lift-restriction control", d.includes("Lift restriction"));

    await go(page, LEADS(BETA, NORTHWIND));
    check("company with a domain offers Find decision makers", (await drawerText(page)).includes("Find decision makers"));
    await page.evaluate((s) => [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent.trim() === "Find decision makers")?.scrollIntoView({ block: "center" }), DRAWER);
    await shot(page, "02-find-decision-makers-desktop");

    await openSearch(page);
    const setup = await sheetText(page);
    check("setup shows company, domain and the default ICP", setup.includes("Northwind Analytics") && setup.includes("northwind.example.test") && (await page.$eval(`${SHEET} select`, (s) => s.selectedOptions[0].textContent)).includes("Default profile (default)"));
    const roles = await page.$$eval(`${SHEET} fieldset li label`, (ls) => ls.map((l) => ({ t: l.innerText.replace(/\s+/g, " ").trim(), on: l.querySelector("input").checked })));
    check(
      "configured roles are listed in priority order with text priority labels, all preselected",
      JSON.stringify(roles.map((r) => r.t)) ===
        JSON.stringify(["Head of Operations Primary", "Operations Director Primary", "Operations Manager Secondary", "Finance Lead Secondary", "Office Manager Fallback"]) && roles.every((r) => r.on),
      JSON.stringify(roles),
    );
    check("role checkboxes are labelled controls in a fieldset with a legend", (await page.$eval(`${SHEET} fieldset legend`, (l) => l.textContent)) === "Target roles");
    check("decision-maker-only toggle offered, off by default", setup.includes("Only show Hunter-classified decision makers") && !(await page.$eval(`${SHEET} label input[aria-describedby$=dm-hint]`, (i) => i.checked)));
    check("credit estimate shown before the request", setup.includes("Hunter Domain Search") && setup.includes("Up to 10 professional contacts") && setup.includes("Estimated usage: up to 1 credit if results are returned") && (await submitLabel(page)) === "Find decision makers · estimated up to 1 credit");
    check("no remaining balance is claimed", !/remaining|left this month/i.test(setup) && setup.includes("authoritative balance"));
    await toggleRole(page, "Finance Lead");
    await settle(300);
    check("a role can be deselected for this search", (await page.$$eval(`${SHEET} fieldset li input:checked`, (i) => i.length)) === 4);
    await shot(page, "03-contact-search-setup-desktop");

    await submit(page);
    await stage(page, "Review contacts");
    const rows = await page.$$eval(`${SHEET} table tbody tr`, (t) => t.map((r) => r.getAttribute("data-candidate")));
    check("one search shows up to 10 candidates (nameless result skipped and explained)", rows.length === 9 && (await sheetText(page)).includes("1 result was not shown"), JSON.stringify(rows));
    check(
      "order: primary, secondary, fallback, Hunter decision makers, others (provider order within a group)",
      JSON.stringify(rows) === JSON.stringify([nw("avery.stone"), "riley.brandt@lumen.example.test", nw("casey.rowe"), nw("drew.lin"), nw("sam.ortiz"), nw("quinn.hart"), nw("parker.vale"), nw("jordan.pike"), nw("rowan.ellis")]),
      JSON.stringify(rows),
    );
    check("columns as specified", JSON.stringify(await page.$$eval(`${SHEET} thead th`, (e) => e.map((x) => x.textContent))) === JSON.stringify(["Name", "Role", "Role match", "Professional email", "Email status", "Hunter confidence", "Existing status", "Decision"]));
    check("results table has a caption", (await page.$eval(`${SHEET} table caption`, (c) => c.textContent)) === "Professional contacts found by this search");
    const casey = await rowText(page, nw("casey.rowe"));
    check("primary title match + Hunter decision maker + executive, valid email, confidence (text)", casey.includes("Primary title match") && casey.includes("Hunter decision maker") && casey.includes("Executive seniority") && casey.includes("Valid") && casey.includes("Confidence 94"), casey);
    check("secondary match and accept-all email", (await rowText(page, nw("drew.lin"))).includes("Secondary title match") && (await rowText(page, nw("drew.lin"))).includes("Accept-all"));
    check("fallback match and unknown email", (await rowText(page, nw("quinn.hart"))).includes("Fallback title match") && (await rowText(page, nw("quinn.hart"))).includes("Unknown"));
    check("Hunter-classified decision maker without a configured title", (await rowText(page, nw("parker.vale"))).includes("No configured-title match Hunter decision maker"));
    check("deselected role no longer counts as a match", (await rowText(page, nw("jordan.pike"))).includes("No configured-title match"));
    check("search loading/results are announced", (await text(page, `${SHEET} p[role=status]`)).includes("9 contacts found"));
    await shot(page, "04-contact-results-desktop");
    await page.$eval(`${SHEET} tr[data-candidate="${nw("drew.lin")}"]`, (e) => e.scrollIntoView({ block: "center" }));
    await shot(page, "05-contact-role-matches-desktop");

    const avery = await rowText(page, nw("avery.stone"));
    const jordan = await rowText(page, nw("jordan.pike"));
    check("existing email at this company → Existing contact", avery.includes("Existing contact: Avery Stone"));
    check("a restricted existing contact is labelled Restricted", jordan.includes("Existing contact: Jordan Pike") && jordan.includes("Restricted"));
    await page.$eval(`${SHEET} tr[data-candidate="${nw("jordan.pike")}"]`, (e) => e.scrollIntoView({ block: "center" }));
    await shot(page, "06-contact-existing-match-desktop");
    const sam = await rowText(page, nw("sam.ortiz"));
    check("same name, different email → Possible duplicate with an explicit choice", sam.includes("Possible duplicate of Sam Ortiz") && JSON.stringify(await rowButtons(page, nw("sam.ortiz"))).includes("Same person") && !(await rowButtons(page, nw("sam.ortiz"))).some((b) => b.startsWith("Select")));
    const riley = await rowText(page, "riley.brandt@lumen.example.test");
    check("email owned at another company → conflict, no select offered", riley.includes("Contact already belongs to another company (Lumen Field Instruments)") && !(await rowButtons(page, "riley.brandt@lumen.example.test")).some((b) => b.startsWith("Select") || b.startsWith("Same")));
    await page.$eval(`${SHEET} tr[data-candidate="${nw("sam.ortiz")}"]`, (e) => e.scrollIntoView({ block: "center" }));
    await shot(page, "07-contact-possible-duplicate-desktop");

    check("nothing is selected automatically", (await submitLabel(page)) === "Save contacts");
    await candidate(page, nw("casey.rowe"), "Select");
    await candidate(page, nw("drew.lin"), "Select");
    await candidate(page, nw("rowan.ellis"), "Dismiss");
    check("dismiss is recorded", (await rowText(page, nw("rowan.ellis"))).includes("Dismissed"));
    await candidate(page, nw("rowan.ellis"), "Undo");
    check("undo restores the choice", (await rowButtons(page, nw("rowan.ellis"))).some((b) => b.startsWith("Select")));
    await candidate(page, nw("sam.ortiz"), "Same person");
    await candidate(page, nw("avery.stone"), "Select");
    await candidate(page, nw("jordan.pike"), "Select");
    check("selection state is text (Selected / add to existing)", (await rowText(page, nw("sam.ortiz"))).includes("Selected · add to Sam Ortiz") && (await rowText(page, nw("casey.rowe"))).includes("Selected"));
    check("Save shows how many contacts", (await submitLabel(page)) === "Save 5 contacts", await submitLabel(page));
    await shot(page, "08-contact-selected-desktop");

    await submit(page);
    await stage(page, "Contacts saved");
    const res = await sheetText(page);
    check("save result: new + updated contacts, evidence, estimated credits", res.includes("2 new contacts added to Northwind Analytics") && res.includes("3 existing contacts updated") && res.includes("Hunter evidence added") && res.includes("Estimated Hunter credits used: 1"), res);
    check("kept existing values are reported, never overwritten", res.includes("Kept existing job title") || res.includes("Kept contact name") || !res.includes("Kept existing values"));
    await shot(page, "09-contact-save-result-desktop");
    await closeSheet(page);
    await page.reload({ waitUntil: "networkidle0" });
    await settle(800);
    d = await drawerText(page);
    check("saved contacts appear in the drawer's Contacts", d.includes("Casey Rowe") && d.includes("Drew Lin") && d.includes("casey.rowe@northwind.example.test"));
    check("possible duplicate merged into the existing contact: its empty email was filled", d.includes("sam.ortiz@northwind.example.test"));
    check("restricted existing contact remains restricted", d.includes("Contact restricted"));
    check("Hunter evidence appears in Sources", d.includes("API (hunter)"));
    check("drawer shows the last search", d.includes("Last search: 9 contacts found · 5 saved · ICP: Default profile · Completed"));
    check("saved Hunter phone/profile kept on the contact", d.includes("+44 20 7946 0123"));

    // one contact, decision makers only
    await go(page, LEADS(BETA, LUMEN));
    await openSearch(page);
    await press(page, `${SHEET} label input[aria-describedby$=dm-hint]`);
    await submit(page);
    await stage(page, "Review contacts");
    check("decision-maker-only search returns only classified decision makers", (await page.$$eval(`${SHEET} table tbody tr`, (t) => t.length)) === 1 && (await sheetText(page)).includes("Hunter-classified decision makers only"));
    await candidate(page, "noor.field@lumen.example.test", "Select");
    check("Save 1 contact", (await submitLabel(page)) === "Save 1 contact");
    await submit(page);
    await stage(page, "Contacts saved");
    check("one contact saved", (await sheetText(page)).includes("1 new contact added"));
    await closeSheet(page);

    // usage on Discover
    await go(page, `${BASE}/w/${BETA}/discover`);
    const usage = await text(page, "section[aria-labelledby=company-data-heading]");
    check("usage: decision-maker searches with estimated credits, and a total", usage.includes("Decision-maker searches") && usage.includes("2 searches · estimated 2 credits") && usage.includes("Estimated credits: 2"), usage.slice(0, 500));
    check("usage says the Hunter account is authoritative; no plan allowance", usage.includes("authoritative balance") && !/50 credits|remaining/i.test(usage));
    await page.$eval("section[aria-labelledby=company-data-heading]", (e) => e.scrollIntoView({ block: "center" }));
    await shot(page, "10-contact-usage-desktop");
    check("desktop: no horizontal overflow", await noOverflow(page));
    await ctx.close();
  }

  // ===========================================================================
  // Desktop — Gamma (no ICP): typed titles, no results, quota, retry
  // ===========================================================================
  {
    const { ctx, page } = await newPage(VIEW.desktop);
    await login(page, "owner.b@example.test");
    await go(page, LEADS(GAMMA, GAMMA_CO));
    await openSearch(page);
    const s = await sheetText(page);
    check("no ICP roles: titles can be typed for this search, with a pointer to Settings", !!(await page.$(`${SHEET} textarea`)) && s.includes("Configure decision-maker roles in Settings to reuse them automatically"));
    await submit(page);
    await idle(page);
    check("no target roles → calm message, nothing sent", (await text(page, `${SHEET} [role=alert]`)).includes("Choose at least one target role"));
    await fill(page, `${SHEET} textarea`, "zzz-none Workshop Lead");
    await submit(page);
    await stage(page, "No contacts found");
    const empty = await sheetText(page);
    check("no results: explicit alternatives, no automatic second search, no credit", empty.includes("Edit target roles") && empty.includes("Search only Hunter-classified decision makers") && empty.includes("Estimated credits used: 0"));
    await press(page, `${SHEET} button::-p-text(Edit target roles)`);
    await stage(page, "Search setup");
    await fill(page, `${SHEET} textarea`, "zzz-quota Workshop Lead");
    await submit(page);
    await idle(page);
    const q = await text(page, `${SHEET} [role=alert]`);
    check("quota exhaustion: calm message, no raw provider body", q.includes("quota") && !/429|mock|errors/.test(q), q);
    await shot(page, "11-contact-provider-error-desktop");
    await submit(page); // Edit search
    await stage(page, "Search setup");
    await fill(page, `${SHEET} textarea`, "zzz-flaky Workshop Lead");
    await submit(page);
    await idle(page);
    check("temporary failure offers an explicit Try again", (await text(page, `${SHEET} [role=alert]`)).includes("temporarily unavailable") && !!(await page.$(`${SHEET} button::-p-text(Try again)`)));
    await press(page, `${SHEET} button::-p-text(Try again)`);
    await stage(page, "Review contacts");
    check("retry runs the search again (explicitly)", (await page.$$eval(`${SHEET} table tbody tr`, (t) => t.length)) > 0);
    await closeSheet(page);
    await ctx.close();
  }

  // ===========================================================================
  // Mobile
  // ===========================================================================
  for (const [name, vp] of [["390", VIEW.m390], ["360", VIEW.m360]]) {
    const { ctx, page } = await newPage(vp);
    await login(page, "owner.a@example.test");
    await go(page, LEADS(BETA, name === "390" ? BRIGHTWAVE : LUMEN));
    await openSearch(page);
    const labels = await page.$$eval(`${SHEET} fieldset li label`, (ls) => ls.map((l) => Math.round(l.getBoundingClientRect().height)));
    check(`${name}px: target-role selection fits, rows >= 44px`, labels.length === 5 && labels.every((h) => h >= 44) && (await page.$eval(SHEET, (d) => d.scrollWidth <= d.clientWidth + 1)), JSON.stringify(labels));
    if (name === "390") await shot(page, "12-contact-search-mobile");
    await submit(page);
    await stage(page, "Review contacts");
    const layout = await page.evaluate((s) => ({ table: document.querySelector(`${s} table`)?.offsetParent !== null, cards: [...document.querySelectorAll(`${s} ul[aria-label] > li`)].filter((l) => l.offsetParent !== null).length }), SHEET);
    check(`${name}px: candidates become a semantic list of cards`, !layout.table && layout.cards >= 2, JSON.stringify(layout));
    const email = name === "390" ? "tam.reed@brightwave.example.test" : "lee.marsh@lumen.example.test";
    const btns = await page.evaluate((e) => [...[...document.querySelectorAll(`li[data-candidate="${e}"]`)].find((r) => r.offsetParent !== null).querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().height)), email);
    check(`${name}px: selection controls >= 44px`, btns.length >= 2 && btns.every((h) => h >= 44), JSON.stringify(btns));
    check(`${name}px: emails wrap, sheet has no overflow`, await page.$eval(SHEET, (d) => d.scrollWidth <= d.clientWidth + 1));
    if (name === "390") {
      await scrollInSheet(page, "ul[aria-label]");
      await shot(page, "13-contact-results-mobile");
      await candidate(page, email, "Select");
      const save = await page.$eval(`${SHEET} button[type=submit]`, (b) => { const r = b.getBoundingClientRect(); return { h: r.height, bottom: r.bottom }; });
      check("390px: Save stays reachable", save.h >= 44 && save.bottom <= vp.height + 1, JSON.stringify(save));
      await scrollInSheet(page, `li[data-candidate="${email}"]`);
      await shot(page, "14-contact-selected-mobile");
      await submit(page);
      await stage(page, "Contacts saved");
      await shot(page, "15-contact-save-result-mobile");
    }
    await closeSheet(page);
    check(`${name}px: no horizontal overflow`, await noOverflow(page));
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(VIEW.m390);
    await login(page, "owner.b@example.test");
    await go(page, LEADS(GAMMA, GAMMA_CO));
    await openSearch(page);
    await fill(page, `${SHEET} textarea`, "zzz-quota Workshop Lead");
    await submit(page);
    await idle(page);
    check("390px: provider error shown calmly", (await text(page, `${SHEET} [role=alert]`)).includes("quota"));
    await shot(page, "16-contact-error-mobile");
    await closeSheet(page);
    const bottom = await page.$$eval("nav[aria-label=Primary].fixed a", (els) => els.map((e) => e.textContent.trim()));
    check("390px: bottom navigation unchanged", JSON.stringify(bottom) === JSON.stringify(["Today", "Discover", "Leads", "Campaigns", "Settings"]));
    await ctx.close();
  }

  // ===========================================================================
  // Stored data (read back from the mock as the user)
  // ===========================================================================
  {
    const tok = await fetch(`${MOCK}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner.a@example.test", password: "vleeds-dev-password" }),
    }).then((r) => r.json());
    const get = (t) => fetch(`${MOCK}/rest/v1/${t}?select=*`, { headers: { authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
    const cands = await get("contact_discovery_candidates");
    const runs = await get("contact_discovery_runs");
    const stored = JSON.stringify([cands, runs]);
    check("candidates keep no raw payload (no twitter, source URLs, organization/pattern)", cands.length > 0 && !/twitter|pages\.example\.test|Mock Org|\{first\}/.test(stored));
    check("no provider record id is invented", cands.every((c) => c.provider_external_id === null || c.provider_external_id === undefined));
    check("runs record the ICP profile + revision and the titles used", runs.some((r) => r.icp_profile_id && r.icp_revision === 3 && r.selected_titles.length === 4));
    const contacts = await get("contacts");
    check("no duplicate contact was created for the possible duplicate (one Sam Ortiz)", contacts.filter((k) => k.full_name === "Sam Ortiz").length === 1);
    check("the cross-company contact was not moved", contacts.find((k) => k.normalized_email === "riley.brandt@lumen.example.test")?.company_id === "30000000-0000-4000-a000-000000000002");
    const usage = (await get("provider_usage_events")).filter((u) => u.operation === "domain_search");
    check("usage: one domain_search event per search with run, company and estimated credits", usage.length >= 3 && usage.every((u) => u.contact_discovery_run_id && u.company_id && u.provider_key === "hunter") && usage.some((u) => u.estimated_credit_millis === 1000));
  }
}

// =============================================================================
check("browser never calls the provider or Supabase directly", !requests.some((u) => u.includes("hunter") || u.includes(":54321")));
check("the Hunter API key never reaches the browser", !bodies.some((b) => b.includes("review-only-hunter-key") || b.includes("HUNTER_API_KEY")));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
