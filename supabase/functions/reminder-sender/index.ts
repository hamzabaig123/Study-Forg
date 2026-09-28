// StudyForge reminder-sender — the server half of the daily digest.
//
// Two callers:
//   • a pg_cron tick (every 10 minutes, bearer = CRON_SECRET): finds every
//     account whose local time has reached its configured send time today and
//     whose digest has not gone out yet, then builds and sends each one.
//   • the signed-in user's own browser, which POSTs its session token with
//     either { "daily": true } — the in-app scheduler at the chosen time, which
//     may consume the day — or { "daily": false } — the settings page's test
//     button, which never stamps last_sent_on.
//
// Delivery is a chain, first channel that succeeds wins:
//   1. Web push (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) — instant, free, reaches
//      a closed desktop; the browser's subscriptions live in
//      push_subscriptions (migration 0009).
//   2. Email via Brevo (BREVO_API_KEY + BREVO_FROM, a verified sender) —
//      300/day free and the sender that lands in Gmail.
//   3. Email via Resend (RESEND_API_KEY, optional RESEND_FROM) — the original
//      transport, kept as the fallback it has always been.
//   reminder_log's detail names the channel that actually carried each digest.
//
// Recipient = the account's sign-in email — nobody pastes anything, and the
// address is whatever they verified at sign-up.
//
// Deploy (Management API or CLI):
//   supabase functions deploy reminder-sender --project-ref <ref>
//   supabase secrets set RESEND_API_KEY=... --project-ref <ref>
//   optional: RESEND_FROM="StudyForge <notices@yourdomain.com>" (default:
//   "StudyForge <onboarding@resend.dev>", which Resend restricts to the
//   account owner's own address until a domain is verified)
//   also: APP_URL=<deployed origin> (the email's CTA and the push's landing
//   URL); CRON_SECRET=<tick bearer>, required only once the pg_cron tick is
//   scheduled
//   the newer channels: BREVO_API_KEY + BREVO_FROM=<verified sender email>
//   (auth emails ride Brevo too, as Supabase's custom SMTP — see
//   supabase/README.md → The reminder pipeline); VAPID_PUBLIC_KEY +
//   VAPID_PRIVATE_KEY to arm web push
//
// Schedule (SQL editor): the `cron.schedule` snippet lives in
// supabase/README.md → The reminder pipeline. due_reminders() (migration 0006)
// decides who is due; nothing in the schema schedules the tick itself.

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

/** The mail chain, priority order. Brevo stands first: 300 emails/day free and
 * a sender that can carry a verified domain, which is what lands mail in
 * Gmail's inbox. Resend keeps its place as the fallback it has always been.
 * A transport is skipped entirely when its secret is absent, and each failure
 * is tagged so `reminder_log` shows exactly which one answered. */
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<"brevo" | "resend"> {
  const attempts: string[] = [];
  try {
    return await sendViaBrevo(to, subject, html, text);
  } catch (cause) {
    attempts.push(cause instanceof Error ? cause.message : String(cause));
  }
  try {
    return await sendViaResend(to, subject, html, text);
  } catch (cause) {
    attempts.push(cause instanceof Error ? cause.message : String(cause));
  }
  throw new Error(attempts.join(" | "));
}

async function sendViaBrevo(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<"brevo"> {
  const key = Deno.env.get("BREVO_API_KEY");
  const from = Deno.env.get("BREVO_FROM");
  if (!key || !from) {
    throw new Error(
      "brevo: skipped — BREVO_API_KEY/BREVO_FROM is not set on this project",
    );
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": key,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      sender: { name: "StudyForge", email: from },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `brevo: ${body.trim().slice(0, 200) || `HTTP ${res.status}`}`,
    );
  }
  return "brevo";
}

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<"resend"> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    throw new Error(
      "resend: skipped — RESEND_API_KEY is not set on this project",
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
      `resend: ${body.trim().slice(0, 200) || `HTTP ${res.status}`}`,
    );
  }
  return "resend";
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

/** What `reminder_settings` actually stores: the preference, and nothing that
 * identifies a person. Reading it as a `DueSetting` produced a digest with no
 * name and no address. */
interface StoredSettings {
  user_id: string;
  enabled: boolean;
  time_of_day: string;
  utc_offset_minutes: number;
  send_task_reminder: boolean;
  send_daily_report: boolean;
}

/** The greeting name, resolved the same way `due_reminders()` does it: the
 * account's display name, else the local part of its address. `user_settings`
 * is optional, so a missing row or a failed read falls through to the email. */
