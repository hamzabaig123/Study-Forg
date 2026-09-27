/**
 * Archive-importer check: plants a localStorage mock archive (one already-known
 * library to exercise dedupe, one new to exercise create), signs in, runs
 * Settings → "Move data from this browser", and asserts the report appears.
 *
 *   BASE_URL=http://localhost:5173 DEMO_EMAIL=demo@studyforge.test \
 *   DEMO_PASSWORD='…' node import.live.cjs
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("DEMO_EMAIL and DEMO_PASSWORD are required (env).");
  process.exit(2);
}

function mockArchive() {
  const msDay = 86_400_000;
  const now = Date.now();
  return {
    version: 1,
    nextId: 100,
    classes: [
      { id: 1, name: "Class 11 — Biology", description: "From the old browser", createdAt: now - 10 * msDay, updatedAt: now - 10 * msDay },
      { id: 2, name: "Class 12 — Physics", description: "E2E import", createdAt: now - 10 * msDay, updatedAt: now - 10 * msDay },
    ],
    subjects: [
      { id: 3, classId: 1, name: "Cell Biology", createdAt: now - 10 * msDay, updatedAt: now - 10 * msDay },
      { id: 4, classId: 2, name: "Mechanics", createdAt: now - 10 * msDay, updatedAt: now - 10 * msDay },
    ],
    chapters: [
      { id: 6, subjectId: 3, name: "Cell Structure", createdAt: now - 10 * msDay, updatedAt: now - 10 * msDay },
      { id: 7, subjectId: 4, name: "Newton Laws", createdAt: now - 10 * msDay, updatedAt: now - 10 * msDay },
    ],
    topics: [
      { id: 8, chapterId: 7, name: "First Law", createdAt: now - 10 * msDay, updatedAt: now - 10 * msDay },
    ],
    questions: [
      { id: 11, topicId: 8, prompt: "State Newton's first law (e2e).", questionType: "shortAnswer",
        answer: { __kind__: "shortAnswer", shortAnswer: { expected: "inertia" } },
        explanation: "A body keeps its state unless forced.", createdAt: now - 9 * msDay, updatedAt: now - 9 * msDay },
    ],
    sessions: [], results: [], links: [], scans: [],
    notes: [
      { id: 90, title: "E2E imported note", createdAt: now - 5 * msDay, updatedAt: now - 1 * msDay,
        documentJson: JSON.stringify({ version: 1, blocks: [{ id: "p1", kind: "paragraph", text: "Carried across from the browser." }] }),
        searchText: "e2e imported note", status: "active", revision: 1 },
    ],
    noteShares: [], contentShares: [], activity: [], settings: null, aiKey: null,
  };
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1400 } })
  ).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const check = (ok, name) => {
    console.log(`${ok ? "  ok" : "FAIL"}  ${name}`);
    if (!ok) process.exitCode = 1;
  };

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.evaluate((db) => {
    window.localStorage.setItem("studyforge.mock-backend.v1", db);
  }, JSON.stringify(mockArchive()));
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });

  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(2_500);
  await page.getByRole("button", { name: /move it in/i }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  // The report renders when the run finishes; give every row time to land.
  await page.waitForTimeout(15_000);
  const body = await page.evaluate(() => document.body.innerText);
  check(/import|created|skipped/i.test(body), "the import report rendered");
  check(!/fail/i.test(body) || /failures: 0/i.test(body), "no failure lines in the report");
  check(errors.length === 0, `zero page errors (saw ${errors.length})`);
  for (const e of errors) console.log("  pageerror:", e.slice(0, 200));

  await browser.close();
  console.log(process.exitCode ? "E2E FAILED" : "E2E PASSED");
}

main().catch((err) => {
  console.error("E2E error:", err.message);
  process.exit(1);
});
