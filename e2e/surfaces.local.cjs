/**
 * The surfaces the tour cannot see.
 *
 * `app.live.cjs` proves every route *renders*; this file proves the five
 * feature surfaces actually work end to end in a browser: the note editor's
 * autosave, note and chapter share links, the whole short-link lifecycle
 * (mint → redirect → pause → re-point → refused destination), the CSV and PDF
 * exporters, and whether a settings change survives a reload.
 *
 * It runs on the mock backend against a seeded account (`seed.local.cjs`), so
 * every write lands in the driven browser's localStorage and nothing reaches a
 * real project. `check(ok, name)` is the runner's own reporter, passed in from
 * `app.live.cjs` so both legs print one list.
 *
 * Debug one flow at a time with `SURFACE=notes|noteShare|qr|share|export|settings`.
 */
const NOTE_TITLE = "E2E Bonding notes";
const NOTE_TITLE_FINAL = "E2E Hybridisation notes";
const NOTE_BODY =
  "A sigma bond is the first overlap between two orbitals; a pi bond needs the p orbitals to sit parallel. sp3 gives four equivalent orbitals and a tetrahedral arrangement.";

const DEST_FIRST = "https://example.com/first-destination";
const DEST_SECOND = "https://example.com/second-destination";

const sleep = (page, ms) => page.waitForTimeout(ms);

/** Poll a predicate until it holds or the budget runs out. */
async function until(fn, { timeout = 20_000, every = 250 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
}

/**
 * The page's visible text, or "" when there is no page to read.
 *
 * A poll that starts while the browser is navigating dies with
 * "Execution context was destroyed" — which is exactly what a sink page like
 * `/r/:code` does on purpose. Swallowing it here turns that into another
 * iteration of the poll instead of a crashed run.
 */
const text = (page) =>
  page.evaluate(() => document.body.innerText).catch(() => "");

/**
 * Poll the page's visible text until `test` accepts it.
 *
 * Every page here reads its data asynchronously, so a check taken a fixed delay
 * after `goto` is a race with the mock's own promise chain: the manage page
 * failed exactly that way once and passed the next run. The return value is the
 * matched text (or `null`), so the check can print what it saw.
 */
async function untilText(page, test, { timeout = 20_000 } = {}) {
  return until(async () => {
    const value = await text(page);
    return test(value) ? value : null;
  }, { timeout });
}

/**
 * The destination stub. `/r/:code` calls `window.location.replace(target)`, so
 * the browser really leaves the app; intercepting example.com keeps that
 * navigation offline *and* echoes the path back, which is what proves a
 * re-pointed link reaches its new address rather than the one it was minted with.
 */
async function stubDestinations(page) {
  await page.route("**://example.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: `STUB ${route.request().url()}`,
    }),
  );
}

/** Radix select: open the trigger, then pick the option by name. */
async function pick(page, triggerOcid, optionName, { exact = true } = {}) {
  const trigger = page.locator(`[data-ocid="${triggerOcid}"]`);
  await trigger.waitFor({ state: "visible", timeout: 20_000 });
  await trigger.click({ timeout: 20_000 });
  const option = page.getByRole("option", { name: optionName, exact });
  await option.waitFor({ state: "visible", timeout: 20_000 });
  await option.click({ timeout: 20_000 });
  await sleep(page, 250);
}

async function clickOcid(page, ocid, timeout = 20_000) {
  const target = page.locator(`[data-ocid="${ocid}"]`);
  await target.waitFor({ state: "visible", timeout });
  await target.click({ timeout });
}

const inputValue = (page, ocid) =>
  page.locator(`[data-ocid="${ocid}"]`).inputValue({ timeout: 20_000 });

/* ------------------------------------------------------------------ notes */