async function displayNameFor(userId: string, email: string): Promise<string> {
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  try {
    const res = await fetch(
      `${baseUrl}/rest/v1/user_settings?select=display_name&owner_id=eq.${userId}`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const rows = res.ok
      ? ((await res.json()) as Array<{ display_name?: string | null }>)
      : [];
    const name = rows[0]?.display_name?.trim();
    if (name) return name;
  } catch {
    // Fall through: the address is a perfectly good greeting.
  }
  return email.split("@")[0] ?? "";
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

/* -------------------------------------------------------------------------- */
/* Web push — the instant channel, tried before email                         */
/*                                                                            */
/* A push subscription is per browser (endpoint + the browser's own keys), so  */
/* "installed" means one row per device. Delivery costs nothing and it reaches */
/* the desktop even with the app closed, which is exactly the gap email has.  */
/* The crypto is RFC 8291 `aes128gcm` plus an ES256 VAPID JWT, done with the   */
/* WebCrypto the runtime already ships — no remote import, which the ai-proxy */
/* taught us breaks the boot.                                                 */
/* -------------------------------------------------------------------------- */

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const PUSH_CONTACT = "mailto:studyforge@users.noreply.github.com";

const b64uToBytes = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const bytesToB64u = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const textBytes = (value: string): Uint8Array =>
  new TextEncoder().encode(value);

let cachedSigningKey: CryptoKey | null = null;

/** The account's private VAPID key, rebuilt from `d` plus the `x`/`y` the
 * public key already carries, since the secret stores only the scalar. */
async function vapidSigningKey(): Promise<CryptoKey> {
  if (cachedSigningKey) return cachedSigningKey;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error("push: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY is not set");
  }
  const publicBytes = b64uToBytes(VAPID_PUBLIC_KEY);
  cachedSigningKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToB64u(publicBytes.slice(1, 33)),
      y: bytesToB64u(publicBytes.slice(33, 65)),
      d: bytesToB64u(b64uToBytes(VAPID_PRIVATE_KEY)),
      key_ops: ["sign"],
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return cachedSigningKey;
}

/** RFC 8291: encrypt the payload to the browser's public key so only it can
 * read the message, then hand the push service an un-readable body. */
async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  title: string,
  body: string,
  url: string,
): Promise<void> {
  const payloadBytes = new TextEncoder().encode(
    JSON.stringify({ title, body, url }),
  );
  const userPublicBytes = b64uToBytes(subscription.p256dh);
  const authSecret = b64uToBytes(subscription.auth);

  // A fresh server key pair per message; its public half rides in the header.
  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const serverPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeys.publicKey),
  );
  const userPublic = await crypto.subtle.importKey(
    "raw",
    userPublicBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: userPublic },
      serverKeys.privateKey,
      256,
    ),
  );

  const hkdf = async (
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    bytes: number,
  ): Promise<Uint8Array> =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt, info },
        await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
        bytes * 8,
      ),
    );

  // PRK_key = HKDF(salt=auth, ikm=ECDH, info="WebPush: info" || 0x00 || keys).
  const keyInfo = new Uint8Array(144);
  keyInfo.set(textBytes("WebPush: info"), 0);
  keyInfo[13] = 0x00;
  keyInfo.set(userPublicBytes, 14);
  keyInfo.set(serverPublic, 79);
  const prk = await hkdf(shared, authSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(
    prk,
    salt,
    textBytes("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    prk,
    salt,
    textBytes("Content-Encoding: nonce\0"),
    12,
  );

  // One record: the payload plus the final-record delimiter.
  const record = new Uint8Array(payloadBytes.length + 1);
  record.set(payloadBytes, 0);
  record[payloadBytes.length] = 0x02;
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]),
      record,
    ),
  );

  // Header: salt(16) | record size(4) | key-id length(1) | server public(65).
  const header = new Uint8Array(86);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = serverPublic.length;
  header.set(serverPublic, 21);

  const bodyBytes = new Uint8Array(header.length + ciphertext.length);
  bodyBytes.set(header, 0);
  bodyBytes.set(ciphertext, header.length);

  // The VAPID JWT: proof that this server owns the key the browser subscribed to.
  const signingKey = await vapidSigningKey();
  const aud = new URL(subscription.endpoint).origin;
  const claims = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: PUSH_CONTACT,
  };
  const encodeSegment = (input: unknown) =>
    bytesToB64u(textBytes(JSON.stringify(input)));
  const unsigned = `${encodeSegment({ typ: "JWT", alg: "ES256" })}.${encodeSegment(claims)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      textBytes(unsigned),
    ),
  );

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${unsigned}.${bytesToB64u(signature)}, k=${VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      "Content-Type": "application/octet-stream",
    },
    body: bodyBytes,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 120);
    throw new Error(`push: ${res.status} ${detail}`);
  }
}

/** Try every push subscription the account owns. Returns null when one of them
 * delivered, otherwise the reasons — the caller falls back to email on those.
 * A browser that dropped its subscription answers 404/410 and its row leaves. */
async function deliverPush(
  owner: string,
  subject: string,
  appUrl: string,
): Promise<string | null> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return "VAPID keys are not set on this project";
  }
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetch(
    `${baseUrl}/rest/v1/push_subscriptions?user_id=eq.${owner}&select=endpoint,p256dh,auth`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!res.ok) {
    return `could not read subscriptions (HTTP ${res.status})`;
  }
  const subs = (await res.json()) as Array<{
    endpoint: string;
    p256dh: string;
    auth: string;
  }>;
  if (subs.length === 0) {
    return "no subscription for this account";
  }
  const failures: string[] = [];
  let delivered = false;
  for (const subscription of subs) {
    try {
      await sendWebPush(
        subscription,
        subject,
        "Your StudyForge digest is ready — open the app to see the numbers.",
        `${appUrl}/dashboard`,
      );
      delivered = true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failures.push(message);
      // A gone endpoint means this browser unsubscribed or rotted — remove it.
      if (/push: 40[41]/.test(message)) {
        await fetch(
          `${baseUrl}/rest/v1/push_subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`,
          {
            method: "DELETE",
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
          },
        ).catch(() => undefined);
      }
    }
  }
  return delivered ? null : failures.join(" | ");
}

/** Sends one digest and records it: web push first, the mail chain as the
 * safety net. Returns the failure reason, if any. */
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
    // Push first: instant, free, and it reaches a closed desktop. Its failure
    // is never fatal — the mail chain below is the safety net, and the log
    // records which channel actually carried the digest.
    const pushFailure = await deliverPush(setting.user_id, subject, appUrl);
    if (pushFailure === null) {
      await logAttempt(setting.user_id, kind, "sent", `${subject} [via push]`);
      return null;
    }
    const via = await sendEmail(
      setting.email,
      subject,
      html,
      plainText(digest, appUrl),
    );
    await logAttempt(
      setting.user_id,
      kind,
      "sent",
      `${subject} [via ${via}] [push skipped: ${pushFailure}]`,
    );
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

  let body: { daily?: boolean } = {};
  try {
    body = (await request.json()) as { daily?: boolean };
  } catch {
    body = {};
  }
  // The app's own scheduler asks for the day's digest; the settings page's test
  // button asks for one right now. Only the first may consume the day.
  const wantsDaily = body.daily === true;

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
    // A single account: the app's own scheduler at the chosen time, or the
    // settings page's test button. `reminder_settings` holds the preference, not
    // the person, so the address and the greeting are filled in separately —
    // reading them with a cast to DueSetting is what used to print "Hi," with no
    // name on every digest that went out while the app happened to be open.
    const res = await fetch(
      `${baseUrl}/rest/v1/reminder_settings?select=user_id,enabled,time_of_day,utc_offset_minutes,send_task_reminder,send_daily_report&user_id=eq.${user!.id}`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    const rows = res.ok ? ((await res.json()) as StoredSettings[]) : [];
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
    due = [
      {
        ...rows[0],
        email: user!.email,
        display_name: await displayNameFor(user!.id, user!.email),
      },
    ];
  }

  const results: Array<{
    email: string;
    status: string;
    detail?: string;
  }> = [];
  for (const setting of due) {
    const kind = isCron || wantsDaily ? "daily" : "test";
    const failure = await deliver(appUrl, setting, kind);
    results.push({
      email: setting.email.replace(/(.{2}).+(@.*)/, "$1***$2"),
      status: failure ? "failed" : "sent",
      detail: failure ?? undefined,
    });
    // The daily run — the cron tick's, or the app's own scheduler asking for
    // the day's digest — stamps the account's local day so the tick stays quiet
    // until tomorrow even if it fires twice inside the window. A test send
    // never touches the marker, which is the whole point of `daily` in the body:
    // a test press at breakfast used to eat that evening's real digest.
    if ((isCron || wantsDaily) && !failure) {
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
