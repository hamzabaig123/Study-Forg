#!/usr/bin/env node
/**
 * StudyForge replay sweep — the whole write path against a real Supabase project.
 *
 * This is the Phase 6 companion to supabase/tests/rls_cross_tenant.sql: that
 * file proves the policies isolate tenants, this one proves the RPCs and
 * table writes the adapter depends on actually work end to end — hierarchy,
 * server-graded sessions, notes, shares, links, settings — and cleans up
 * after itself, whose cascades remove every row the sweep wrote.
 *
 * WHAT IT NEEDS TO RUN
 *
 *   SUPABASE_URL         the project URL
 *   SUPABASE_ANON_KEY    the publishable key (the same pair `.env.local` holds)
 *   and ONE of:
 *   SUPABASE_DB_URL      postgres://postgres.<ref>:<password>@<pooler>:5432/postgres
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * No service-role key is required. The sweep signs its throwaway accounts up
 * through GoTrue's public `/auth/v1/signup` — the same call the login screen
 * makes — and uses the privileged connection only to stamp `email_confirmed_at`
 * on the two that need one (a project with no SMTP provider cannot confirm by
 * email; the third account is left unconfirmed on purpose) and to delete all
 * three at the end. `SUPABASE_DB_URL` is therefore the credential to reach
 * for: it is the same one `supabase/e2e/apply-migration.mjs` needs, it cannot
 * read or write any app row outside `auth.users` without going through the
 * policies, and it is never stored in a repo file. The service-role key still
 * works if that is what a runner has, and CI may prefer it.
 *
 * Because the accounts are confirmed rather than bypassed, every step below runs
 * as a real `authenticated` request through PostgREST and through RLS. Nothing
 * here has ever been run as a superuser, so a PASS means the policy set worked,
 * not that it was skipped.
 *
 *   cd src/frontend                                  # node_modules lives here
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_DB_URL=... \
 *     node ../../supabase/e2e/replay-sweep.mjs
 *
 * `pg` is not a dependency of this project (see the note in loadDriver below).
 * Exit code 0 means every step passed; 2 means the environment is short.
 */import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// supabase-js is installed with the frontend; load that copy so the script
// has no dependency of its own.
const { createClient } = require(resolve(
  join(here, "..", "..", "src", "frontend", "node_modules", "@supabase", "supabase-js"),
));

const URL_ = process.env.SUPABASE_URL?.trim();
const ANON = process.env.SUPABASE_ANON_KEY?.trim();
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const DB_URL = process.env.SUPABASE_DB_URL?.trim();
if (!URL_ || !ANON || !(SERVICE || DB_URL)) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_ANON_KEY, plus SUPABASE_DB_URL (preferred) or SUPABASE_SERVICE_ROLE_KEY, in the environment.",
  );
  process.exit(2);
}

/**
 * `pg` is deliberately not a dependency of this project — it would sit in
 * `package.json` for one script that a reviewer may never run. Resolve it from
 * the ordinary places instead: NODE_PATH (how the migration was applied by
 * hand), the frontend's own tree if it ever grows the driver, or a scratch
 * directory. The error says which, rather than letting it surface as
 * MODULE_NOT_FOUND inside a run that has already created accounts.
 */
function loadDriver() {
  for (const specifier of ["pg", resolve(join(here, "..", "..", "src", "frontend", "node_modules", "pg"))]) {
    try {
      return require(specifier);
    } catch {
      // try the next one
    }
  }
  console.error(
    "This run needs the `pg` driver. Install it outside the repo and point\n" +
      "NODE_PATH at it:\n" +
    "  mkdir -p ../sf-scratch && cd ../sf-scratch && npm install pg\n" +
    "  NODE_PATH=../sf-scratch/node_modules node .../replay-sweep.mjs\n" +
    "Or set SUPABASE_SERVICE_ROLE_KEY instead.",
  );
  process.exit(2);
}

/**
 * The only privileged operations in the whole run: confirm a throwaway account
 * so `owner_is_verified()` lets it through, and delete it afterwards. Both
 * routes do exactly these two things and nothing else; every step in between is
 * an ordinary authenticated HTTP request.
 */
