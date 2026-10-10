/**
 * UI review for P1-E7 (Today queue + manual contact workflow).
 *
 * Uses the UI-review mock started with MOCK_TODAY=1 (fictional Beta Today
 * fixtures) and the production build started with the review-only trusted
 * writer key:
 *
 *   SUPABASE_SERVICE_ROLE_KEY=review-only-service-role-key-not-a-secret next start
 *   node review-today.mjs <outDir>
 *
 * No provider is called. Opening a sheet, copying a number or a tel: link
 * never records an attempt; only a submitted outcome does.
 * Screenshots 01–18 (docs/reports/screenshots/P1-E7/).
 */
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MOCK = "http://127.0.0.1:54321";
const OUT = process.argv[2] ?? "docs/reports/screenshots/P1-E7";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ALPHA = "20000000-0000-4000-a000-00000000000a";
const BETA = "20000000-0000-4000-a000-00000000000b";
const T = (n) => `31000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const K = (n) => `41000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const TASK = (n) => `91000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const NORTHWIND = "30000000-0000-4000-a000-000000000001";
const TODAY = (ws = BETA) => `${BASE}/w/${ws}/today`;
const LEADS = (company) => `${BASE}/w/${BETA}/leads?company=${company}`;
const VIEW = {
  desktop: { width: 1440, height: 900 },
  m390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  m360: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const SLOW = { timeout: 180_000 };
const SHEET = "dialog[open][aria-labelledby=config-sheet-title]";
const DRAWER = "[aria-labelledby^=company-][aria-labelledby$=-title]";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + String(detail).slice(0, 600) : ""}`);
};
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"], protocolTimeout: 600_000 });
const requests = [];
async function newPage(viewport) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
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
const state = async () => (await fetch(`${MOCK}/__review/workflow`)).json();
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

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
const mainText = (page) => page.$eval("main", (e) => e.innerText).catch(() => "");
const sheetText = (page) => page.$eval(SHEET, (e) => e.innerText).catch(() => "");
const summary = (page) => page.$$eval('ul[aria-label="Today summary"] > li', (lis) => lis.map((li) => Number((li.innerText.match(/\d+/) ?? ["-1"])[0])));
/** Clicks the first VISIBLE element matching a predicate over buttons/links. */
async function clickWhere(page, { label, text, scope = "body", tag = "button, a" }) {
  const ok = await page.evaluate(
    (scope, tag, label, text) => {
      const root = [...document.querySelectorAll(scope)].find((e) => e.offsetParent !== null || e.open) ?? document;
      const el = [...root.querySelectorAll(tag)].find(
        (b) => (b.offsetParent !== null || b.getClientRects().length) && (label ? b.getAttribute("aria-label") === label : b.textContent.trim().startsWith(text)),
      );
      el?.click();
      return !!el;
    },
    scope,
    tag,
    label ?? null,
    text ?? null,
  );
  if (!ok) throw new Error(`not found: ${label ?? text} in ${scope}`);
  await settle(700);
}
const tab = async (page, name) => {
  await clickWhere(page, { text: name, tag: "[role=tab]" });
  await settle(500);
};
async function openContact(page, label) {
  await clickWhere(page, { label });
  await page.waitForSelector(SHEET);
  await page.waitForFunction((s) => /What happened\?|No contact attempt can be logged|no longer available/.test(document.querySelector(s)?.innerText ?? ""), SLOW, SHEET);
  await settle(500);
}
const choose = (page, label) =>
  page.evaluate((s, l) => [...document.querySelector(s).querySelectorAll("label")].find((x) => x.textContent.trim().startsWith(l)).querySelector("input").click(), SHEET, label);
/** Sets a React-controlled input/textarea/select value. */
const setValue = (page, labelText, value) =>
  page.evaluate(
    (s, l, v) => {
      const sheet = document.querySelector(s);
      const label = [...sheet.querySelectorAll("label")].find((x) => x.textContent.trim().startsWith(l) && x.htmlFor);
      const el = sheet.querySelector(`#${CSS.escape(label.htmlFor)}`);
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    },
    SHEET,
    labelText,
    value,
  );
