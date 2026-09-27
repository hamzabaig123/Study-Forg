// StudyForge reminder-sender — the server half of the daily digest.
//
// Two callers:
//   • a pg_cron tick (every 10 minutes, service-role bearer): finds every
//     account whose local time has reached its configured send time today and
//     whose digest has not gone out yet, then builds and sends each one.
//   • a signed-in user pressing "Send a test now": same pipeline, addressed to
//     the caller, without touching last_sent_on.
//
// Email goes out through Resend (https://resend.com, free tier); the key is a
// deploy-time secret. Recipient = the account's sign-in email — nobody pastes
// anything, and the address is whatever they verified at sign-up.
//
// Deploy (Management API or CLI):
//   supabase functions deploy reminder-sender --project-ref <ref>
//   supabase secrets set RESEND_API_KEY=... --project-ref <ref>
//   optional: RESEND_FROM="StudyForge <notices@yourdomain.com>" (default:
//   "StudyForge <onboarding@resend.dev>", which Resend restricts to the
//   account owner's own address until a domain is verified)
//
// Schedule (SQL editor / apply-migration lane) — see 0006's due_reminders().

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const BRAND_DEEP = "#8a4a1d";
const BRAND = "#b85c24";
const BRAND_PALE = "#f6ede3";
const INK = "#2c2926";
const MUTED = "#6b6661";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Resolve one bearer token to its account via GoTrue, or null when dead. */
async function getAuthUser(
  bearer: string,
): Promise<{ id: string; email: string } | null> {
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  try {
    const res = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as
      | { id?: string; email?: string }
      | null;
    if (!payload || typeof payload.id !== "string") return null;
    return { id: payload.id, email: payload.email ?? "" };
  } catch {
    return null;
  }
}

interface Digest {
  accuracyPercent: number;
  correct: number;
  answered: number;
  streak: number;
  best: number;
  testsToday: number;
  questionsToday: number;
  questionBank: number;
}

/** The numbers the email shows, computed from the account's own results. */
async function buildDigest(
  owner: string,
  utcOffsetMinutes: number,
): Promise<Digest> {
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetch(`${baseUrl}/rest/v1/rpc/reminder_digest`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ p_owner: owner, p_offset_minutes: utcOffsetMinutes }),
  });
  if (!res.ok) {
    throw new Error(`digest query failed (HTTP ${res.status})`);
  }
  const row = (await res.json())[0] as Record<string, number> | undefined;
  return {
    accuracyPercent: Number(row?.accuracy_percent ?? 0),
    correct: Number(row?.correct ?? 0),
    answered: Number(row?.answered ?? 0),
    streak: Number(row?.streak ?? 0),
    best: Number(row?.best ?? 0),
    testsToday: Number(row?.tests_today ?? 0),
    questionsToday: Number(row?.questions_today ?? 0),
    questionBank: Number(row?.question_bank ?? 0),
  };
}

function statCell(label: string, value: string): string {
  return `<td style="padding:0 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6f0;border:1px solid #e8e0d4;border-radius:10px;">
      <tr><td style="padding:14px 12px 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};">${esc(label)}</td></tr>
      <tr><td style="padding:0 12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:700;color:${INK};">${esc(value)}</td></tr>
    </table>
  </td>`;
}

/** The premium email: brand band, stat cards, streak line, CTA. The account's
 * reminder flags decide which sections appear. */
function renderEmail(
  digest: Digest,
  appUrl: string,
  name: string,
  includeTask: boolean,
  includeReport: boolean,
): string {
  const accuracy = `${digest.accuracyPercent.toFixed(0)}%`;
  const streakLine =
    digest.streak > 0
      ? `A ${digest.streak}-day streak (best ${digest.best}). One short test keeps it alive.`
      : `No streak yet — one test today starts one, and tomorrow it counts.`;
  const taskLine =
    digest.questionBank > 0
      ? `${digest.questionBank.toLocaleString("en-US")} questions are waiting in your library.`
      : `Your library is empty — build a set in the app and it will show up here.`;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#efe9df;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe9df;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2d9cb;">
    <tr><td style="background:${BRAND_DEEP};padding:26px 30px;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2.4px;text-transform:uppercase;color:#f0d9c2;">StudyForge</p>
      <h1 style="margin:8px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;color:#ffffff;">Your daily progress</h1>
    </td></tr>
    <tr><td style="background:${BRAND};height:4px;">&nbsp;</td></tr>
    <tr><td style="padding:26px 30px 6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${INK};">
      ${esc(name ? `Hi ${name},` : "Hi,")}
      <p style="margin:10px 0 0;color:${MUTED};line-height:1.55;">Here is where your preparation stands today.</p>
    </td></tr>
    <tr><td style="padding:12px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${statCell("Accuracy", accuracy)}
          ${statCell("Day streak", String(digest.streak))}
          ${statCell("Answered", digest.answered.toLocaleString("en-US"))}
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:8px 30px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};line-height:1.6;">
      <p style="margin:0 0 8px;">🔥 ${esc(streakLine)}</p>
      ${includeTask ? `<p style="margin:0 0 8px;">✉️ ${esc(taskLine)}</p>` : ""}
      ${includeReport ? `<p style="margin:0 0 4px;color:${MUTED};">Today: ${digest.testsToday} ${digest.testsToday === 1 ? "test" : "tests"}, ${digest.questionsToday} questions answered.</p>` : ""}
    </td></tr>
    <tr><td style="padding:22px 30px 30px;" align="center">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:${BRAND};border-radius:999px;">
          <a href="${appUrl}/dashboard" style="display:inline-block;padding:12px 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Continue studying</a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="background:${BRAND_PALE};padding:16px 30px;border-top:1px solid #e2d9cb;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};line-height:1.5;">
        You receive this because daily reminders are on in your StudyForge settings.
        Change the time or turn it off in Settings → Reminders.
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function plainText(digest: Digest, appUrl: string): string {
  return [
    `Accuracy ${digest.accuracyPercent.toFixed(0)}% (${digest.correct}/${digest.answered} correct)`,
    `Day streak ${digest.streak} (best ${digest.best})`,
    `Today: ${digest.testsToday} tests, ${digest.questionsToday} questions answered`,
    "",
    appUrl,
  ].join("\n");
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    throw new Error(
      "RESEND_API_KEY is not set on this project — add it under Edge Functions → Secrets.",
    );
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM") ?? "StudyForge <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      body.trim().slice(0, 200) || `Resend answered HTTP ${res.status}`,
    );
  }
}

