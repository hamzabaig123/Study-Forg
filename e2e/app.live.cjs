/**
 * Live app checks: boots against a running dev server (or deployment), signs
 * in, and asserts the pages a learner touches render real data with no errors.
 *
 * Run from this folder:
 *   npm install
 *   BASE_URL=http://localhost:5173 DEMO_EMAIL=demo@studyforge.test \
 *   DEMO_PASSWORD='…' node app.live.cjs
 *
 * Exit 0 = every check passed; anything else prints what failed.
 */
const { chromium } = require("playwright-core");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("DEMO_EMAIL and DEMO_PASSWORD are required (env).");
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

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await page.waitForTimeout(2500);
  check(page.url().includes("/dashboard"), "sign-in lands on the dashboard");

  const dashText = await page.evaluate(() => document.body.innerText);
  check(/accuracy/i.test(dashText), "dashboard shows the accuracy hero");
  check(/streak/i.test(dashText), "dashboard shows the day streak");
  check(!/built with love/i.test(dashText), "no third-party credit in the footer");

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

  check(errors.length === 0, `zero page errors (saw ${errors.length})`);
  for (const e of errors) console.log("  pageerror:", e.slice(0, 200));

  await page.screenshot({ path: path.join(os.tmpdir(), "e2e-last.png"), fullPage: false });
  await browser.close();
  console.log(process.exitCode ? "E2E FAILED" : "E2E PASSED");
}

main().catch((err) => {
  console.error("E2E error:", err.message);
  process.exit(1);
});