async function submit(page) {
  await page.$eval(`${SHEET} button[type=submit]`, (b) => b.click());
  await settle(600);
}
async function waitSheet(page, re) {
  try {
    await page.waitForFunction((s, r) => new RegExp(r).test(document.querySelector(s)?.innerText ?? ""), SLOW, SHEET, re.source);
  } catch (e) {
    console.log(`WAIT ${re} failed. Sheet shows:\n${(await sheetText(page)).slice(0, 1200)}`);
    throw e;
  }
  await settle(400);
}
async function closeSheet(page) {
  await page.$eval(`${SHEET} button[aria-label=Close]`, (b) => b.click());
  await settle(400);
  // A dirty sheet asks first.
  const discard = await page.evaluate((s) => {
    const b = [...(document.querySelector(s)?.querySelectorAll("button") ?? [])].find((x) => x.textContent.trim() === "Discard changes");
    b?.click();
    return !!b;
  }, SHEET);
  if (discard) await settle(400);
  await page.waitForFunction((s) => !document.querySelector(s), SLOW, SHEET);
  await settle(800);
}
async function done(page) {
  await submit(page); // "Done"
  await page.waitForFunction((s) => !document.querySelector(s), SLOW, SHEET);
  await settle(1500);
}

const owner = await newPage(VIEW.desktop);
const page = owner.page;
await login(page, "owner.a@example.test");

// ---------------------------------------------------------------------------
// Today with real data
// ---------------------------------------------------------------------------
await go(page, TODAY());
let main = await mainText(page);
check("Today renders real data with the workspace time zone", /Today/.test(main) && /Times in UTC/.test(main), main.slice(0, 300));
check("summary: 4 ready, 2 callbacks due, 1 follow-up due, 0 contacted today", JSON.stringify(await summary(page)) === "[4,2,1,0]", JSON.stringify(await summary(page)));
const initialTab = await page.$eval("[role=tab][aria-selected=true]", (e) => e.textContent.trim());
check("Today opens on due work first (callbacks are due)", initialTab.startsWith("Callbacks (2)"), initialTab);
await shot(page, "01-today-desktop");

await tab(page, "Callbacks");
const callbacks = await page.$eval('ul[aria-label="Callbacks due"]', (e) => e.innerText);
check("callbacks: overdue first, then later today", /Overdue[\s\S]*Willow Creek Services[\s\S]*Later today[\s\S]*Harbor Line Logistics/.test(callbacks), callbacks);
check("due card shows time, kind, company, contact, title, phone and note", /Callback · Yesterday · \d\d:\d\d/.test(callbacks) && /Pat Rivers/.test(callbacks) && /Operations Manager/.test(callbacks) && /\+1 416 555 0701/.test(callbacks) && /planning meeting/.test(callbacks), callbacks);
check("status is text, not colour alone (Overdue / Later today labels)", /Overdue/.test(callbacks) && /Later today/.test(callbacks));
await shot(page, "04-today-overdue-desktop");
await tab(page, "Follow-ups");
const followUps = await page.$eval('ul[aria-label="Follow-ups due"]', (e) => e.innerText);
check("follow-ups: the due follow-up (Due now), blocked retry not listed as actionable", /Due now/.test(followUps) && /Morgan Ash/.test(followUps) && !/Sky Vale/.test(followUps), followUps);
await shot(page, "03-today-due-desktop");

