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

/**
 * True when the relay refused the *recipient* rather than the *sender*.
 *
 * This distinction is the whole difference between a broken configuration and a
 * successful one: to be told "no such mailbox" the relay must already have
 * authenticated you and accepted the message for delivery. A probe addressed to
 * a reserved test domain therefore proves the SMTP settings while still failing
 * to deliver anywhere.
 */
function looksLikeRecipientFailure(text) {
  return /5\d\d.*(recipient|user|mailbox|address)|no such (user|mailbox|domain)|user unknown|does not exist|invalid (recipient|domain)|unresolvable|domain (not found|does not exist)|nodomain/i.test(
    text,
  );
}

const GUIDANCE = [
  "GoTrue reports an SMTP failure on the request itself. Read the message above",
  "against these, in the order they actually happen:",
  "  1. SMTP password vs API key — the relay wants the *SMTP key* Brevo shows on",
  "     its SMTP & Sender page; the API key is a different string and produces an",
  "     authentication failure that looks like a wrong password.",
  "  2. Port vs TLS mode — 587 with STARTTLS is the only pairing measured to\n" +
  "     complete against smtp-relay.brevo.com (see supabase/README.md). The\n" +
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
  try {
    const res = await fetch(`${BASE}/auth/v1/recover`, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ email: EMAIL }),
    });
    const text = await res.text().catch(() => "");
    return { status: res.status, text, ms: Date.now() - started };
  } catch (cause) {
    // A client-side ceiling is the same finding as a gateway one: the request
    // was accepted and nothing came back. Report it as status 0 so the transport
    // branch explains it instead of a stack line pretending otherwise.
    const ms = Date.now() - started;
    const named = cause instanceof Error ? cause.name : "";
    if (named === "TimeoutError" || named === "AbortError") {
      return { status: 0, text: `timed out after ${ms} ms`, ms };
    }
    throw cause;
  }
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
  console.log(
    `POST /auth/v1/recover -> ${code === 0 ? "no answer" : `HTTP ${code}`} in ${ms} ms`,
  );
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

  if (code !== 200 && looksLikeRecipientFailure(text)) {
    // The relay authenticated the sender, accepted the message, and only then
    // refused the destination — which is exactly what a reserved test domain
    // such as `.test` does. Configuration is proven; placement is not.
    console.log(
      "\nThe relay TOOK the message and refused only the destination address, so\n" +
        "the SMTP settings are working: authentication, port/TLS and sender all\n" +
        "passed. This address cannot receive mail by design, so nothing further\n" +
        "is proven — repeat with an address you can open to check Gmail placement.",
    );
    process.exitCode = 0;
    return;
  }

  // A gateway giving up on GoTrue is a different failure from GoTrue giving up
  // on the relay, and the difference is the diagnosis: refused credentials come
  // back fast and specific, while a port that expects the other TLS mode (or an
  // outbound connection being silently dropped) just hangs until something
  // loses patience — usually the platform, in GoTrue's favour.
  if (code === 0 || code === 504 || /upstream request timeout|timed ?out/i.test(text)) {
    console.error(
      "\nGoTrue accepted the request and never came back. That is the shape of a\n" +
        "transport problem, not an authentication problem — a wrong key or a spent\n" +
        "quota is refused in a fraction of a second with a 535/550 line. In order:\n" +
        "  1. Port vs TLS mode. Use 587 with STARTTLS. 2465 was measured from this\n" +
        "     project's network as a silent drop — no banner, no refusal, just a\n" +
        "     hang — so a mismatched pair neither succeeds nor fails; it stalls,\n" +
        "     which is what a 504 after tens of seconds means.\n" +
        "  2. Host spelling — `smtp-relay.brevo.com`, with no scheme, no port\n" +
        "     suffix and no trailing space from the copy/paste.\n" +
        "  3. Anything still pointing at port 25: relay hosts drop it silently and\n" +
        "     the symptom is the same hang.\n" +
        "Until this answers quickly, no verification or reset mail is leaving the\n" +
        "project, and each attempt costs the user a thirty-second wait.",
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
