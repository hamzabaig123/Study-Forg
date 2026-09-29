/**
 * Live app checks: boots against a running dev server (or deployment), signs
 * in, and asserts the pages a learner touches render real data with no errors.
 *
 * Run from this folder:
 *   npm install
 *   BASE_URL=http://localhost:5173 DEMO_EMAIL=demo@studyforge.test \
 *   DEMO_PASSWORD='…' node app.live.cjs
 *
 * The checks below assert on *data* — an attempt history, percentages, the
 * accuracy hero — so an account with no history proves nothing. `SEED_LOCAL=1`
 * provisions that data through the UI instead of needing credentials:
 * `seed.local.cjs` registers a throwaway account, builds the class → topic chain,
 * authors five questions and finishes a practice session, all against the mock
 * backend. Run it against a dev server started with `VITE_DATA_BACKEND=mock`.
 *
 * Exit 0 = every check passed; anything else prints what failed.
 */
const { chromium } = require("playwright-core");
const os = require("node:os");
const path = require("node:path");
const seed = require("./seed.local.cjs");
const surfaces = require("./surfaces.local.cjs");

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const SEED_LOCAL = process.env.SEED_LOCAL === "1";
const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;
if (!SEED_LOCAL && (!EMAIL || !PASSWORD)) {
  console.error(
    "DEMO_EMAIL and DEMO_PASSWORD are required (env), or set SEED_LOCAL=1 to provision an account on the mock backend.",
  );
  process.exit(2);
}

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.EDGE_PATH ?? EDGE,
    headless: true,
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const check = (ok, name) => {
    console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
    if (!ok) process.exitCode = 1;
  };

  if (SEED_LOCAL) {
    const seeded = await seed.provision(page, BASE);
    console.log(`  seeded ${seeded.email}`);
    check(
      seeded.answered === seed.QUESTIONS.length,
      `the session answered every seeded question (${seeded.answered}/${seed.QUESTIONS.length})`,
    );
    check(
      /\b100%/.test(seeded.results),
      "the results page scores the seeded session at 100%",
    );
    await page.goto(`${BASE}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForTimeout(2500);
    check(page.url().includes("/dashboard"), "a provisioned account reaches the dashboard");
  } else {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    await page.waitForTimeout(2500);
    check(page.url().includes("/dashboard"), "sign-in lands on the dashboard");
  }

  const dashText = await page.evaluate(() => document.body.innerText);
  check(/accuracy/i.test(dashText), "dashboard shows the accuracy hero");
  check(/streak/i.test(dashText), "dashboard shows the day streak");
  check(!/built with love/i.test(dashText), "no third-party credit in the footer");

  if (SEED_LOCAL) {
    // The hierarchy the seed built by hand must read back out of the mock
    // canister, or "the pages render data" would be true of an empty account.
    await page.goto(`${BASE}/classes`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(1200);
    check(
      (await page.evaluate(() => document.body.innerText)).includes(seed.CLASS_NAME),
      "classes lists the seeded class",
    );
  }


  await page.goto(`${BASE}/analytics`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  // The analytics chunk (recharts) compiles on first visit, so a fixed sleep
  // races the render — poll for the history section instead of sleeping.
  let analytics = "";
  for (let waited = 0; waited < 30_000; waited += 500) {
    analytics = await page.evaluate(() => document.body.innerText);
    if (/attempt history/i.test(analytics) && /\d+%/.test(analytics)) break;
    await page.waitForTimeout(500);
  }
  check(/attempt history/i.test(analytics), "analytics renders the attempt history");
  check(/100%/.test(analytics) || /\d+%/.test(analytics), "analytics shows percentages");

  await page.goto(`${BASE}/test-builder`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(1500);
  const builder = await page.evaluate(() => document.body.innerText);
  check(/build a test/i.test(builder), "test builder opens");
  check(/shuffle/i.test(builder), "builder offers shuffling");
  check(/timed test/i.test(builder) && /practice/i.test(builder), "builder offers both modes");

  await page.goto(`${BASE}/notes`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(1500);
  check(
    /new note/i.test(await page.evaluate(() => document.body.innerText)),
    "notes workspace opens",
  );

  // The whole-shell tour: every signed-in page must fill its main content
  // region and mount inside the entrance transition, with zero page errors
  // across the trip. Content is read from the region only, so the sidebar's own
  // labels cannot make a route look alive when it is not.
  const tour = [
    "/dashboard", "/classes", "/analytics", "/test-builder", "/notes",
    "/ai-studio", "/share", "/export", "/qr", "/settings",
  ];
  for (const route of tour) {
    await page.goto(`${BASE}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForTimeout(1_200);
    const main = await page.evaluate(() => {
      // /qr lives in the public shell, the rest in the signed-in shell —
      // either way the tour reads the routed content region, not the chrome.
      const region = document.querySelector(
        '[data-ocid="app.main"], [data-ocid="public.main"]',
      );
      // Two entrance mechanisms ship, and the check has to name both or it
      // fails on the page that animates: the motion pass gave the shells a
      // wrapper whose opacity/transform live as inline styles, while the public
      // QR page still carries the `animate-fade-up` class. Measured on the
      // signed-in wrapper as `opacity: 0; transform: translateY(8px)` stepping
      // to `opacity: 1; transform: none` over 340 ms.
      // Only the region's own first two levels count — a card or a chart that
      // animates further down is not the page's entrance, and matching one
      // would let a route with no transition at all pass this check.
      const isEntrance = (el) => {
        if (!el) return false;
        const cls = typeof el.className === "string" ? el.className : "";
        const style = el.getAttribute("style") ?? "";
        return (
          cls.includes("animate-fade-up") ||
          (style.includes("opacity:") && style.includes("transform"))
        );
      };
      const wrappers = [];
      for (const child of region ? region.children : []) {
        wrappers.push(child, ...child.children);
      }
      return {
        text: region ? region.innerText : "",
        animated: wrappers.some(isEntrance),
      };
    });
    check(main.text.trim().length > 60, `${route} renders its content`);
    check(main.animated, `${route} carries the entrance transition`);
  }
  check(errors.length === 0, `zero page errors across the tour (saw ${errors.length})`);
  for (const e of errors) console.log("  pageerror:", e.slice(0, 200));

  if (SEED_LOCAL) {
    // The feature surfaces a tour cannot exercise: notes autosaving, share
    // links that actually open, the short-link lifecycle, real downloaded files,
    // and a setting that survives a reload. Needs the seed's content, so it runs
    // only on a seeded profile.
    const beforeSurfaces = errors.length;
    await surfaces.checkSurfaces(page, BASE, check, seed, process.env.SURFACE ?? "all");
    check(
      errors.length === beforeSurfaces,
      `zero page errors across the feature surfaces (saw ${errors.length - beforeSurfaces})`,
    );
    for (const e of errors.slice(beforeSurfaces)) console.log("  pageerror:", e.slice(0, 200));
  }

  await page.screenshot({ path: path.join(os.tmpdir(), "e2e-last.png"), fullPage: false });
  await browser.close();
  console.log(process.exitCode ? "E2E FAILED" : "E2E PASSED");
}

main().catch((err) => {
  console.error("E2E error:", err.message);
  process.exit(1);
});