function privilegedAccess() {
  if (SERVICE) {
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    return {
      kind: "service role",
      async create({ email, password }, confirm = true) {
        const created = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: confirm,
        });
        if (created.error || !created.data.user) {
          throw new Error(created.error?.message ?? "signup returned no user");
        }
        return created.data.user.id;
      },
      async drop(id) {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw new Error(error.message);
      },
    };
  }

  const pg = loadDriver();
  const pool = new pg.Pool({
    connectionString: DB_URL,
    max: 1,
    // The pooler terminates TLS with a public CA; an explicit opt-in is the
    // only way to relax that, and a run against production should not have one.
    ssl: { rejectUnauthorized: process.env.SUPABASE_DB_ALLOW_INSECURE_TLS !== "1" },
  });
  return {
    kind: "direct Postgres",
    async create({ email, password }, confirm = true) {
      // Public signup, so the account GoTrue builds is the same shape a real
      // user gets; only the confirmation stamp is done by hand.
      const signup = createClient(URL_, ANON, { auth: { persistSession: false } });
      const created = await signup.auth.signUp({ email, password });
      const id = created.data?.user?.id;
      if (!id) throw new Error(created.error?.message ?? "signup returned no user id");
      if (confirm) {
        await pool.query(
          "update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())," +
            " phone_confirmed_at = coalesce(phone_confirmed_at, now()) where id = $1::uuid",
          [id],
        );
      }
      return id;
    },
    async drop(id) {
      await pool.query("delete from auth.users where id = $1::uuid", [id]);
    },
    async close() {
      await pool.end();
    },
  };
}

const sha256 = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const slug = (n) => randomBytes(n).toString("hex").slice(0, n);
const noteToken = () => `note_${slug(24)}`;
const shareToken = () => `share_${slug(24)}`;
const linkCode = () => {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  // 10 characters, matching SHORT_CODE_LENGTH in lib/supabase/tokens.ts and the
  // `{7,12}` CHECK that 0003 installs. A 7-character code would still be
  // accepted, and minting one here would hide the fact that the widening never
  // reached the database.
  return Array.from(randomBytes(10), (byte) => alphabet[byte % alphabet.length]).join("");
};

let passed = 0;
const failures = [];

