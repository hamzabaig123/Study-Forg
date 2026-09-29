/**
 * Provisions a working StudyForge account through the real UI, on the mock
 * (localStorage) backend: register → confirm email → class/subject/chapter/topic
 * → five questions → one finished practice session.
 *
 * It exists because `app.live.cjs` asserts on *data* (attempt history,
 * percentages, the accuracy hero) and nothing in the repo could produce that data
 * for a fresh browser profile — so the browser leg had never been run.
 *
 * Every step is a click-path a learner takes; nothing is written into
 * `localStorage` from outside, which is the point: the run exercises the form
 * validation, the Radix dialogs, the mock canister's 77 methods and the merged
 * analytics in one trip.
 */
const PASSWORD = "studyforge-e2e-password";

const CLASS_NAME = "E2E Organic Chemistry";
const SUBJECT_NAME = "E2E Bonding";
const CHAPTER_NAME = "E2E Covalent bonds";
const TOPIC_NAME = "E2E Molecular shape";

/** Three multiple choice and two true/false, so both grading paths run. */
const QUESTIONS = [
  {
    type: "mc",
    prompt: "What is the approximate bond angle in a perfect tetrahedron?",
    options: ["109.5 degrees", "120 degrees", "180 degrees"],
    correct: 0,
  },
  {
    type: "mc",
    prompt: "Which interaction holds atoms together inside a molecule?",
    options: ["A shared electron pair", "A transferred electron", "A loose proton"],
    correct: 0,
  },
  {
    type: "mc",
    prompt: "A polar covalent bond forms when electrons are…",
    options: ["Shared unequally", "Shared equally", "Not shared at all"],
    correct: 0,
  },
  { type: "tf", prompt: "Water is a polar molecule.", correct: true },
  { type: "tf", prompt: "A methane molecule has a linear shape.", correct: false },
];

const sleep = (page, ms) => page.waitForTimeout(ms);

async function textOf(page) {
  return page.evaluate(() => document.body.innerText);
}

/** Click a role/button by exact-ish name, waiting for it to be actionable. */
async function clickButton(page, name, { dialog = false, timeout = 20_000 } = {}) {
  const scope = dialog ? page.getByRole("dialog") : page;
  await scope.getByRole("button", { name }).click({ timeout });
}

/** Radix selects need a click on the trigger then a click on the option. */
async function chooseOption(page, triggerName, optionName) {
  await page.getByRole("combobox", { name: triggerName }).click({ timeout: 20_000 });
  await page.getByRole("option", { name: optionName, exact: true }).click({ timeout: 20_000 });
}

async function openDialogAndFill(page, buttonName, fields) {
  await clickButton(page, buttonName);
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  for (const [label, value] of fields) {
    await dialog.getByLabel(label).fill(value, { timeout: 20_000 });
  }
}

async function createEntity(page, buttonName, submitName, name) {
  await openDialogAndFill(page, buttonName, [["Name", name]]);
  await clickButton(page, submitName, { dialog: true });
  await sleep(page, 800);
}

/** The last dialog usually leaves the new card on screen; follow its Open link. */
async function openCard(page, linkName) {
  await page.getByRole("link", { name: new RegExp(linkName, "i") }).last().click({ timeout: 20_000 });
  await page.waitForLoadState("domcontentloaded");
  await sleep(page, 700);
}

