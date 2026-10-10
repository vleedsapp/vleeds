/**
 * UI review + end-to-end smoke checks for the canonical shell (P0-E1-S1A).
 * Covers auth redirects, sign-in/out, workspace switching, foreign/unknown
 * workspace 404s, mobile bottom navigation + workspace sheet, responsive
 * overflow, onboarding, and browser network inspection for direct Supabase
 * calls / secrets / session tokens. Writes screenshots.
 *
 * Prereqs: `npm run build`, then in separate terminals
 *   node scripts/ui-review/mock-supabase.mjs   (or the real local stack + `npx supabase db reset`)
 *   npx next start -p 3000
 * Run:
 *   npm i --no-save puppeteer-core
 *   node scripts/ui-review/review.mjs [outDir]              normal build: checks + screenshots 01-14
 *   node scripts/ui-review/review.mjs [outDir] --fixtures   VLEEDS_UI_FIXTURES=1 build: screenshots 15-17
 * Set CHROME_PATH if Chrome is not at the Windows default location.
 */
import puppeteer from "puppeteer-core";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "docs/reports/screenshots/P0-E1-S1A";
const FIXTURES = process.argv.includes("--fixtures");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WS = {
  alpha: "20000000-0000-4000-a000-00000000000a",
  beta: "20000000-0000-4000-a000-00000000000b",
  gamma: "20000000-0000-4000-a000-00000000000c",
};
const VIEW = {
  d1440: { width: 1440, height: 900 },
  d1280: { width: 1280, height: 800 },
  t768: { width: 768, height: 1024, isMobile: true, hasTouch: true },
  m390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  m360: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const SIDEBAR = "aside.lg\\:flex";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
const browserRequests = [];
const bodies = [];

async function newPage(viewport = VIEW.d1440) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.setDefaultNavigationTimeout(90_000); // slow dev machines
  page.setDefaultTimeout(60_000);
  page.on("request", (req) => browserRequests.push(req.url()));
  page.on("response", async (res) => {
    try {
      const ct = res.headers()["content-type"] ?? "";
      if (/javascript|json|html|text|x-component/.test(ct)) bodies.push({ url: res.url(), text: await res.text() });
    } catch {}
  });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function login(page, email, password = "vleeds-dev-password") {
  await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), page.click("button[type=submit]")]);
}
async function waitShell(page) {
  await page.waitForSelector("main h1", { timeout: 30000 });
  await settle();
}

