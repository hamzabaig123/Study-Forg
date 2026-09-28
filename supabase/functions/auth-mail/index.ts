// Auth mail, sent through an HTTP API instead of SMTP.
//
// GoTrue's own mailer speaks SMTP only, so a project whose SMTP credential is
// refused cannot send a verification or password-reset email at all — sign-up
// answers `500 "Error sending confirmation email"` and recovery answers
// "Error sending recovery email". A Send Email hook replaces that mailer
// entirely: GoTrue hands this function the token and the resolved redirect, and
// the delivery is ours to choose. The channel chosen here is the same Brevo
// REST credential the daily digest already sends through successfully, with
// Resend behind it — the two are configured as Edge Function secrets for
// `reminder-sender` and are shared by every function in the project.
//
// Secrets (all required unless noted):
//   AUTH_HOOK_SECRET  a long random string, also written into the hook URL as
//                     ?secret=… — see the header comment on `authorized()`
//   BREVO_API_KEY, BREVO_FROM        (first choice; BREVO_FROM must be verified)
//   RESEND_API_KEY, RESEND_FROM      (fallback; RESEND_FROM optional)
//   SUPABASE_URL      provided by the runtime
//
// Deploy, then enable:
//   supabase functions deploy auth-mail --no-verify-jwt --project-ref <ref>
//   Dashboard → Authentication → Hooks → Send Email →
//     https://<ref>.functions.supabase.co/auth-mail?secret=<AUTH_HOOK_SECRET>

interface EmailData {
  token?: string;
  token_hash?: string;
  redirect_to?: string;
  email_action_type?: string;
  site_url?: string;
  token_new?: string;
  token_hash_new?: string;
  old_email?: string;
  new_email?: string;
  provider?: string;
}

interface HookUser {
  id?: string;
  email?: string;
  phone?: string;
  user_metadata?: Record<string, unknown>;
}

interface HookPayload {
  user?: HookUser;
  email_data?: EmailData;
}

interface Copy {
  subject: string;
  badge: string;
  heading: string;
  intro: string;
  cta: string;
  note: string;
  preheader: string;
}

/** The five emails GoTrue can ask for, keyed by the `email_action_type` it
 * actually sends. An unknown type still sends: falling back to a generic
 * "confirm your email" is a degraded email, refusing is a failed sign-up. */
const COPY: Record<string, Copy> = {
  confirmation: {
    subject: "Verify your email to start StudyForge",
    badge: "Confirm your email",
    heading: "You are one step away from your study dashboard",
    intro:
      "Confirm <strong>{email}</strong> as the address for your StudyForge account. Verification keeps your results and notes attached to you — and it is what lets the daily progress digest land in the right inbox.",
    cta: "Verify email address",
    note: "This link is single-use and expires shortly. If it lapses, sign in and choose <strong>Resend confirmation</strong> from the verification screen.",
    preheader: "Confirm {email} to start tracking your study streak.",
  },
  recovery: {
    subject: "Reset your StudyForge password",
    badge: "Password reset",
    heading: "Let's set a new password",
    intro:
      "Someone asked to reset the password for <strong>{email}</strong>. If that was you, choose a new password below.",
    cta: "Choose a new password",
    note: "This link opens once and expires shortly. If you did not ask for a reset, nothing has changed — your password stays exactly as it is.",
    preheader: "Reset the password on {email}.",
  },
  magic_link: {
    subject: "Your StudyForge sign-in link",
    badge: "Sign-in link",
    heading: "Your link is ready",
    intro:
      "Open this link on <strong>{email}</strong> to sign in to StudyForge — no password needed.",
    cta: "Sign in to StudyForge",
    note: "The link is single-use. Request another one from the sign-in screen if this one lapses.",
    preheader: "A sign-in link for {email}.",
  },
  invite: {
    subject: "You are invited to StudyForge",
    badge: "Invitation",
    heading: "Your StudyForge account is waiting",
    intro:
      "An account was created for <strong>{email}</strong>. Confirm the address to open it.",
    cta: "Accept and verify",
    note: "This link expires shortly. If it lapses, ask whoever invited you to send it again.",
    preheader: "An account was made for {email}.",
  },
  email_change: {
    subject: "Confirm your new StudyForge email",
    badge: "Email change",
    heading: "One confirmation left",
    intro:
      "Your StudyForge account is moving to <strong>{email}</strong>. Confirm this address to finish the change.",
    cta: "Confirm new address",
    note: "Until you confirm, the account keeps using the address it has. If you did not start this, change your password.",
    preheader: "Confirm {email} for your StudyForge account.",
  },
  email_change_current: {
    subject: "Confirm the email change on StudyForge",
    badge: "Email change",
    heading: "Confirm from your current address",
    intro:
      "This confirms that <strong>{email}</strong> authorised moving the account to a new address.",
    cta: "Confirm this change",
    note: "If you did not ask to change your email, open StudyForge and change your password now.",
    preheader: "A change was requested for {email}.",
  },
};

const GENERIC: Copy = {
  subject: "Confirm your StudyForge email",
  badge: "Confirm your email",
  heading: "One click left",
  intro: "Confirm <strong>{email}</strong> for your StudyForge account.",
  cta: "Confirm",
  note: "This link is single-use and expires shortly.",
  preheader: "Confirm {email}.",
};

/** `&` and `<` in an address would otherwise break out of the markup, and the
 * address is whatever was typed into the sign-up form. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fill(template: string, email: string): string {
  return template.split("{email}").join(esc(email));
}

/** The URL that spends the token. `type` is GoTrue's own action name and
 * `redirect_to` is the origin GoTrue already accepted, so the link returns the
 * visitor to whichever app origin asked for it. */