interface DueSetting {
  user_id: string;
  time_of_day: string;
  utc_offset_minutes: number;
  send_task_reminder: boolean;
  send_daily_report: boolean;
  email: string;
  display_name: string;
}

async function logAttempt(
  owner: string,
  kind: "daily" | "test",
  status: "sent" | "failed",
  detail: string,
): Promise<void> {
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  await fetch(`${baseUrl}/rest/v1/reminder_log`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ user_id: owner, kind, status, detail }),
  }).catch(() => undefined);
}

/** Sends one digest and records it. Returns the failure reason, if any. */
async function deliver(
  appUrl: string,
  setting: DueSetting,
  kind: "daily" | "test",
): Promise<string | null> {
  try {
    const digest = await buildDigest(
      setting.user_id,
      setting.utc_offset_minutes,
    );
    const subject =
      digest.testsToday > 0 || digest.accuracyPercent === 0
        ? "StudyForge — your daily study progress"
        : `StudyForge — ${digest.accuracyPercent.toFixed(0)}% accuracy, ${digest.streak}-day streak`;
    const html = renderEmail(
      digest,
      appUrl,
      setting.display_name,
      setting.send_task_reminder,
      setting.send_daily_report,
    );
    await sendEmail(
      setting.email,
      subject,
      html,
      plainText(digest, appUrl),
    );
    await logAttempt(setting.user_id, kind, "sent", subject);
    return null;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    await logAttempt(setting.user_id, kind, "failed", detail);
    return detail;
  }
}

function todayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (request.method !== "POST") {
    return json({ error: { message: "Use POST." } }, 405);
  }

  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const appUrl = Deno.env.get("APP_URL") ?? baseUrl;
  const bearer =
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  let body: { test?: boolean } = {};
  try {
    body = (await request.json()) as { test?: boolean };
  } catch {
    body = {};
  }

  // A cron tick carries the service key; a user carries their own session.
  // `bearer` above has already had its "Bearer " scheme stripped, so this is a
  // bare-token comparison — against the prefixed form no tick would ever match.
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const isCron = cronSecret !== "" && bearer === cronSecret;
  let user: { id: string; email: string } | null = null;
  if (!isCron) {
    user = bearer ? await getAuthUser(bearer) : null;
    if (!user) {
      return json(
        { error: { message: "Sign in to use the reminder service." } },
        401,
      );
    }
  }

  let due: DueSetting[] = [];
  if (isCron) {
    // Everything due right now, straight from the definer helper.
    const res = await fetch(`${baseUrl}/rest/v1/rpc/due_reminders`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      return json(
        { error: { message: "Could not read due reminders." } },
        502,
      );
    }
    due = (await res.json()) as DueSetting[];
  } else {
    // A single account, for the settings page's test button.
    const res = await fetch(
      `${baseUrl}/rest/v1/reminder_settings?user_id=eq.${user!.id}`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      },
    );
    const rows = res.ok
      ? ((await res.json()) as DueSetting[])
      : [];
    if (rows.length === 0 || !rows[0].enabled) {
      return json(
        {
          error: {
            message:
              "Daily reminders are not turned on yet — enable them first.",
          },
        },
        400,
      );
    }
    due = [{ ...rows[0], email: user!.email }];
  }

  const results: Array<{
    email: string;
    status: string;
    detail?: string;
  }> = [];
  for (const setting of due) {
    const kind = isCron ? "daily" : "test";
    const failure = await deliver(appUrl, setting, kind);
    results.push({
      email: setting.email.replace(/(.{2}).+(@.*)/, "$1***$2"),
      status: failure ? "failed" : "sent",
      detail: failure ?? undefined,
    });
    // The daily run stamps the account's local day so the tick stays quiet
    // until tomorrow even if it fires twice inside the window. A test send
    // never touches the marker.
    if (isCron && !failure) {
      await fetch(
        `${baseUrl}/rest/v1/reminder_settings?user_id=eq.${setting.user_id}`,
        {
          method: "PATCH",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            last_sent_on: todayKey(
              Date.now() + setting.utc_offset_minutes * 60_000,
            ),
          }),
        }).catch(() => undefined);
    }
  }

  return json({ ok: true, results });
});