if (FIXTURES) {
  // ---------------------------------------------------------------- fixture screenshots only
  {
    const { ctx, page } = await newPage(VIEW.d1440);
    await login(page, "multi@example.test");
    await page.goto(BASE + "/ui-fixtures/today", { waitUntil: "networkidle0" });
    await page.waitForSelector("table");
    check("fixture route renders in fixture build", (await page.$("[data-ui-fixture]")) !== null);
    await shot(page, "15-today-desktop-ui-fixture");
    await page.click("tbody tr:first-child td:nth-child(3) button");
    await page.waitForSelector("aside[aria-label$='details']");
    await settle();
    await shot(page, "16-lead-detail-drawer-ui-fixture");
    check("fixture desktop has no horizontal overflow", await noOverflow(page));
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(VIEW.m390);
    await login(page, "multi@example.test");
    await page.goto(BASE + "/ui-fixtures/today", { waitUntil: "networkidle0" });
    await page.waitForSelector("ul.md\\:hidden li");
    await settle();
    await shot(page, "17-today-mobile-ui-fixture");
    check("fixture mobile has no horizontal overflow", await noOverflow(page));
    await ctx.close();
  }
} else {
  // ---------------------------------------------------------------- HTTP-level auth boundaries
  for (const [p, expect] of [
    ["/", "/login"],
    [`/w/${WS.alpha}/today`, `/login?next=%2Fw%2F${WS.alpha}%2Ftoday`],
    ["/workspaces/new", "/login?next=%2Fworkspaces%2Fnew"],
  ]) {
    const r = await fetch(BASE + p, { redirect: "manual" });
    const loc = r.headers.get("location") ?? "";
    check(`unauthenticated ${p} redirects to login`, r.status === 307 && loc.endsWith(expect), `${r.status} ${loc}`);
  }
  {
    const r = await fetch(BASE + "/login");
    check("security headers present", r.headers.get("x-frame-options") === "DENY" && !r.headers.get("x-powered-by"));
  }

  // ---------------------------------------------------------------- login
  {
    const { ctx, page } = await newPage();
    await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
    await shot(page, "01-login-desktop");
    await page.type("#password", "secret-value");
    await page.click("button[aria-label='Show password']");
    const shown = await page.$eval("#password", (e) => e.type);
    await page.click("button[aria-label='Hide password']");
    const hidden = await page.$eval("#password", (e) => e.type);
    check("password show/hide toggle works", shown === "text" && hidden === "password", `${shown}/${hidden}`);
    await page.$eval("#password", (e) => (e.value = ""));
    await page.type("#email", "multi@example.test");
    await page.type("#password", "wrong-password");
    await page.click("button[type=submit]");
    await page.waitForSelector("[role=alert]", { timeout: 20000 });
    const msg = await page.$eval("[role=alert]", (e) => e.textContent);
    check("bad password shows generic error", msg?.includes("Incorrect email or password"), msg ?? "");
    await shot(page, "02-login-error-desktop");
    await ctx.close();
  }

  // ---------------------------------------------------------------- desktop shell, multi-org user
  {
    const { ctx, page } = await newPage();
    await login(page, "multi@example.test");
    check("sign-in lands on first workspace Today", page.url() === `${BASE}/w/${WS.alpha}/today`, page.url());
    await waitShell(page);
    // Since P1-E7 each value carries its label for screen readers ("0 ready to contact"); compare the number.
    const zeros = await page.$$eval("main ul li div.font-bold", (els) => els.map((e) => (e.textContent.trim().match(/^\d+/) ?? [""])[0]));
    check("real Today shows truthful zero counts", zeros.length === 4 && zeros.every((z) => z === "0"), JSON.stringify(zeros));
    check("real Today shows no lead table", (await page.$("main table")) === null);
    await shot(page, "03-today-desktop-empty");

    for (const [section, file] of [["settings", "04-settings-desktop"], ["discover", "05-discover-desktop"], ["leads", "06-leads-desktop"], ["campaigns", "07-campaigns-desktop"]]) {
      await page.goto(`${BASE}/w/${WS.alpha}/${section}`, { waitUntil: "networkidle0" });
      await waitShell(page);
      await shot(page, file);
    }

    await page.click(`${SIDEBAR} button[aria-haspopup=menu]`);
    await page.waitForSelector(`${SIDEBAR} [role=menu]`);
    const groups = await page.$$eval(`${SIDEBAR} [role=menu] [role=group]`, (els) => els.map((e) => e.getAttribute("aria-label")));
    check("switcher groups workspaces by organization", JSON.stringify(groups) === JSON.stringify(["Example Org A", "Example Org B"]), JSON.stringify(groups));
    await shot(page, "08-workspace-switcher-desktop");
    const gamma = await page.$(`${SIDEBAR} [role=menu] a[href="/w/${WS.gamma}/campaigns"]`);
    check("switcher preserves current section", !!gamma);
    await gamma?.click();
    await page.waitForFunction(
      (id, sel) => location.pathname === `/w/${id}/campaigns` && document.querySelector(`${sel} button[aria-haspopup=menu]`)?.textContent?.includes("Gamma"),
      { timeout: 30000 }, WS.gamma, SIDEBAR,
    ).catch(() => {});
    const header = await page.$eval(`${SIDEBAR} button[aria-haspopup=menu]`, (e) => e.textContent);
    check("switching updates active workspace", page.url().endsWith(`/w/${WS.gamma}/campaigns`) && header.includes("Gamma"), header);

    // search + notifications are honest about having no backend
    await page.click("#global-search");
    check("search explains it is not available yet", (await page.$eval("form[role=search]", (e) => e.textContent)).includes("becomes available"));
    await page.keyboard.press("Escape");

    for (const [name, vp] of [["1440", VIEW.d1440], ["1280", VIEW.d1280]]) {
      await page.setViewport(vp);
      let ok = true;
      for (const s of ["today", "settings", "discover", "leads", "campaigns"]) {
        await page.goto(`${BASE}/w/${WS.alpha}/${s}`, { waitUntil: "networkidle0" });
        await waitShell(page);
        ok &&= await noOverflow(page);
      }
      check(`no horizontal overflow at ${name}px (all sections)`, ok);
    }
    await page.setViewport(VIEW.d1440);

    await page.goto(BASE + "/", { waitUntil: "networkidle0" });
    check("/ returns to last opened workspace", page.url() === `${BASE}/w/${WS.alpha}/today`, page.url());
    await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
    check("signed-in user is redirected away from /login", !page.url().includes("/login"), page.url());

    await page.goto(`${BASE}/w/${WS.alpha}/today`, { waitUntil: "networkidle0" });
    await waitShell(page);
    await page.click("button[aria-label='Account menu'], div.ml-auto button[aria-haspopup=menu]");
    await page.waitForSelector("[role=menu][aria-label=Account]");
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), page.click("[role=menu][aria-label=Account] button[type=submit]")]);
    check("sign out returns to login", page.url().startsWith(`${BASE}/login`), page.url());
    await page.goto(`${BASE}/w/${WS.alpha}/today`, { waitUntil: "networkidle0" });
    check("after sign out, workspace route requires login", page.url().startsWith(`${BASE}/login`), page.url());
    await ctx.close();
  }

  // ---------------------------------------------------------------- isolation behaviour in the UI
  {
    const { ctx, page } = await newPage();
    await login(page, "owner.a@example.test");
    await page.goto(`${BASE}/w/${WS.gamma}/today`, { waitUntil: "networkidle0" });
    const text = await page.evaluate(() => document.body.innerText);
    check("foreign workspace renders Not available", text.includes("Not available") && !text.includes("Gamma"));
    await page.goto(`${BASE}/w/30000000-0000-4000-a000-000000000099/today`, { waitUntil: "networkidle0" });
    check("nonexistent workspace gives identical response", (await page.evaluate(() => document.body.innerText)) === text);
    await page.goto(`${BASE}/w/not-a-uuid/today`, { waitUntil: "networkidle0" });
    check("malformed workspace id renders Not available", (await page.evaluate(() => document.body.innerText)).includes("Not available"));
    await page.goto(`${BASE}/ui-fixtures/today`, { waitUntil: "networkidle0" });
    check("UI fixture route does not exist in normal build", (await page.evaluate(() => document.body.innerText)).includes("Not available") && (await page.$("[data-ui-fixture]")) === null);
    await page.goto(`${BASE}/w/${WS.alpha}/today`, { waitUntil: "networkidle0" });
    await waitShell(page);
    await page.click(`${SIDEBAR} button[aria-haspopup=menu]`);
    await page.waitForSelector(`${SIDEBAR} [role=menu]`);
    const items = await page.$$eval(`${SIDEBAR} [role=menu] a[role=menuitem]`, (els) => els.map((e) => e.textContent.trim()));
    check("single-org switcher lists only own workspaces", !items.some((t) => t.includes("Gamma")) && items.some((t) => t.includes("Alpha")), JSON.stringify(items));
    await ctx.close();
  }

  // ---------------------------------------------------------------- mobile + tablet
  for (const [name, vp] of [["390", VIEW.m390], ["360", VIEW.m360], ["768", VIEW.t768]]) {
    const { ctx, page } = await newPage(vp);
    await login(page, "multi@example.test");
    await waitShell(page);
    const nav = await page.$("nav[aria-label=Primary].fixed");
    const navBox = await nav?.boundingBox();
    check(`${name}px: bottom navigation visible and pinned`, !!navBox && navBox.y + navBox.height >= vp.height - 2, JSON.stringify(navBox));
    const labels = await page.$$eval("nav[aria-label=Primary].fixed a", (els) => els.map((e) => e.textContent.trim()));
    check(`${name}px: bottom nav has all five sections`, JSON.stringify(labels) === JSON.stringify(["Today", "Discover", "Leads", "Campaigns", "Settings"]), JSON.stringify(labels));
    const sizes = await page.$$eval("nav[aria-label=Primary].fixed a", (els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
    check(`${name}px: bottom nav touch targets >= 44px`, sizes.every((s) => s >= 44), JSON.stringify(sizes.map(Math.round)));
    check(`${name}px: no hamburger drawer for primary navigation`, (await page.$("button[aria-label='Open navigation']")) === null);
    if (name === "390") await shot(page, "11-today-mobile");
    let ok = await noOverflow(page);
    for (const s of ["leads", "settings", "discover", "campaigns", "today"]) {
      await page.click(`nav[aria-label=Primary].fixed a[href="/w/${WS.alpha}/${s}"]`);
      await page.waitForFunction((p) => location.pathname === p, { timeout: 30000 }, `/w/${WS.alpha}/${s}`);
      await waitShell(page);
      ok &&= await noOverflow(page);
      const cur = await page.$eval("nav[aria-label=Primary].fixed a[aria-current=page]", (e) => e.textContent.trim());
      ok &&= cur.toLowerCase() === s;
      if (name === "390" && s === "settings") await shot(page, "12-settings-mobile");
    }
    check(`${name}px: bottom nav reaches every section with correct active state, no overflow`, ok);
    const pill = await page.$("header button[aria-haspopup=dialog]");
    const pillBox = await pill?.boundingBox();
    check(`${name}px: workspace selector not clipped`, !!pillBox && pillBox.x >= 0 && pillBox.x + pillBox.width <= vp.width, JSON.stringify(pillBox));
    if (name === "390") {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await settle();
      await page.screenshot({ path: path.join(OUT, "13-mobile-bottom-navigation.png"), clip: { x: 0, y: vp.height - 140, width: vp.width, height: 140 } });
      await pill.click();
      await page.waitForSelector("dialog[open]");
      await settle(400);
      const sheet = await page.$eval("dialog[open]", (e) => e.textContent);
      check("mobile sheet holds workspaces (both orgs) and sign out", sheet.includes("Example Org A") && sheet.includes("Example Org B") && sheet.includes("Sign out"));
      await shot(page, "14-mobile-workspace-controls");
      await page.keyboard.press("Escape");
      await settle();
      check("mobile sheet closes with Escape", (await page.$("dialog[open]")) === null);
    }
    await ctx.close();
  }

  // ---------------------------------------------------------------- onboarding
  {
    const { ctx, page } = await newPage();
    await login(page, "new@example.test");
    check("user without workspaces is sent to onboarding", page.url() === `${BASE}/workspaces/new`, page.url());
    await page.waitForSelector("#name", { timeout: 30000 });
    await settle();
    await shot(page, "09-onboarding-desktop");
    await page.click("button[type=submit]");
    await page.waitForSelector("[role=alert]", { timeout: 20000 });
    const described = await page.$eval("#name", (e) => e.getAttribute("aria-describedby"));
    check("onboarding validation errors are linked to fields", described === "name-error", described ?? "");
    await settle();
    await shot(page, "10-onboarding-validation-desktop");
    await ctx.close();
  }

  // ---------------------------------------------------------------- network / payload inspection
  const supabaseFromBrowser = browserRequests.filter((u) => u.includes(":54321"));
  check("browser never calls Supabase directly (all data access is server-side)", supabaseFromBrowser.length === 0, supabaseFromBrowser.slice(0, 3).join(", "));
  const leaky = bodies.filter((b) => /sb_secret_|service_role|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|postgresql:\/\//.test(b.text));
  check(`no secrets in ${bodies.length} browser-visible responses`, leaky.length === 0, leaky.map((b) => b.url).slice(0, 3).join(", "));
  const tokenInHtml = bodies.filter((b) => /refresh\.0000|mock-signature/.test(b.text));
  check("session tokens never appear in rendered HTML/RSC payloads", tokenInHtml.length === 0, tokenInHtml.map((b) => b.url).slice(0, 3).join(", "));
  const fixtureLeak = bodies.filter((b) => b.text.includes("vleeds-ui-fixture-only"));
  check("no UI fixture data in any browser-visible response", fixtureLeak.length === 0);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
