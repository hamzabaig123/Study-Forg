/**
 * StudyForge auth-mail probe — the credential-free way to find out whether the
 * SMTP sender behind GoTrue (Supabase Auth) actually works.
 *
 * Why this is the check that matters for email verification and password reset:
 * both are sent by GoTrue, and GoTrue answers SMTP failures *on the request*.
 * A broken relay (wrong key type, wrong port, unverified sender, quota spent)
 * comes back as HTTP 500 carrying the provider's own words. A working one
 * comes back as HTTP 200 and you go look in the inbox. No dashboard, no admin
 * token, no guessing.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ANON_KEY=<publishable key> \
 *   AUTH_TEST_EMAIL=<an address that already has a StudyForge account> \
 *   node supabase/e2e/auth-mail-check.mjs
 *
 * What it does and does not touch: it asks GoTrue for a password-recovery mail
 * for the one address named in AUTH_TEST_EMAIL. It creates no account, writes
 * no content rows, and sends mail to exactly one address — yours. The recovery
 * link it generates expires on its own; leaving it unused changes nothing.
 *
 * AUTH_TEST_EMAIL has to be an address that already exists, because GoTrue
 * deliberately answers a recovery request for an unknown address with the same
 * 200 it gives for a known one (so a stranger cannot enumerate accounts) and
 * sends nothing. Testing a made-up address proves nothing and would hide a
 * broken relay behind a green result.
 *
 * Exit 0 = the mailer took the job. Exit 1 = it refused, and the reason is
 * printed. Exit 2 = the script could not run (missing input).
 */
const BASE = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_ANON_KEY ?? "";
const EMAIL = process.env.AUTH_TEST_EMAIL ?? "";

if (!BASE || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY are required.");
  process.exitCode = 2;
} else if (!EMAIL || !EMAIL.includes("@")) {
  console.error(
    "AUTH_TEST_EMAIL must be an address that already has an account here.\n" +
      "An unknown address answers 200 without sending anything, so it cannot prove the relay.",
  );
  process.exitCode = 2;
}

/** True when the text reads like an SMTP or mail-provider refusal. */
function looksLikeMailFailure(text) {
  return /smtp|mail|sender|relay|brevo|resend|quota|denied|authentication/i.test(
    text,
  );
}

const GUIDANCE = [
  "GoTrue reports an SMTP failure on the request itself. Read the message above",
  "against these, in the order they actually happen:",
  "  1. SMTP password vs API key — the relay wants the *SMTP key* Brevo shows on",
  "     its SMTP & Sender page; the API key is a different string and produces an",
  "     authentication failure that looks like a wrong password.",
  "  2. Port vs TLS mode — 587 needs STARTTLS, 2465 needs SSL. Supabase's",
  "     dashboard has one toggle for this and the wrong pairing times out.",
  "  3. Sender address — must be a domain (or address) you verified with the",
  "     provider. An unverified From is refused before anything is queued.",
  "  4. Daily quota — a free tier that is spent answers with a quota error, not a",
  "     connection error, and it clears at midnight UTC.",
];

async function health() {
  const res = await fetch(`${BASE}/auth/v1/health`, {
    headers: { apikey: KEY },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, version: body?.version ?? "unknown" };
}

/** Ask GoTrue to send this account's recovery mail, and classify what it says. */
async function recover() {
  const started = Date.now();
  const res = await fetch(`${BASE}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ email: EMAIL }),
  });
  const text = await res.text().catch(() => "");
  return { status: res.status, text, ms: Date.now() - started };
}

async function main() {
  // A rejected configuration already printed its own reason; do not turn it into
  // a fetch error on top of that.
  if (process.exitCode === 2) return;
  const { status, version } = await health();
  console.log(`GoTrue ${version} — health HTTP ${status}`);
  if (status !== 200) {
    console.error(
      "The auth service itself is not answering, so mail is the least of it.",
    );
    process.exitCode = 1;
    return;
  }

  const { status: code, text, ms } = await recover();
  console.log(`POST /auth/v1/recover -> HTTP ${code} in ${ms} ms`);
  if (text.trim()) console.log(text.trim().slice(0, 600));

  if (code === 429) {
    console.error(
      "\nRate limited. Recovery mail is throttled per address per hour, so this\n" +
        "is a stop sign, not a retry loop — wait for the window and run it once.\n" +
        "A 429 says nothing about the relay: the request never reached the mailer.",
    );
    process.exitCode = 1;
    return;
  }

  if (code >= 500) {
    if (looksLikeMailFailure(text)) {
      console.error("\nThe mailer refused the send. " + GUIDANCE.join("\n"));
      process.exitCode = 1;
      return;
    }
    console.error("\nGoTrue failed without naming the mailer — check the function logs.");
    process.exitCode = 1;
    return;
  }

  if (code === 400 || code === 401 || code === 403 || code === 404) {
    // Not an SMTP shape: the request itself was refused (bad key, or the email
    // provider feature is off). Nothing was sent and nothing was proven.
    console.error(
      "\nGoTrue refused the request before any mail was queued. Confirm the\n" +
        "publishable key belongs to this project and that Email is an enabled\n" +
        "provider under Authentication → Sign In / Providers.",
    );
    process.exitCode = 1;
    return;
  }

  // 200 with no SMTP error: the mailer accepted the job. Only the inbox closes
  // the loop, and it closes it on four things this script cannot see.
  console.log(`\nAccepted — the request reached the mailer and no SMTP error came back.`);
  console.log(`Now open ${EMAIL} and check all four, not just "did it arrive":`);
  console.log(
    [
      "  1. Inbox *and* Spam. A message that only ever lands in Spam is a failure",
      "     with a longer fuse: it says the credentials work and the identity does",
      "     not (SPF/DKIM/DMARC, or an unverified sender).",
      '  2. The "via …" label next to the sender name. It should name your own',
      "     domain. If it says supabase.co, GoTrue is still on the built-in sender",
      "     and the SMTP settings were never saved.",
      "  3. The button's link host. It must be the Site URL you deployed, or the",
      "     link opens a page that cannot consume the token.",
      "  4. If it is in Spam, open Gmail's Show original panel and read",
      "     \"Encryption and delivery\" — it names the failing check, which is the",
      "     one thing no server log tells you.",
    ].join("\n"),
  );
  process.exitCode = 0;
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