async function step(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (cause) {
    failures.push(name);
    console.error(`  FAIL  ${name}: ${cause.message}`);
  }
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

function ok(payload, message) {
  must(payload && payload.ok !== undefined, `${message}: ${JSON.stringify(payload)}`);
  return payload.ok;
}

const stamp = Date.now();
const account = (letter) => ({
  email: `replay-sweep-${letter}-${stamp}@example.invalid`,
  password: randomBytes(18).toString("base64url"),
});
const userA = account("a");
const userB = account("b");
// C stays unconfirmed on purpose: it is the account `owner_is_verified()` exists
// to shut out.
const userC = account("c");

const privileged = privilegedAccess();
const client = createClient(URL_, ANON, { auth: { persistSession: false } });
// A second, never-signed-in client is the anonymous share/scan surface.
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

const ids = {};

try {
  console.log(`accounts: ${privileged.kind} (throwaway, deleted at the end)`);
  ids.a = await privileged.create(userA);
  ids.b = await privileged.create(userB);
  ids.c = await privileged.create(userC, false);

  const signedIn = await client.auth.signInWithPassword({
    email: userA.email,
    password: userA.password,
  });
  must(signedIn.data?.session, signedIn.error?.message ?? "account A cannot sign in");
} catch (cause) {
  console.error(
    `Sweep aborted before the first step: ${cause.message}\n` +
      "Check the credential you passed (SUPABASE_DB_URL or SUPABASE_SERVICE_ROLE_KEY), the project URL, and that the migrations have been applied.",
  );
  await privileged.close?.();
  process.exit(1);
}

// --------------------------------------------------------------------------
console.log("hierarchy");
// --------------------------------------------------------------------------

async function insertRow(table, values, select = "id") {
  const { data, error } = await client.from(table).insert(values).select(select).single();
  must(!error, `${table} insert failed: ${error?.message}`);
  return data;
}

await step("create class", async () => {
  ids.class = (await insertRow("class", { name: "Sweep class" })).id;
});
await step("create subject/chapter/topic", async () => {
  ids.subject = (await insertRow("subject", { class_id: ids.class, name: "Sweep subject" })).id;
  ids.chapter = (await insertRow("chapter", { subject_id: ids.subject, name: "Sweep chapter" })).id;
  ids.topic = (await insertRow("topic", { chapter_id: ids.chapter, name: "Sweep topic" })).id;
});
await step("create one question of each type", async () => {
  ids.mcq = (await insertRow("question", {
    topic_id: ids.topic,
    prompt: "Which of these is A?",
    question_type: "multipleChoice",
    answer: {
      __kind__: "multipleChoice",
      multipleChoice: {
        options: [
          { id: "1", text: "Right one" },
          { id: "2", text: "Wrong one" },
        ],
        correctOptionId: "1",
      },
    },
  })).id;
  ids.tf = (await insertRow("question", {
    topic_id: ids.topic,
    prompt: "Is A true?",
    question_type: "trueFalse",
    answer: { __kind__: "trueFalse", trueFalse: { correct: true } },
  })).id;
  ids.sa = (await insertRow("question", {
    topic_id: ids.topic,
    prompt: "Capital of France?",
    question_type: "shortAnswer",
    answer: { __kind__: "shortAnswer", shortAnswer: { expected: "Paris" } },
  })).id;
});
await step("class_rows / topic_rows read back the tree", async () => {
  const classes = await client.rpc("class_rows", {});
  must(!classes.error && Array.isArray(classes.data), `class_rows: ${classes.error?.message}`);
  must(classes.data.length === 1, `expected 1 class, saw ${classes.data.length}`);
  const topics = await client.rpc("topic_rows", { p_chapter_id: ids.chapter });
  must(!topics.error, `topic_rows: ${topics.error?.message}`);
});

// --------------------------------------------------------------------------
console.log("practice session (server-side sampling and grading)");
// --------------------------------------------------------------------------

await step("start_session samples every question in the topic", async () => {
  const started = await client.rpc("start_session", {
    p_mode: "practice",
    p_scope_kind: "topic",
    p_scope_id: ids.topic,
  });
  must(!started.error && started.data?.ok, `start_session: ${started.error?.message ?? JSON.stringify(started.data)}`);
  ids.session = started.data.ok;
  const items = await client.from("session_item").select("id, question_id").eq("session_id", ids.session);
  must(!items.error && items.data.length === 3, `expected 3 sampled items, saw ${items.data?.length}`);
  ids.items = items.data;
});
await step("submit_answer grades right and wrong server-side", async () => {
  const pick = (questionId) => ids.items.find((item) => String(item.question_id) === String(questionId));
  const right = await client.rpc("submit_answer", {
    p_session_id: ids.session,
    p_question_id: ids.tf,
    p_submitted: { __kind__: "trueFalse", trueFalse: { value: true } },
  });
  must(!right.error && right.data?.ok, `trueFalse submit: ${right.error?.message ?? JSON.stringify(right.data)}`);
  const wrong = await client.rpc("submit_answer", {
    p_session_id: ids.session,
    p_question_id: ids.mcq,
    p_submitted: { __kind__: "multipleChoice", multipleChoice: { optionId: "2" } },
  });
  must(!wrong.error && wrong.data?.ok, `mcq submit: ${wrong.error?.message ?? JSON.stringify(wrong.data)}`);
  const text = await client.rpc("submit_answer", {
    p_session_id: ids.session,
    p_question_id: ids.sa,
    p_submitted: { __kind__: "shortAnswer", shortAnswer: { text: "  PARIS " } },
  });
  must(!text.error, `short answer submit: ${text.error?.message}`);
  must(text.data?.ok?.correct === true, `normalisation failed: ${JSON.stringify(text.data)}`);
});
await step("complete_session moves the session to results", async () => {
  const done = await client.rpc("complete_session", { p_session_id: ids.session });
  must(!done.error && done.data?.ok, `complete_session: ${done.error?.message ?? JSON.stringify(done.data)}`);
  const leftover = await client.from("session").select("id").eq("id", ids.session);
  must(leftover.data.length === 0, "the live session row survived completion");
  // complete_session answers with the session id; the result links by it.
  const result = await client.from("result").select("score, total").eq("session_id", ids.session).maybeSingle();
  must(!result.error && result.data, `result not found: ${result.error?.message}`);
  must(result.data.total === 3, `expected 3 answered, saw ${result.data.total}`);
});
await step("attempt_history / dashboard_stats / analytics_breakdown answer", async () => {
  for (const name of ["attempt_history", "dashboard_stats", "analytics_breakdown"]) {
    const r = await client.rpc(name, {});
    must(!r.error, `${name}: ${r.error?.message}`);
  }
});

// --------------------------------------------------------------------------
console.log("notes and shares");
// --------------------------------------------------------------------------

await step("note create / update / rename / trash / restore", async () => {
  const note = await insertRow("note", { title: "Sweep note", document_json: "[]", search_text: "sweep" });
  ids.note = note.id;
  const updated = await client.rpc("update_note", {
    p_id: ids.note, p_title: "Sweep note", p_subject_label: null, p_chapter_label: null,
    p_topic_label: null, p_document_json: "[1]", p_search_text: "sweep two", p_expected_revision: 1,
  });
  must(!updated.error && updated.data?.ok, `update_note: ${updated.error?.message ?? JSON.stringify(updated.data)}`);
  const stale = await client.rpc("update_note", {
    p_id: ids.note, p_title: "Sweep note", p_subject_label: null, p_chapter_label: null,
    p_topic_label: null, p_document_json: "[2]", p_search_text: "sweep two", p_expected_revision: 1,
  });
  must(stale.data?.err !== undefined, "a stale revision was accepted");
  await client.rpc("rename_note", { p_id: ids.note, p_title: "Renamed" });
  const trashed = await client.rpc("set_note_status", { p_id: ids.note, p_status: "trashed" });
  must(!trashed.error, `trash: ${trashed.error?.message}`);
  const row = await client.from("note").select("deleted_at").eq("id", ids.note).single();
  must(row.data.deleted_at !== null, "trashing did not stamp deleted_at");
  await client.rpc("set_note_status", { p_id: ids.note, p_status: "active" });
});
await step("note share reads back anonymously by digest", async () => {
  const token = noteToken();
  const created = await client.rpc("create_note_share", { p_note_id: ids.note, p_token: token });
  must(!created.error && created.data?.ok, `create_note_share: ${created.error?.message}`);
  const viewed = await anon.rpc("shared_note", { p_token_hash: sha256(token) });
  must(!viewed.error && viewed.data, `shared_note: ${viewed.error?.message ?? "empty"}`);
  const dead = await anon.rpc("shared_note", { p_token_hash: sha256(noteToken()) });
  must(dead.data === null, "an unknown note token resolved");
});
await step("content share hides answers and revokes", async () => {
  const token = shareToken();
  const created = await client.rpc("create_share", { p_scope_kind: "topic", p_scope_id: ids.topic, p_token: token });
  must(!created.error && created.data?.ok, `create_share: ${created.error?.message}`);
  const viewed = await anon.rpc("shared_content", { p_token_hash: sha256(token) });
  must(!viewed.error && viewed.data, `shared_content: ${viewed.error?.message ?? "empty"}`);
  must(!JSON.stringify(viewed.data).includes("correctOptionId"), "the share reply leaked correct answers");
  const { error } = await client.from("content_share").delete().eq("token", token);
  must(!error, `revoke: ${error?.message}`);
  const dead = await anon.rpc("shared_content", { p_token_hash: sha256(token) });
  must(dead.data === null, "content survived revocation");
});

// --------------------------------------------------------------------------
console.log("links: create / resolve / manage / report / delete");
// --------------------------------------------------------------------------

await step("link lifecycle through the token surface", async () => {
  const code = linkCode();
  const editToken = `sweep-edit-token-${slug(24)}`;
  const hash = sha256(editToken);
  const created = ok((await client.rpc("create_link", {
    p_target_url: "https://example.com/", p_code: code, p_edit_token: editToken,
  })).data ?? {}, "create_link");
  must(created.shortUrl === `/r/${code}`, `short url: ${created.shortUrl}`);
  const redirect = (await anon.rpc("resolve_link", { p_code: code, p_device: "mobile" })).data;
  must(redirect?.targetUrl === "https://example.com/", `resolve: ${JSON.stringify(redirect)}`);
  const detail = (await anon.rpc("link_detail_for_token", { p_token_hash: hash })).data;
  must(detail?.code === code && detail.status === "active", `detail: ${JSON.stringify(detail)}`);
  must(!JSON.stringify(detail).includes(editToken), "the detail reply carried the edit token");
  ok((await anon.rpc("link_set_paused", { p_token_hash: hash, p_paused: true })).data, "pause");
  const paused = (await anon.rpc("resolve_link", { p_code: code })).data;
  must(paused?.unavailable === "paused", `paused resolve: ${JSON.stringify(paused)}`);
  ok((await anon.rpc("link_update_target", { p_token_hash: hash, p_target_url: "https://example.org/" })).data, "retarget");
  ok((await anon.rpc("link_set_paused", { p_token_hash: hash, p_paused: false })).data, "resume");
  const moved = (await anon.rpc("resolve_link", { p_code: code })).data;
  must(moved?.targetUrl === "https://example.org/", `retargeted resolve: ${JSON.stringify(moved)}`);
  ok((await anon.rpc("report_link_abuse", { p_code: code, p_reason: "sweep probe" })).data, "abuse report");
  ok((await anon.rpc("link_delete", { p_token_hash: hash })).data, "delete");
  const dead = (await anon.rpc("resolve_link", { p_code: code })).data;
  must(dead?.unavailable === "deleted", `deleted resolve: ${JSON.stringify(dead)}`);
});

// --------------------------------------------------------------------------
console.log("settings, activity, and the second tenant");
// --------------------------------------------------------------------------

await step("user_settings upsert and read", async () => {
  const { error } = await client.from("user_settings")
    .upsert({ display_name: "Sweeper", study_goal: "pass", daily_target: 30 }, { onConflict: "owner_id" });
  must(!error, `upsert: ${error?.message}`);
  const row = await client.from("user_settings").select("daily_target").single();
  must(row.data?.daily_target === 30, `read back: ${JSON.stringify(row.data)}`);
});
await step("activity insert and read", async () => {
  // The server-side functions (complete_session, note ops) log activity rows
  // of their own, so the assertion is relative: this step's insert adds one.
  const before = await client.from("activity").select("id");
  must(!before.error, `read before: ${before.error?.message}`);
  const { error } = await client.from("activity").insert({ kind: "note", title: "Sweep activity" });
  must(!error, `insert: ${error?.message}`);
  const rows = await client.from("activity").select("id");
  must(rows.data.length === before.data.length + 1,
    `expected ${before.data.length + 1} activity rows, saw ${rows.data.length}`);
});
await step("the second account sees none of it", async () => {
  const other = createClient(URL_, ANON, { auth: { persistSession: false } });
  const signedIn = await other.auth.signInWithPassword({ email: userB.email, password: userB.password });
  must(signedIn.data?.session, "account B cannot sign in");
  const classes = await other.from("class").select("id");
  must(!classes.error && classes.data.length === 0, `B sees ${classes.data?.length} classes`);
  const settings = await other.from("user_settings").select("owner_id");
  must(!settings.error && settings.data.length === 0, "B sees A's settings row");
  await other.auth.signOut();
});
await step("an unconfirmed account is refused before it touches a row", async () => {
  // Account C was created without the confirmation stamp, which is the state a
  // sign-up leaves the project in until the email is opened. Either GoTrue
  // withholds the session, or it hands one over and `owner_is_verified()`
  // refuses the write — both are a pass, and the second is the one that proves
  // the gate lives in the database rather than in the login screen.
  const pending = createClient(URL_, ANON, { auth: { persistSession: false } });
  const signedIn = await pending.auth.signInWithPassword({
    email: userC.email,
    password: userC.password,
  });
  if (!signedIn.data?.session) {
    console.log(`        (GoTrue withheld the session: ${signedIn.error?.message})`);
    return;
  }
  const attempt = await pending.from("class").insert({ name: "Written by an unconfirmed account" });
  must(attempt.error, "an unconfirmed account inserted a row — no INSERT policy checks confirmation");
  const rows = await pending.from("class").select("id");
  must(!rows.error && rows.data.length === 0, `unconfirmed account read ${rows.data.length} rows`);
  const rpc = await pending.rpc("class_rows", {});
  must(
    rpc.error || (Array.isArray(rpc.data) && rpc.data.length === 0),
    "class_rows answered for an unconfirmed account",
  );
  await pending.auth.signOut();
});

// --------------------------------------------------------------------------
console.log("");
await client.auth.signOut();
for (const id of [ids.a, ids.b, ids.c]) {
  if (!id) continue;
  try {
    await privileged.drop(id);
  } catch (cause) {
    console.error(`cleanup: could not delete ${id}: ${cause.message}`);
  }
}
await privileged.close?.();

// Exit code, not process.exit: an undici or libuv handle still draining on
// Windows turns a hard exit into a crash banner that hides the result.
if (failures.length > 0) {
  console.error(`\n${failures.length} of ${passed + failures.length} steps FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: all ${passed} replay-sweep steps succeeded against ${new URL(URL_).host}`);
}