async function notesFlow(page, base, check) {
  await page.goto(`${base}/notes`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const opened = await untilText(page, (value) => /no notes yet/i.test(value));
  check(opened !== null, "/notes opens on its empty state");

  await clickOcid(page, "notes.create_button");
  await page.waitForURL("**/notes/*", { timeout: 30_000 });
  const noteUrl = page.url();
  check(/\/notes\/\d+/.test(noteUrl), "New note opens an editor route");

  await page.locator('[data-ocid="note_detail.title_input"]').fill(NOTE_TITLE);
  await page.locator('[data-ocid="note.block_text.1"]').fill(NOTE_BODY);

  // Autosave is a ~1 s debounce after the last change (`AUTOSAVE_DELAY_MS` in
  // NoteDetail.tsx) and the live region reads "Saved" from the moment the note
  // loads, so sampling it immediately passes on a save that never ran. Wait the
  // debounce out, then prove the save against the *list*: that row is server
  // state, so the title appearing there is the only real evidence.
  await sleep(page, 1_800);
  const status = await until(async () => {
    const value = await page
      .locator('[data-ocid="note_detail.save_status"]')
      .innerText()
      .catch(() => "");
    return /saved/i.test(value) && !/saving/i.test(value) ? value : null;
  });
  check(status !== null, `the note autosaves (status: ${status ?? "stuck on Saving…"})`);

  await page.goto(`${base}/notes`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const list =
    (await untilText(
      page,
      (value) => value.includes(NOTE_TITLE) && /sigma bond/.test(value),
    )) ?? (await text(page));
  check(list.includes(NOTE_TITLE), "the saved note is listed by title");
  check(/sigma bond/.test(list), "the list shows the note's own excerpt");

  await clickOcid(page, "notes.rename_button.1");
  const dialog = page.locator('[data-ocid="notes.rename.dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  await dialog.locator('[data-ocid="notes.rename_input"]').fill(NOTE_TITLE_FINAL);
  await dialog.locator('[data-ocid="notes.rename.save_button"]').click();
  await until(async () => !(await dialog.isVisible().catch(() => false)));
  // The row is refetched after the rename, so the old title is still on screen
  // for a moment; wait for the list to show the new one and drop the old.
  const afterRename =
    (await untilText(
      page,
      (value) => value.includes(NOTE_TITLE_FINAL) && !value.includes(NOTE_TITLE),
    )) ?? (await text(page));
  check(
    afterRename.includes(NOTE_TITLE_FINAL) && !afterRename.includes(NOTE_TITLE),
    "the rename dialog retitles the row",
  );
  return { noteUrl };
}

/* ------------------------------------------------------------- note share */

async function noteShareFlow(page, base, check, noteUrl) {
  await page.goto(noteUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(page, 900);
  await clickOcid(page, "note_detail.create_share_button");
  const shareUrl = await until(async () => {
    const value = await page
      .locator('[data-ocid="note_detail.share_url.1"]')
      .inputValue()
      .catch(() => "");
    return value.includes("/shared/note/") ? value : null;
  });
  check(shareUrl !== null, "the note editor mints a /shared/note/ address");
  if (!shareUrl) return;

  await page.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const body =
    (await untilText(
      page,
      (value) => value.includes(NOTE_TITLE_FINAL) && /sigma bond/.test(value),
    )) ?? (await text(page));
  check(
    body.includes(NOTE_TITLE_FINAL) && /sigma bond/.test(body),
    "the shared note page renders the note's content",
  );
}

/* ---------------------------------------------------------------------- qr */

async function qrFlow(page, base, check) {
  await stubDestinations(page);
  await page.goto(`${base}/qr`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const preview = await untilText(
    page,
    (value) => /enter a destination url/i.test(value),
  );
  check(preview !== null, "/qr starts with its empty preview");

  await page.locator('[data-ocid="qr.url_input"]').fill(DEST_FIRST);
  await clickOcid(page, "qr.create_link_button");
  await page
    .locator('[data-ocid="qr.success_state"]')
    .waitFor({ state: "visible", timeout: 20_000 });
  const shortUrl = await inputValue(page, "qr.short_url_input");
  check(/\/r\//.test(shortUrl), `a short link is minted (${shortUrl})`);

  const code = shortUrl.split("/r/")[1] ?? "";
  check(
    code.length >= 10 && /^[A-Za-z0-9]+$/.test(code),
    `the minted code holds the ten-character floor (${code.length})`,
  );

  // Read the secret edit link now: the sink calls `location.replace`, so the
  // QR page is gone the moment the redirect runs and nothing on it is readable
  // afterwards.
  const manageUrl = await inputValue(page, "qr.manage_url_input");
  const managePath = manageUrl.startsWith("http") ? manageUrl : `${base}${manageUrl}`;
  check(
    managePath.includes("/manage/") && managePath.length > base.length + 10,
    "the edit link is offered beside the code",
  );

  // The sink leaves the origin by design; the stub answers with its own URL.
  await page.goto(shortUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const reached = await untilText(
    page,
    (value) => /STUB .*first-destination/.test(value),
    { timeout: 20_000 },
  );
  check(reached !== null, "the /r/:code sink reaches its destination");

  await page.goto(managePath, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // `ManageLink` renders a skeleton while `get_link_detail` is in flight
  // (line 215 of the page: `if (detailQuery.isLoading)`), so the heading and
  // the status badge do not exist yet at a fixed delay. Poll rather than sleep
  // — this check failed once on a slow load and passed on the next run.
  const manage = await until(async () => {
    const value = await text(page);
    return /manage link/i.test(value) && /active/i.test(value) ? value : null;
  });
  check(
    manage !== null,
    "the manage page opens from its secret token",
  );

  // One trip through the sink has happened by now, so the counter the manage
  // page shows is the scan log the sink wrote — read the number, not the
  // absence of an empty state.
  const total = await until(async () => {
    const value = await page
      .locator('[data-ocid="manage.total_scans"]')
      .innerText()
      .catch(() => "");
    return /^\d+$/.test(value.trim()) ? value.trim() : null;
  });
  check(
    total !== null && Number(total) >= 1,
    `the sink's visit is recorded on the link (total scans: ${total ?? "—"})`,
  );
  check(
    (await page.locator('[data-ocid="manage.scans_chart"]').count()) > 0,
    "the scan history charts by day",
  );

  await clickOcid(page, "manage.pause_button");
  const pausedBadge = await until(async () => {
    const badge = await page.locator('[data-ocid="manage.status_badge"]').innerText().catch(() => "");
    return /paused/i.test(badge) ? badge : null;
  });
  check(pausedBadge !== null, "pausing the link flips its own status badge");

  await page.goto(shortUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const stopped = await untilText(page, (value) => /paused/i.test(value));
  check(
    stopped !== null &&
      (await page.locator('[data-ocid="scan.unavailable_state"]').count()) > 0,
    "a paused link stops redirecting and says why",
  );

  await page.goto(managePath, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(page, 900);
  await clickOcid(page, "manage.pause_button");
  await until(async () => {
    const badge = await page.locator('[data-ocid="manage.status_badge"]').innerText().catch(() => "");
    return /active/i.test(badge) ? badge : null;
  });

  await page.locator('[data-ocid="manage.target_input"]').fill(DEST_SECOND);
  await clickOcid(page, "manage.save_button");
  const updated = await until(async () => {
    const count = await page.locator('[data-ocid="manage.save_success"]').count();
    return count > 0 ? true : null;
  });
  check(updated !== null, "the destination can be changed on the same code");

  await page.goto(shortUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const repointed = await untilText(
    page,
    (value) => /STUB .*second-destination/.test(value),
  );
  check(repointed !== null, "the re-pointed code reaches the new destination");

  // A destination that breaks the URL rules is refused where it is written.
  await page.goto(`${base}/qr`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(page, 900);
  const another = page.locator('[data-ocid="qr.create_another_button"]');
  if ((await another.count()) > 0) await another.click();
  await page.locator('[data-ocid="qr.url_input"]').fill("http://127.0.0.1:8080/private");
  await page.locator('[data-ocid="qr.create_link_button"]').click({ timeout: 10_000 }).catch(() => {});
  // The refusal is what proves the rule ran; only once it is on screen does the
  // absence of a success state mean anything.
  const refused = await untilText(page, (value) => /private or local/i.test(value));
  check(refused !== null, "a loopback destination is refused at the form");
  check(
    (await page.locator('[data-ocid="qr.success_state"]').count()) === 0,
    "no code is minted for a refused destination",
  );
}

/* ---------------------------------------------------------- chapter share */

async function shareFlow(page, base, check, seed) {
  await page.goto(`${base}/share`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(page, 900);
  await pick(page, "share.class_select", seed.CLASS_NAME);
  await pick(page, "share.subject_select", seed.SUBJECT_NAME);
  await pick(page, "share.chapter_select", seed.CHAPTER_NAME);
  await clickOcid(page, "share.create_button");

  // `ShareLinkPanel` prints the address in a `<p>`, not an input (only the QR
  // and note-share flows offer a copyable field), and the row is identified by
  // its index, so scan every row rather than trusting the newest one to sort
  // first.
  const shareUrl = await until(async () => {
    const rows = page.locator('[data-ocid^="share.link."]');
    const n = await rows.count();
    for (let index = 0; index < n; index += 1) {
      const value = await rows
        .nth(index)
        .locator("p")
        .first()
        .innerText()
        .catch(() => "");
      if (value.includes("/shared/")) return value.trim();
    }
    return null;
  });
  check(shareUrl !== null, "a chapter share link is created from the picker");
  if (!shareUrl) return;

  await page.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const body =
    (await untilText(
      page,
      (value) => value.includes(seed.CHAPTER_NAME) && /bond angle/i.test(value),
    )) ?? (await text(page));
  check(
    body.includes(seed.CHAPTER_NAME) && /bond angle/i.test(body),
    "the shared chapter renders read-only with its questions",
  );
  await page.goto(`${base}/share`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const revokeRow = await until(async () =>
    (await page.locator('[data-ocid^="share.revoke_button."]').count()) > 0 ? true : null,
  );
  check(revokeRow !== null, "the share row offers revoke (not clicked)");
}

/* ------------------------------------------------------------ export files */

async function exportFlow(page, base, check, seed) {
  await page.goto(`${base}/export`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(page, 900);
  await pick(page, "export.class_select", seed.CLASS_NAME);
  await pick(page, "export.subject_select", seed.SUBJECT_NAME);
  await pick(page, "export.chapter_select", seed.CHAPTER_NAME);

  const csv = await until(async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 5_000 }).catch(() => null),
      page.locator('[data-ocid="export.download_button"]').click({ timeout: 10_000 }),
    ]);
    return download ?? null;
  }, { timeout: 30_000 });
  check(csv !== null && /\.csv$/i.test(csv.suggestedFilename()), `the CSV export downloads (${csv ? csv.suggestedFilename() : "nothing"})`);
  if (csv) {
    const file = await csv.path();
    const fs = require("node:fs");
    const body = fs.readFileSync(file, "utf8");
    check(
      /bond angle in a perfect tetrahedron/i.test(body),
      "the CSV carries the seeded question text",
    );
  }

  await pick(page, "export.format_select", /PDF/i, { exact: false });
  const pdf = await until(async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 5_000 }).catch(() => null),
      page.locator('[data-ocid="export.download_button"]').click({ timeout: 10_000 }),
    ]);
    return download ?? null;
  }, { timeout: 40_000 });
  check(pdf !== null && /\.pdf$/i.test(pdf.suggestedFilename()), `the PDF export downloads (${pdf ? pdf.suggestedFilename() : "nothing"})`);
  if (pdf) {
    const fs = require("node:fs");
    const head = fs.readFileSync(await pdf.path());
    check(
      head.subarray(0, 5).toString() === "%PDF-" && head.length > 1_000,
      `the PDF is a real document (${head.length} bytes)`,
    );
  }
}

/* -------------------------------------------------------------- settings */

async function settingsFlow(page, base, check) {
  const NAME = "E2e Renamed Student";
  await page.goto(`${base}/settings`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(page, 1_200);
  await clickOcid(page, "settings.section_nav.account");
  const nameInput = page.locator('[data-ocid="settings.account.display_name_input"]');
  await nameInput.waitFor({ state: "visible", timeout: 20_000 });
  await nameInput.fill(NAME);
  await page
    .locator('[data-ocid="settings.save_bar"]')
    .waitFor({ state: "visible", timeout: 20_000 });
  check(true, "editing the profile reveals the sticky save bar");
  await clickOcid(page, "settings.save_button");
  const savedToast = await until(async () => /settings saved/i.test(await text(page)));
  check(savedToast !== null, "saving the profile reports success");

  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(page, 1_500);
  await clickOcid(page, "settings.section_nav.account").catch(() => {});
  const reloaded = await inputValue(page, "settings.account.display_name_input");
  check(reloaded === NAME, `the change survives a reload (${reloaded})`);
  check((await text(page)).includes("E2e Renamed"), "the header greets the renamed account");

  await clickOcid(page, "settings.section_nav.appearance");
  await clickOcid(page, "settings.appearance.theme_card.maroon");
  const applied = await page.evaluate(() => ({
    maroon: document.documentElement.classList.contains("maroon"),
    stored: localStorage.getItem("studyforge-theme"),
  }));
  check(applied.maroon, "the Maroon Forge card paints the document root");
  await clickOcid(page, "settings.save_button").catch(() => {});
  await sleep(page, 900);

  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(page, 1_200);
  const persisted = await page.evaluate(() => ({
    maroon: document.documentElement.classList.contains("maroon"),
    stored: localStorage.getItem("studyforge-theme"),
  }));
  check(
    persisted.maroon && /maroon/.test(String(persisted.stored)),
    `the theme re-applies on boot (${persisted.stored})`,
  );

  await clickOcid(page, "settings.section_nav.security").catch(() => {});
  await sleep(page, 600);
  check(
    (await page.locator('[data-ocid="settings.security.delete_button"]').count()) > 0,
    "the danger zone offers Clear local data (not clicked)",
  );

  // Leave the tree's default theme in place for anything that reads the screen
  // after this file in the same context.
  await clickOcid(page, "settings.section_nav.appearance").catch(() => {});
  await clickOcid(page, "settings.appearance.theme_card.light").catch(() => {});
  await clickOcid(page, "settings.save_button").catch(() => {});
}

/**
 * Run every surface against a seeded, signed-in page. Returns nothing: the
 * checks report through the caller's `check`, and a thrown error means the run
 * could not be completed at all (which is different from a check failing).
 */
async function checkSurfaces(page, base, check, seed, only = "all") {
  const wanted = only.split(",").map((name) => name.trim());
  const run = (name) => only === "all" || wanted.includes(name);
  let noteUrl = null;
  if (run("notes")) {
    ({ noteUrl } = await notesFlow(page, base, check));
  }
  if (run("noteShare") && noteUrl) {
    await noteShareFlow(page, base, check, noteUrl);
  }
  if (run("qr")) await qrFlow(page, base, check);
  if (run("share")) await shareFlow(page, base, check, seed);
  if (run("export")) await exportFlow(page, base, check, seed);
  if (run("settings")) await settingsFlow(page, base, check);
}

module.exports = { checkSurfaces, NOTE_TITLE, NOTE_TITLE_FINAL, DEST_FIRST, DEST_SECOND };