await tab(page, "Lead Queue");
const ready = await page.$eval('table caption', (c) => c.closest("table").innerText);
const order = ["Harbor Line Logistics", "Juniper Analytics", "Maple Office Supply", "Willow Creek Services"].map((n) => ready.indexOf(n));
check("Ready: A before B, fit descending (Harbor 88, Juniper 79, Maple 62, Willow 58)", order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), ready);
check("Ready A and B rows with grade, fit and Call", /Grade A/.test(await page.$eval("table", (t) => t.innerHTML)) && /88/.test(ready) && /62/.test(ready));
check("C, Outdated, Excluded and needs-review companies are not Ready", !/Slate Ridge|Orchid Data|Northwind|Quarry Point/.test(ready));
check("recommended contact: primary role first; contact with an open task skipped (Robin over Casey)", /Robin Hale/.test(ready) && !/Casey Fox/.test(ready));
check("recommended contact falls back to the next eligible contact (Willow → Lou Brandt)", /Lou Brandt/.test(ready) && !/Pat Rivers/.test(ready));
check("last contact context: Never contacted / Yesterday · No answer", /Never contacted/.test(ready) && /Yesterday · \d\d:\d\d · No answer/.test(ready), ready);
check("Showing 4 of 4 leads + View all Leads", /Showing 4 of 4 leads/.test(main = await mainText(page)) && /View all Leads/.test(main));
await shot(page, "02-today-ready-desktop");

const attention = await page.$eval("section[aria-labelledby=attention-title]", (e) => e.innerText).catch(() => "");
check("Needs attention: outdated score, A/B company without a callable contact, blocked task with reason", /1 outdated score/.test(attention) && /Quarry Point Studio/.test(attention) && /Blocked retry call/.test(attention) && /Contact is restricted/.test(attention), attention);
await page.$eval("section[aria-labelledby=attention-title]", (e) => e.scrollIntoView({ block: "center" }));
await settle(300);
await shot(page, "12-needs-attention-desktop");
await page.evaluate(() => window.scrollTo(0, 0));
check("Refresh lead scores offered with the pending count", /5 leads need evaluation/.test(await mainText(page)), (await mainText(page)).slice(0, 400));

// Mobile Today on the fresh fixture data (the later mobile checks run after the flows).
{
  const m0 = await newPage(VIEW.m390);
  await login(m0.page, "owner.a@example.test");
  await go(m0.page, TODAY());
  await m0.page.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent.startsWith("Lead Queue")).click());
  await settle(600);
  await shot(m0.page, "13-today-mobile");
  await m0.ctx.close();
}

// The trusted writer can't be reached with a user session (mock mirrors the DB grant).
{
  const fakeUserJwt = [Buffer.from('{"alg":"HS256"}').toString("base64url"), Buffer.from(JSON.stringify({ sub: "00000000-0000-4000-a000-00000000000a", role: "authenticated" })).toString("base64url"), "x"].join(".");
  const r = await fetch(`${MOCK}/rest/v1/rpc/save_lead_score_trusted`, { method: "POST", headers: { "content-type": "application/json", apikey: "publishable", authorization: `Bearer ${fakeUserJwt}` }, body: JSON.stringify({ p_actor_user_id: "00000000-0000-4000-a000-00000000000a", p_workspace_id: BETA }) });
  check("a member's session cannot call the trusted score writer", r.status === 401 || r.status === 403, r.status);
}

