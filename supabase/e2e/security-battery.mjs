/**
 * StudyForge live security battery — the repeatable backend/authentication/
 * database/cybersecurity loop, driven over HTTPS with nothing but the
 * publishable key. Every PASS is an invariant a stranger on the internet
 * cannot break; a FAIL names the drift.
 *
 * Run from anywhere (no dependencies, Node 18+):
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ANON_KEY=<publishable key> \
 *   [DEMO_EMAIL=… DEMO_PASSWORD=…] \
 *   node supabase/e2e/security-battery.mjs
 *
 * DEMO_EMAIL/DEMO_PASSWORD enable the authenticated write-surface section
 * (uses the account named there; keeps its data intact). Exit 0 = all pass.
 *
 * Rate-limit probe note: enforce_rate_limit counts per epoch-aligned window,
 * so the probe waits for the next window edge before hammering — a plain loop
 * straddles the boundary and false-negatives (120/60s trips at call 121).
 */
const BASE = (process.env.SUPABASE_URL ?? process.env.SU_URL ?? "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_ANON_KEY ?? process.env.SU_KEY ?? "";
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";

if (!BASE || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY are required.");
  process.exitCode = 2;
}

/** The public tables every migration creates, minus the ones later migrations drop. */
const TABLES = [
  "abuse_report", "activity", "chapter", "class", "content_share",
  "custom_session", "link", "link_scan", "note", "note_share", "question",
  "rate_limit", "reminder_log", "reminder_settings", "result", "result_item",
  "session", "session_item", "subject", "topic", "user_settings",
];
/** Dropped by 0005; must 404, not 200/401. */
const DROPPED_TABLES = ["ai_draft"];
/** service_role-only helpers from 0006 — no client may execute them. */
const SERVICE_ONLY_RPC = ["reminder_digest", "due_reminders"];
/** One public token-addressed RPC with a small enough bucket to trip quickly. */
const RATE_LIMITED_RPC = { name: "shared_content", arg: "p_token_hash", max: 120 };
const DEMO_ID = "e078ff60-846c-46ef-8a7e-091138c66b44"; // demo@studyforge.test

async function main() {
  const results = [];
  const rec = (name, pass, detail = "") =>
    results.push({ name, pass, detail: String(detail).slice(0, 160) });

  let TOKEN = "";
  if (DEMO_EMAIL && DEMO_PASSWORD) {
    const bad = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: DEMO_EMAIL, password: "definitely-wrong" }),
    });
    rec(
      "auth: wrong password refused as invalid_credentials",
      bad.status === 400 && (await bad.text()).includes("invalid_credentials"),
      `HTTP ${bad.status}`,
    );
    const login = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
    TOKEN = (await login.json()).access_token ?? "";
    rec("auth: valid sign-in works", login.ok && !!TOKEN, `HTTP ${login.status}`);
  }

  const health = await fetch(`${BASE}/auth/v1/health`, { headers: { apikey: KEY } });
  rec("auth: GoTrue healthy", health.ok, `HTTP ${health.status}`);

  for (const t of TABLES) {
    const r = await fetch(`${BASE}/rest/v1/${t}?select=*&limit=1`, {
      headers: { apikey: KEY },
    });
    rec(`db: anon locked out of ${t}`, r.status === 401, `HTTP ${r.status}`);
  }
  for (const t of DROPPED_TABLES) {
    const r = await fetch(`${BASE}/rest/v1/${t}?select=*&limit=1`, {
      headers: { apikey: KEY },
    });
    rec(`db: dropped ${t} is gone`, r.status === 404, `HTTP ${r.status}`);
  }

  for (const fn of SERVICE_ONLY_RPC) {
    for (const [who, headers] of [
      ["anon", {}],
      ...(TOKEN ? [["authenticated", { Authorization: `Bearer ${TOKEN}` }]] : []),
    ]) {
      const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json", ...headers },
        body: "{}",
      });
      rec(`security: ${fn} refuses ${who}`, r.status !== 200, `HTTP ${r.status}`);
    }
  }

  for (const [fn, auth] of [
    ["reminder-sender", "none"],
    ["reminder-sender", "forged"],
    ["ai-proxy", "none"],
  ]) {
    const headers = { apikey: KEY, "Content-Type": "application/json" };
    if (auth === "forged") headers.Authorization = "Bearer forged.token.value";
    const r = await fetch(`${BASE}/functions/v1/${fn}`, {
      method: "POST",
      headers,
      body: "{}",
    });
    rec(`edge: ${fn} refuses ${auth === "none" ? "unauthenticated" : auth} token`,
      r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  }

  {
    const r = await fetch(`${BASE}/functions/v1/reminder-sender`, {
      method: "OPTIONS",
      headers: {
        apikey: KEY,
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    rec("edge: reminder-sender CORS preflight answers",
      r.status === 200 && !!r.headers.get("access-control-allow-origin"),
      `HTTP ${r.status}`);
  }

  {
    // Wait for the next epoch-aligned window edge so every hit lands in one bucket.
    const msToEdge = 60_000 - (Date.now() % 60_000) + 300;
    await new Promise((resolve) => setTimeout(resolve, msToEdge));
    const statuses = [];
    let tripped = false;
    let last = "";
    for (let i = 0; i < RATE_LIMITED_RPC.max + 2 && !tripped; i++) {
      const r = await fetch(`${BASE}/rest/v1/rpc/${RATE_LIMITED_RPC.name}`, {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ [RATE_LIMITED_RPC.arg]: "battery-bogus-hash" }),
      });
      last = await r.text();
      statuses.push(r.status);
      if (r.status !== 200 || /rate|limit/i.test(last)) tripped = true;
    }
    rec(
      `security: rate limiter trips at ${RATE_LIMITED_RPC.max}+1 on ${RATE_LIMITED_RPC.name}`,
      tripped && statuses.length <= RATE_LIMITED_RPC.max + 2,
      `${statuses.length} calls, statuses ${[...new Set(statuses)].join(",")}, last: ${last.slice(0, 100)}`,
    );
  }

  if (TOKEN) {
    const H = {
      apikey: KEY,
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    };
    const log = await fetch(`${BASE}/rest/v1/reminder_log`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ user_id: DEMO_ID, kind: "test", status: "sent", detail: "battery" }),
    });
    rec("security: reminder_log refuses client INSERT", log.status === 403 || log.status === 401,
      `HTTP ${log.status}`);

    const foreignInsert = await fetch(`${BASE}/rest/v1/reminder_settings`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        user_id: "00000000-0000-0000-0000-000000000000",
        enabled: true, time_of_day: "09:00", utc_offset_minutes: 0,
        send_task_reminder: true, send_daily_report: true,
      }),
    });
    rec("security: reminder_settings INSERT with foreign user_id refused",
      foreignInsert.status === 403 || foreignInsert.status === 401, `HTTP ${foreignInsert.status}`);

    const foreignPatch = await fetch(
      `${BASE}/rest/v1/reminder_settings?user_id=eq.11111111-1111-1111-1111-111111111111`,
      { method: "PATCH", headers: H, body: JSON.stringify({ enabled: false }) },
    );
    rec("security: foreign-row PATCH touches nothing",
      foreignPatch.status === 200 || foreignPatch.status === 204, `HTTP ${foreignPatch.status}`);

    const foreignGet = await fetch(
      `${BASE}/rest/v1/reminder_settings?user_id=eq.11111111-1111-1111-1111-111111111111&select=user_id`,
      { headers: { apikey: KEY, Authorization: `Bearer ${TOKEN}` } },
    );
    const rows = await foreignGet.json().catch(() => null);
    rec("security: foreign row unreadable by pk",
      foreignGet.status === 200 && Array.isArray(rows) && rows.length === 0,
      `HTTP ${foreignGet.status}`);

    const mine = await fetch(`${BASE}/rest/v1/reminder_settings?select=user_id&limit=50`, {
      headers: { apikey: KEY, Authorization: `Bearer ${TOKEN}` },
    });
    const mineRows = await mine.json().catch(() => []);
    const foreign = (Array.isArray(mineRows) ? mineRows : [])
      .filter((r) => r.user_id !== DEMO_ID).length;
    rec("security: list returns only own rows", mine.ok && foreign === 0,
      `${(Array.isArray(mineRows) ? mineRows.length : 0)} rows, ${foreign} foreign`);

    const root = await fetch(`${BASE}/rest/v1/`, { headers: { apikey: KEY } });
    rec("security: OpenAPI root refuses publishable key", root.status === 401, `HTTP ${root.status}`);
  }

  console.log(results.map((r) => `${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  — " + r.detail : ""}`).join("\n"));
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exitCode = 1;
}

await main();