async function registerAndConfirm(page, base, email) {
  await page.goto(`${base}/register`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByLabel("Name", { exact: true }).fill("E2E Student", { timeout: 30_000 });
  await page.getByLabel("Email", { exact: true }).fill(email);
  // "Password" is a substring of "Confirm password", so the loose matcher hits
  // both and Playwright refuses the ambiguous strict match.
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click({ timeout: 30_000 });
  await page.waitForURL("**/verify-email**", { timeout: 30_000 });

  const body = await textOf(page);
  if (!/confirm this email/i.test(body)) {
    throw new Error(
      "the verify-email screen offers no local confirmation button — this build is not on the mock backend",
    );
  }
  await page.getByRole("button", { name: /confirm this email/i }).click({ timeout: 20_000 });
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

async function buildHierarchy(page, base) {
  await page.goto(`${base}/classes`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(page, 600);
  await createEntity(page, /new class/i, /create class/i, CLASS_NAME);
  await openCard(page, "open class");

  await createEntity(page, /new subject/i, /create subject/i, SUBJECT_NAME);
  await openCard(page, "open subject");

  await createEntity(page, /new chapter/i, /create chapter/i, CHAPTER_NAME);
  await openCard(page, "open chapter");

  await createEntity(page, /new topic/i, /create topic/i, TOPIC_NAME);
  // Questions are authored on the topic page, so follow the card the chapter
  // list just gained rather than assuming the dialog left us somewhere useful.
  await openCard(page, "open topic");
}

async function addQuestion(page, question) {
  const createButton = page.getByRole("button", { name: /new question/i });
  const writeLink = page.getByRole("button", { name: /write a question/i });
  if (await createButton.first().isVisible().catch(() => false)) {
    await createButton.first().click();
  } else {
    await writeLink.first().click();
  }
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  await dialog.getByLabel("Prompt").fill(question.prompt, { timeout: 20_000 });

  if (question.type === "mc") {
    await chooseOption(page, /question type/i, "Multiple choice");
    const inputs = dialog.locator('[data-ocid^="question.option.input"]');
    for (let index = 0; index < question.options.length - 2; index += 1) {
      await clickButton(page, /add option/i, { dialog: true });
      await sleep(page, 200);
    }
    const count = await inputs.count();
    for (let index = 0; index < question.options.length; index += 1) {
      await inputs.nth(index).fill(question.options[index]);
    }
    if (count < question.options.length) {
      throw new Error(`question form offers ${count} option fields, needs ${question.options.length}`);
    }
    await dialog.locator('[data-ocid="question.correct_option.' + question.correct + '"]').click();
  } else {
    await chooseOption(page, /question type/i, "True / false");
    await dialog
      .locator(question.correct ? '[data-ocid="question.true_false.true"]' : '[data-ocid="question.true_false.false"]')
      .click();
  }

  await clickButton(page, /add question/i, { dialog: true });
  await sleep(page, 700);
  // A form that stayed open means the create was refused; say so here rather
  // than letting the next iteration time out on a blocked dialog.
  if (await dialog.isVisible().catch(() => false)) {
    const why = await dialog.innerText();
    throw new Error(`question refused: ${why.slice(0, 200).replace(/\s+/g, " ")}`);
  }
}

/**
 * Answer the on-screen question with the option this file seeded.
 *
 * Questions and options are both shuffled by the session engine
 * (`src/lib/sessionEngine.ts`), so position means nothing here: the prompt
 * identifies the question and the option's own visible text identifies the
 * answer. `AnswerControls` puts the A/B/C letter chip and the option text in the
 * same button, hence the endsWith match rather than equality.
 */
async function answerCurrent(page) {
  const prompt = (
    await page.locator('[data-ocid="custom.prompt"]').innerText({ timeout: 15_000 })
  ).trim();
  const seeded = QUESTIONS.find((item) => item.prompt.trim() === prompt);
  if (!seeded) throw new Error(`the session shows a question nobody seeded: "${prompt}"`);

  const wanted =
    seeded.type === "mc"
      ? seeded.options[seeded.correct]
      : seeded.correct
        ? "True"
        : "False";

  const options = page.locator('[data-ocid^="custom.option."]');
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    const label = (await options.nth(index).innerText())
      .replace(/\s+/g, " ")
      .trim();
    if (label !== wanted && !label.endsWith(wanted)) continue;
    await options.nth(index).click({ timeout: 15_000 });
    await sleep(page, 400);
    const feedback = await page
      .locator('[data-ocid="custom.feedback"]')
      .innerText()
      .catch(() => "");
    if (/not quite/i.test(feedback)) {
      throw new Error(`the grader marked "${wanted}" wrong on "${prompt}"`);
    }
    if (!/correct/i.test(feedback)) {
      throw new Error(`answering "${prompt}" produced no feedback block`);
    }
    return true;
  }
  throw new Error(`"${wanted}" is not among the ${count} options shown for "${prompt}"`);
}

/**
 * Practice hides `custom.primary_button` ("Next") on the last question and
 * always renders `custom.submit_button` ("Finish & see results"), so the real
 * end-of-test signal is the absence of the Next locator. Testing the page's
 * innerText instead — which the first draft did — matched the Finish button on
 * question 1 and submitted a session with nothing answered.
 */
async function runPracticeSession(page, base) {
  // Adding the last question leaves the topic page open, which is exactly the
  // page whose "Practice" link starts a session preselected to that topic.
  await sleep(page, 500);
  await page.getByRole("link", { name: /practice/i }).first().click({ timeout: 20_000 });
  await page.waitForURL("**/test-builder**", { timeout: 30_000 });
  await page.getByRole("button", { name: /start practice/i }).click({ timeout: 20_000 });
  await page.waitForURL("**/custom-test/**", { timeout: 30_000 });
  await sleep(page, 800);

  let answered = 0;
  for (let guard = 0; guard < QUESTIONS.length; guard += 1) {
    await answerCurrent(page);
    answered += 1;
    const next = page.locator('[data-ocid="custom.primary_button"]');
    if ((await next.count()) > 0) {
      await next.click({ timeout: 15_000 });
      await sleep(page, 500);
      continue;
    }
    await page
      .locator('[data-ocid="custom.submit_button"]')
      .click({ timeout: 15_000 });
    break;
  }
  await page.waitForURL("**/custom-results/**", { timeout: 30_000 });
  await sleep(page, 1200);
  return { answered, results: await textOf(page) };
}

/**
 * Full provisioning run; leaves the browser signed in on the results page.
 * `until` stops after a named stage — register, hierarchy, questions or session —
 * which is how this file gets debugged a stage at a time instead of one long run
 * that dies at step six and says nothing about steps two to five.
 */
async function provision(page, base, until = "session") {
  const email = `e2e+${Date.now()}@studyforge.test`;
  const stages = { register: 0, hierarchy: 1, questions: 2, session: 3 };
  const stop = stages[until] ?? stages.session;
  await registerAndConfirm(page, base, email);
  const out = { email, password: PASSWORD, answered: 0, results: "" };
  if (stop < 1) return out;
  await buildHierarchy(page, base);
  if (stop < 2) return out;
  for (const question of QUESTIONS) await addQuestion(page, question);
  if (stop < 3) return out;
  return { ...out, ...(await runPracticeSession(page, base)) };
}

module.exports = {
  provision,
  registerAndConfirm,
  buildHierarchy,
  addQuestion,
  runPracticeSession,
  PASSWORD,
  CLASS_NAME,
  SUBJECT_NAME,
  CHAPTER_NAME,
  TOPIC_NAME,
  QUESTIONS,
};