// ---------------------------------------------------------------------------
// Start contact → copy number (no attempt) → No answer + retry
// ---------------------------------------------------------------------------
await openContact(page, "Call Robin Hale at Harbor Line Logistics");
let sheet = await sheetText(page);
check("Start contact shows company, grade + fit, contact, title, phone, last attempt", /Harbor Line Logistics · Grade A · 88 fit/.test(sheet) && /Robin Hale · Operations Director/.test(sheet) && /\+1 416 555 0101/.test(sheet) && /Never contacted/.test(sheet), sheet);
const tel = await page.$eval(`${SHEET} a[href^="tel:"]`, (a) => a.getAttribute("href")).catch(() => null);
check("Call on device is a plain tel: link (the user's own phone)", tel === "tel:+14165550101", tel);
await shot(page, "05-start-contact-desktop");
await clickWhere(page, { text: "Copy number", scope: SHEET });
await settle(500);
check("Copy number confirms and states nothing is recorded", /Number copied|Couldn't copy/.test(await sheetText(page)) && /Nothing is recorded until you save an outcome/.test(await sheetText(page)));
check("no false attempt after opening, copying or showing the tel: link", (await state()).attempts.length === 1); // only the fixture's attempt from yesterday
await choose(page, "No answer");
await settle(300);
await page.evaluate((s) => [...document.querySelector(s).querySelectorAll("label")].find((l) => l.textContent.trim() === "Schedule another attempt").querySelector("input").click(), SHEET);
await settle(300);
sheet = await sheetText(page);
check("dispositions are labelled radios with product labels", (await page.$$eval(`${SHEET} input[type=radio]`, (r) => r.length)) === 9 && /Connected — not interested/.test(sheet) && !/no_answer/.test(sheet));
check("retry shows date/time fields with time-zone context", /Next attempt date/.test(sheet) && /Time zone: UTC/.test(sheet), sheet);
await setValue(page, "Next attempt date", isoDate(1));
await setValue(page, "Next attempt time", "10:00");
await shot(page, "06-log-outcome-desktop");
await submit(page);
await waitSheet(page, /Saved: No answer/);
check("No answer + retry saved; the retry is scheduled", /Retry call scheduled for Tomorrow · 10:00/.test(await sheetText(page)), await sheetText(page));
await done(page);
await go(page, TODAY());
let s = await state();
check("one attempt recorded (by the user) with a retry task from it", s.attempts.filter((a) => a.contact_id === K(1)).length === 1 && s.tasks.some((t) => t.contact_id === K(1) && t.kind === "retry_call" && t.status === "open"));
check("after the attempt: Harbor leaves Ready, Contacted today = 1", JSON.stringify((await summary(page)).slice(0, 1).concat((await summary(page)).slice(3))) === "[3,1]", JSON.stringify(await summary(page)));
await tab(page, "Lead Queue");
check("Ready no longer lists the contacted company for today", !/Harbor Line Logistics/.test(await page.$eval("table", (t) => t.innerText).catch(() => "")));
await tab(page, "Contacted today");
const contacted = await page.$eval('ul[aria-label="Contacted today"]', (e) => e.innerText).catch(() => "");
check("Contacted today lists the attempt with outcome and who", /Robin Hale/.test(contacted) && /No answer/.test(contacted) && /by you/.test(contacted), contacted);
await shot(page, "09-today-after-attempt-desktop");

// Left voicemail (no retry) → Interested + follow-up → Wrong number
await tab(page, "Lead Queue");
await openContact(page, "Call Drew Lane at Juniper Analytics");
check("last attempt shown in the sheet", /Yesterday · \d\d:\d\d · No answer/.test(await sheetText(page)));
await choose(page, "Left voicemail");
await submit(page);
await waitSheet(page, /Saved: Left voicemail/);
await done(page);
await go(page, TODAY());
await tab(page, "Lead Queue");
await openContact(page, "Call Jamie Cole at Maple Office Supply");
await choose(page, "Connected — interested");
await page.evaluate((s) => [...document.querySelector(s).querySelectorAll("label")].find((l) => l.textContent.trim() === "Schedule follow-up").querySelector("input").click(), SHEET);
await settle(300);
await setValue(page, "Follow-up date", isoDate(2));
await setValue(page, "Follow-up time", "09:30");
await submit(page);
await waitSheet(page, /Saved: Connected — interested/);
check("Interested + follow-up scheduled", /Follow-up scheduled for/.test(await sheetText(page)));
await done(page);
s = await state();
check("Interested did not change qualification (Maple stays unreviewed)", s.qualification.find((q) => q.id === T(3))?.q === "unreviewed");
await go(page, TODAY());
await tab(page, "Lead Queue");
await openContact(page, "Call Lou Brandt at Willow Creek Services");
await choose(page, "Wrong number");
await submit(page);
await waitSheet(page, /Saved: Wrong number/);
check("Wrong number: try another contact hint; number kept; nothing restricted", /Try another contact at this company if one is available/.test(await sheetText(page)) && !(await state()).suppressions.some((r) => r.contact_id === K(11)));
await done(page);

// ---------------------------------------------------------------------------
// Due work: Callback requested (required time) from an overdue callback; Follow-up needed
// ---------------------------------------------------------------------------
await go(page, TODAY());
await tab(page, "Callbacks");
await openContact(page, "Call Pat Rivers for this callback");
check("the due task is shown in the sheet", /Due task[\s\S]*Callback · Yesterday · \d\d:\d\d · Overdue/.test(await sheetText(page)), await sheetText(page));
await choose(page, "Callback requested");
await submit(page);
await settle(800);
check("Callback requested needs a date and time (error announced)", /Choose the callback date and time/.test(await page.$eval(`${SHEET} [role=alert]`, (e) => e.innerText).catch(() => "")));
await setValue(page, "Callback date", isoDate(1));
await setValue(page, "Callback time", "14:00");
await setValue(page, "Callback note", "Wants the summary first");
await shot(page, "07-callback-requested-desktop");
await submit(page);
await waitSheet(page, /Saved: Callback requested/);
check("callback saved: source task completed, new callback scheduled", /The task is complete\./.test(await sheetText(page)) && /Callback scheduled for Tomorrow · 14:00/.test(await sheetText(page)));
await done(page);
s = await state();
check("source task completed; new open callback from the attempt", s.tasks.find((t) => t.id === TASK(1))?.status === "completed" && s.tasks.some((t) => t.contact_id === K(10) && t.kind === "callback" && t.status === "open"));
check("the attempt references its source task", s.attempts.some((a) => a.contact_id === K(10) && a.source_task_id === TASK(1)));
await go(page, TODAY());
check("the completed overdue callback leaves the due list (new one is for tomorrow)", !/Overdue/.test((await page.$eval('ul[aria-label="Callbacks due"]', (e) => e.innerText).catch(() => ""))));
await tab(page, "Follow-ups");
await openContact(page, "Call Morgan Ash for this follow-up");
await choose(page, "Follow-up needed");
await setValue(page, "Follow-up date", isoDate(3));
await setValue(page, "Follow-up time", "11:15");
await submit(page);
await waitSheet(page, /Saved: Follow-up needed/);
await shot(page, "08-follow-up-scheduled-desktop");
await done(page);
s = await state();
check("follow-up needed: source completed, new follow-up open", s.tasks.find((t) => t.id === TASK(3))?.status === "completed" && s.tasks.some((t) => t.contact_id === K(4) && t.kind === "follow_up" && t.status === "open"));

// Complete without an attempt (Casey's later-today callback) and cancel the blocked task
await go(page, TODAY());
await tab(page, "Callbacks");
const attemptsBefore = (await state()).attempts.length;
await clickWhere(page, { label: "Complete callback for Casey Fox" });
await page.waitForSelector(SHEET);
check("Complete explains no attempt is recorded", /No contact attempt is recorded/.test(await sheetText(page)));
await submit(page);
await waitSheet(page, /Task completed\. No contact attempt was recorded\./);
await done(page);
s = await state();
check("complete without attempt: task completed, attempts unchanged", s.tasks.find((t) => t.id === TASK(2))?.status === "completed" && s.attempts.length === attemptsBefore);
await go(page, TODAY());
await clickWhere(page, { label: "Cancel retry call for Sky Vale" });
await page.waitForSelector(SHEET);
await submit(page);
await waitSheet(page, /Task cancelled\./);
await done(page);
check("blocked task cancelled (history kept)", (await state()).tasks.find((t) => t.id === TASK(4))?.status === "cancelled");

// ---------------------------------------------------------------------------
// Drawer: Activity, reschedule, schedule, not interested, do not contact
// ---------------------------------------------------------------------------
await go(page, LEADS(T(1)));
let drawer = await page.$eval(DRAWER, (e) => e.innerText);
check("drawer: per-contact last contact and next action", /Last contact: Today · \d\d:\d\d · No answer/.test(drawer) && /Next: Retry call · Tomorrow · 10:00/.test(drawer), drawer.slice(0, 1500));
const retry = (await state()).tasks.find((t) => t.contact_id === K(1) && t.status === "open");
await clickWhere(page, { label: "Reschedule retry call for Robin Hale" });
await page.waitForSelector(SHEET);
await setValue(page, "New date", isoDate(4));
await setValue(page, "New time", "16:45");
await submit(page);
await waitSheet(page, /Retry call moved to/);
await done(page);
s = await state();
const moved = s.tasks.find((t) => t.id === retry.id);
check("reschedule keeps the same task (id, creator, created_at), new due time, no duplicate", moved?.status === "open" && moved.created_at === retry.created_at && moved.created_by === retry.created_by && moved.due_at !== retry.due_at && s.tasks.filter((t) => t.contact_id === K(1) && t.status === "open").length === 1);

// Do not contact — this person (Casey, no open task now)
await go(page, LEADS(T(1)));
await clickWhere(page, { label: "Start contact with Casey Fox" });
await page.waitForSelector(SHEET);
await waitSheet(page, /What happened\?/);
await choose(page, "Do not contact");
await submit(page);
await settle(800);
check("Do not contact needs an explicit scope", /this person or the entire company/.test(await page.$eval(`${SHEET} [role=alert]`, (e) => e.innerText).catch(() => "")));
await choose(page, "This person");
await setValue(page, "Reason", "Asked to be removed from calls");
await shot(page, "11-do-not-contact-desktop");
await submit(page);
await waitSheet(page, /This person is now restricted\./);
await done(page);
s = await state();
check("DNC (person): contact restriction created through the existing model", s.suppressions.some((r) => r.contact_id === K(2) && r.scope === "contact"));
await go(page, LEADS(T(1)));
drawer = await page.$eval(DRAWER, (e) => e.innerText);
check("restriction removes Casey's actions; Robin still has his", !(await page.$(`button[aria-label="Start contact with Casey Fox"]`)) && !!(await page.$(`button[aria-label="Start contact with Robin Hale"]`)) && /Contact restricted/.test(drawer));
const activity = await page.$eval(`ul[aria-label="Recent activity"]`, (e) => e.innerText).catch(() => "");
check("activity timeline: attempts (who, outcome) and tasks (kind, due, status), newest first", /Do not contact/.test(activity) && /No answer/.test(activity) && /by you/.test(activity) && /Retry call/.test(activity) && /Open/.test(activity) && /Completed/.test(activity) && activity.indexOf("Do not contact") < activity.indexOf("No answer"), activity);
await page.$eval(`ul[aria-label="Recent activity"]`, (e) => e.scrollIntoView({ block: "center" }));
await settle(400);
await shot(page, "10-company-activity-desktop");

// Do not contact — entire company (Juniper; Morgan has an open follow-up)
await go(page, LEADS(T(2)));
await clickWhere(page, { label: "Start contact with Morgan Ash" });
await page.waitForSelector(SHEET);
await waitSheet(page, /What happened\?/);
await choose(page, "Do not contact");
await choose(page, "Entire company");
await submit(page);
await waitSheet(page, /The company is now restricted\./);
await done(page);
s = await state();
check("DNC (company): company restriction; its open tasks cancelled", s.suppressions.some((r) => r.company_id === T(2) && r.scope === "company") && !s.tasks.some((t) => t.contact_id === K(4) && t.status === "open"));
await go(page, LEADS(T(2)));
check("company restriction removes every contact action", !(await page.$(`button[aria-label^="Start contact with"]`)) && !(await page.$(`button[aria-label^="Reschedule"]`)));

// Not interested (Northwind / Avery, from the drawer) — no suppression, no qualification change
await go(page, LEADS(NORTHWIND));
await clickWhere(page, { label: "Start contact with Avery Stone" });
await page.waitForSelector(SHEET);
await waitSheet(page, /What happened\?/);
await choose(page, "Connected — not interested");
await submit(page);
await waitSheet(page, /Saved: Connected — not interested/);
await done(page);
s = await state();
check("Not interested: no restriction, qualification unchanged (needs review)", !s.suppressions.some((r) => r.contact_id === "40000000-0000-4000-a000-000000000001") && s.qualification.find((q) => q.id === NORTHWIND)?.q === "needs_review");
check("attempts/tasks never changed a score or fingerprint", s.scores.every((x) => x.status !== "stale" || x.company_id === NORTHWIND));

// Schedule follow-up deliberately (Lou after a wrong number), then the contact shows its task
await go(page, LEADS(T(7)));
await clickWhere(page, { label: "Start contact with Lou Brandt" }).catch(() => {});
if (await page.$(SHEET)) await closeSheet(page);
await page.evaluate((d) => {
  const drawer = [...document.querySelectorAll(d)].find((e) => e.offsetParent !== null);
  const li = [...drawer.querySelectorAll("li")].find((x) => x.innerText.includes("Lou Brandt"));
  [...li.querySelectorAll("button")].find((b) => b.textContent.trim() === "Schedule follow-up").click();
}, DRAWER);
await page.waitForSelector(SHEET);
await settle(500);
await setValue(page, "Due date", isoDate(5));
await setValue(page, "Due time", "13:00");
await submit(page);
await waitSheet(page, /Follow-up scheduled for/);
await done(page);
s = await state();
check("Schedule follow-up from the drawer creates the contact's one open task", s.tasks.filter((t) => t.contact_id === K(11) && t.status === "open").length === 1);
drawer = await page.$eval(DRAWER, (e) => e.innerText);
check("with an open task the drawer offers Reschedule (not a second task)", /Next: Follow-up/.test(drawer) && !!(await page.$('button[aria-label="Reschedule follow-up for Lou Brandt"]')));

// ---------------------------------------------------------------------------
// Refresh lead scores (explicit batch; trusted writer; no providers)
// ---------------------------------------------------------------------------
await go(page, TODAY());
const usageBefore = (await state()).providerUsage;
const writesBefore = (await state()).trustedWrites;
await clickWhere(page, { text: "Refresh lead scores" });
await page.waitForFunction(() => /Evaluated \d+/.test(document.querySelector("#refresh-scores-hint")?.innerText ?? ""), SLOW);
const refreshText = await page.$eval("#refresh-scores-hint", (e) => e.innerText);
check("Refresh lead scores reports a concise grade summary", /Evaluated \d+ · A: \d+ · B: \d+ · C: \d+ · Excluded: \d+/.test(refreshText), refreshText);
s = await state();
check("batch used the trusted writer, made no provider calls", s.trustedWrites > writesBefore && s.providerUsage === usageBefore, JSON.stringify({ w: s.trustedWrites, writesBefore, u: s.providerUsage }));
await shot(page, "18-score-refresh-desktop");
await go(page, TODAY());
check("after refresh nothing is left to evaluate", /All leads are evaluated against the default ICP|0 leads need/.test(await mainText(page)) || !/leads? needs? evaluation/.test(await mainText(page)));

// ---------------------------------------------------------------------------
// Empty states and time zone
// ---------------------------------------------------------------------------
await go(page, TODAY(ALPHA));
check("No default ICP → set a default ICP message", /Set a default ICP to build your Today queue/.test(await mainText(page)));
await go(page, `${BASE}/w/${BETA}/settings`);
await clickWhere(page, { text: "Edit", tag: "button" });
await page.waitForSelector(SHEET);
await setValue(page, "Time zone", "America/Chicago");
await submit(page);
await page.waitForFunction((s) => !document.querySelector(s), SLOW, SHEET);
await settle(1500);
await go(page, `${BASE}/w/${BETA}/settings`);
check("time zone saved by an owner and shown in Settings", /Time zone\s*America\/Chicago/.test(await mainText(page)) && (await state()).timezone.beta === "America/Chicago");
await go(page, TODAY());
check("Today shows the workspace time zone after the change", /Times in America\/Chicago/.test(await mainText(page)));
const member = await newPage(VIEW.desktop);
await login(member.page, "member.a@example.test");
await go(member.page, `${BASE}/w/${BETA}/settings`);
check("members read the time zone but can't edit the business profile", /America\/Chicago/.test(await mainText(member.page)) && !(await member.page.evaluate(() => [...document.querySelectorAll("main button")].some((b) => b.textContent.trim() === "Editbusiness profile"))));
await member.ctx.close();

// ---------------------------------------------------------------------------
// Mobile 390 / 360
// ---------------------------------------------------------------------------
const m = await newPage(VIEW.m390);
await login(m.page, "owner.a@example.test");
await go(m.page, TODAY());
check("390: summary compact (4 cards in one row), no overflow", (await m.page.$$eval('ul[aria-label="Today summary"] > li', (l) => new Set(l.map((x) => Math.round(x.getBoundingClientRect().top))).size)) === 1 && (await noOverflow(m.page)));
check("390: tabs visible on mobile; bottom navigation unchanged", !!(await m.page.$("[role=tablist]")) && /Today[\s\S]*Discover[\s\S]*Leads/.test(await m.page.$eval("nav[aria-label]:last-of-type", (e) => e.innerText).catch(() => "")));
await m.page.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent.startsWith("Lead Queue")).click());
await settle(600);
const cards = await m.page.$eval('ul[aria-label="Ready to contact"]', (e) => e.innerText).catch(() => "");
check("390: Ready rows become cards with a tappable phone", cards.length > 0 && !!(await m.page.$('ul[aria-label="Ready to contact"] a[href^="tel:"]')), cards);
const sizes = await m.page.$$eval('ul[aria-label="Ready to contact"] button[aria-haspopup=dialog]', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
check("390: Call buttons ≥ 44px", sizes.length > 0 && sizes.every((x) => x >= 44), JSON.stringify(sizes));
const firstCall = await m.page.$eval('ul[aria-label="Ready to contact"] button[aria-haspopup=dialog]', (b) => b.getAttribute("aria-label"));
await m.page.$eval('ul[aria-label="Ready to contact"] button[aria-haspopup=dialog]', (b) => b.click());
await m.page.waitForSelector(SHEET);
await m.page.waitForFunction((s) => /What happened\?/.test(document.querySelector(s)?.innerText ?? ""), SLOW, SHEET);
await settle(600);
check("390: Start contact sheet fits", await noOverflow(m.page), firstCall);
await shot(m.page, "14-start-contact-mobile");
await choose(m.page, "Left voicemail");
await m.page.$eval(`${SHEET} .overflow-y-auto`, (e) => (e.scrollTop = 520));
await settle(400);
await shot(m.page, "15-log-outcome-mobile");
await choose(m.page, "Callback requested");
await setValue(m.page, "Callback date", isoDate(1));
await setValue(m.page, "Callback time", "15:00");
await m.page.$eval(`${SHEET} .overflow-y-auto`, (e) => (e.scrollTop = e.scrollHeight));
await settle(400);
const radios = await m.page.$$eval(`${SHEET} label:has(input[type=radio])`, (ls) => ls.map((l) => l.getBoundingClientRect().height));
check("390: disposition targets ≥ 44px; date/time labelled with time zone", radios.every((h) => h >= 44) && /Time zone: America\/Chicago/.test(await sheetText(m.page)));
await shot(m.page, "16-callback-mobile");
await closeSheet(m.page);
check("390: closing without saving records nothing", (await state()).attempts.length === s.attempts.length);
await go(m.page, LEADS(T(1)));
await m.page.evaluate(() => document.querySelector('ul[aria-label="Recent activity"]')?.scrollIntoView({ block: "start" }));
await settle(500);
check("390: drawer activity readable, no overflow", (await noOverflow(m.page)) && !!(await m.page.$('ul[aria-label="Recent activity"]')));
await shot(m.page, "17-activity-mobile");
await m.ctx.close();

const m360 = await newPage(VIEW.m360);
await login(m360.page, "owner.a@example.test");
await go(m360.page, TODAY());
await m360.page.evaluate(() => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent.startsWith("Callbacks")).click());
await settle(500);
check("360: Today and due actions fit without horizontal overflow", await noOverflow(m360.page));
await m360.ctx.close();

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------
check("the browser never called Supabase or a provider directly", !requests.some((u) => u.startsWith(MOCK) || /hunter|googleapis|places/.test(u)), requests.filter((u) => u.startsWith(MOCK)).slice(0, 3).join(" "));
const final = await state();
check("provider usage unchanged by P1-E7 (none recorded)", final.providerUsage === 0, final.providerUsage);

await owner.ctx.close();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