export function verificationLink(
  projectUrl: string,
  data: EmailData,
): string | null {
  const token = data.token_hash ?? data.token;
  const type = data.email_action_type;
  if (!token || !type) {
    return null;
  }
  const base = projectUrl.replace(/\/+$/, "");
  if (!base) {
    return null;
  }
  const params = new URLSearchParams({ token, type });
  if (data.redirect_to) {
    params.set("redirect_to", data.redirect_to);
  }
  return `${base}/auth/v1/verify?${params.toString()}`;
}

export function renderHtml(copy: Copy, link: string, email: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f4;">
<div style="display:none;max-height:0;overflow:hidden;">${fill(copy.preheader, email)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f4;">
<tr>
<td align="center" style="padding:32px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
<tr>
<td style="background:linear-gradient(135deg,#f59e0b 0%,#ea580c 100%);border-radius:16px 16px 0 0;padding:26px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="left" style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:0.02em;">StudyForge</td>
<td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#ffedd5;">${esc(copy.badge)}</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="background-color:#ffffff;border:1px solid #e7e5e4;border-top:none;border-radius:0 0 16px 16px;padding:28px 32px 32px;">
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#1c1917;">${esc(copy.heading)}</p>
<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#78716c;line-height:1.6;">${fill(copy.intro, email)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
<tr>
<td align="center" style="background-color:#ea580c;border-radius:12px;">
<a href="${esc(link)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;letter-spacing:0.02em;">${esc(copy.cta)}</a>
</td>
</tr>
</table>
<p style="margin:20px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a8a29e;line-height:1.7;">The button does not work? Paste this link into your browser:<br>
<a href="${esc(link)}" style="color:#b45309;word-break:break-all;">${esc(link)}</a></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
<tr>
<td style="border-left:3px solid #f59e0b;background-color:#fffbeb;border-radius:0 12px 12px 0;padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#78716c;line-height:1.6;">
${fill(copy.note, email)}
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td align="center" style="padding:20px 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a8a29e;line-height:1.7;">
You received this because this address was used for a StudyForge account action.<br>
If that was not you, you can safely ignore this message — nothing changes without the click.
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

export function renderText(copy: Copy, link: string, email: string): string {
  const intro = fill(copy.intro, email).replace(/<\/?strong>/g, "");
  return [
    `StudyForge — ${copy.badge}`,
    "",
    copy.heading,
    intro,
    "",
    `${copy.cta}: ${link}`,
    "",
    fill(copy.note, email).replace(/<\/?strong>/g, ""),
    "",
    "You received this because this address was used for a StudyForge account",
    "action. If that was not you, ignore it — nothing changes without the click.",
  ].join("\n");
}

async function sendViaBrevo(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  const key = Deno.env.get("BREVO_API_KEY");
  const from = Deno.env.get("BREVO_FROM");
  if (!key || !from) {
    throw new Error("brevo: BREVO_API_KEY/BREVO_FROM is not set");
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
}

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    throw new Error("resend: RESEND_API_KEY is not set");
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
}

async function deliver(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<void> {
  const problems: string[] = [];
  try {
    await sendViaBrevo(to, subject, html, text);
    return;
  } catch (cause) {
    problems.push(cause instanceof Error ? cause.message : String(cause));
  }
  try {
    await sendViaResend(to, subject, html, text);
    return;
  } catch (cause) {
    problems.push(cause instanceof Error ? cause.message : String(cause));
  }
  throw new Error(problems.join(" | "));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The hook URL is the only credential here, so a function deployed
 * `--no-verify-jwt` still refuses anybody who cannot quote it. Without this
 * check an open endpoint would let a stranger send password-reset mail to any
 * address from StudyForge's verified sender. */
function authorized(request: Request): boolean {
  const expected = Deno.env.get("AUTH_HOOK_SECRET") ?? "";
  if (!expected) {
    return false;
  }
  const header = request.headers.get("x-auth-hook-secret") ?? "";
  if (header && header === expected) {
    return true;
  }
  const query = new URL(request.url).searchParams.get("secret") ?? "";
  return query === expected;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ error: { http_code: 405, message: "POST only" } }, 405);
  }
  if (!authorized(request)) {
    return json(
      {
        error: {
          http_code: 401,
          message: "AUTH_HOOK_SECRET is unset or the hook URL is wrong",
        },
      },
      401,
    );
  }

  let payload: HookPayload;
  try {
    payload = (await request.json()) as HookPayload;
  } catch {
    return json(
      { error: { http_code: 400, message: "Body is not JSON" } },
      400,
    );
  }

  const data = payload.email_data ?? {};
  const email = (payload.user?.email ?? "").trim();
  if (!email) {
    return json(
      { error: { http_code: 400, message: "No address in the hook payload" } },
      400,
    );
  }

  const link = verificationLink(Deno.env.get("SUPABASE_URL") ?? "", data);
  if (!link) {
    return json(
      {
        error: {
          http_code: 400,
          message: "email_data is missing token_hash or email_action_type",
        },
      },
      400,
    );
  }

  const type = data.email_action_type ?? "";
  const copy = COPY[type] ?? GENERIC;
  try {
    await deliver(
      email,
      copy.subject,
      renderHtml(copy, link, email),
      renderText(copy, link, email),
    );
  } catch (cause) {
    // GoTrue reads a non-2xx as "the mail did not go out", which is the honest
    // answer: the visitor gets an error on screen instead of a silent wait for
    // an email that will never arrive.
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error("auth-mail: refused", { email, type, message });
    return json(
      { error: { http_code: 502, message: message.slice(0, 300) } },
      502,
    );
  }

  console.log("auth-mail: sent", { email, type });
  return json({});
});
