/**
 * Runs supabase/functions/auth-mail/index.ts without Deno.
 *
 * The function is a Supabase Send Email hook: GoTrue stops using SMTP and POSTs
 * `{ user, email_data }` at it instead. This machine has no Deno and no way to
 * deploy the function, so the only way to know the hook is correct is to drive
 * its real source with a shimmed global and synthetic GoTrue payloads.
 *
 *   node supabase/e2e/auth-mail-hook-check.mjs
 *
 * It never touches the network: every provider call is intercepted, so a green
 * run means the function *would* have called Brevo (then Resend) with the right
 * address, subject and link — not that a mail was sent.
 * Exit 0 = every assertion held. Exit 1 = one failed, named below.
 */

const PROJECT_URL = "https://project-ref.supabase.co";
const HOOK_SECRET = "unit-test-hook-secret";
const BREVO = "https://api.brevo.com/v3/smtp/email";
const RESEND = "https://api.resend.com/emails";

const failures = [];
let calls = [];
let env = {};

function resetEnv(overrides) {
  env = {
    SUPABASE_URL: PROJECT_URL,
    AUTH_HOOK_SECRET: HOOK_SECRET,
    BREVO_API_KEY: "xkeysib-test",
    BREVO_FROM: "mail@studyforge.test",
    RESEND_API_KEY: "re_test",
    ...overrides,
  };
}

/** Stand in for the provider: record the call, answer with `status`. */
function fakeProviders(status, failingHost) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), headers: init?.headers, body });
    const refused = !failingHost || String(url).includes(failingHost);
    return new Response(
      JSON.stringify({ message: refused ? `HTTP ${status}` : "not reached" }),
      { status: refused ? status : 200 },
    );
  };
}

function check(label, ok, detail) {
  if (ok) {
    console.log("  pass  " + label);
    return;
  }
  failures.push(label);
  console.log("  FAIL  " + label + (detail ? "\n        " + detail : ""));
}

// `Deno.serve` is the only entry point the file uses, so capturing its handler
// is enough to drive every branch.
let handler = null;
globalThis.Deno = {
  env: { get: (name) => env[name] ?? null },
  serve: (fn) => {
    handler = fn;
  },
};

const moduleUrl = new URL("../functions/auth-mail/index.ts", import.meta.url);
const mod = await import(moduleUrl.href);

const hook = (path, body, headers = {}) =>
  handler(
    new Request("http://localhost" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

const signup = (overrides = {}) => ({
  user: { id: "u1", email: "ada@example.com" },
  email_data: {
    token: "plain-token",
    token_hash: "hashed-token",
    email_action_type: "confirmation",
    redirect_to: "https://app.example.com/verify-email?email=ada%40example.com",
    site_url: "https://app.example.com",
    ...overrides,
  },
});

console.log("\nGoTrue's own contract: the link the email must carry");
const link = mod.verificationLink(PROJECT_URL, signup().email_data);
check(
  "the verify endpoint, the hashed token and GoTrue's action type",
  link ===
    `${PROJECT_URL}/auth/v1/verify?token=hashed-token&type=confirmation` +
      "&redirect_to=https%3A%2F%2Fapp.example.com%2Fverify-email%3Femail%3Dada%2540example.com",
  link,
);
check(
  "a payload with no token is refused rather than mailed as a dead link",
  mod.verificationLink(PROJECT_URL, { email_action_type: "confirmation" }) ===
    null,
);

console.log("\nThe hook URL is the only credential");
resetEnv({});
fakeProviders(201);
let res = await hook("/auth-mail?secret=wrong", signup());
check("a wrong secret answers 401 and mails nobody", res.status === 401 && calls.length === 0, String(res.status));
res = await hook("/auth-mail", signup());
check("no secret at all answers 401", res.status === 401);
res = await hook("/auth-mail?secret=" + HOOK_SECRET, signup(), {
  "x-auth-hook-secret": HOOK_SECRET,
});
check("the secret is also accepted as a header", res.status === 200);
resetEnv({ AUTH_HOOK_SECRET: "" });
res = await hook("/auth-mail?secret=" + HOOK_SECRET, signup());
check(
  "an unset AUTH_HOOK_SECRET refuses everything — a blank secret must not open the endpoint",
  res.status === 401,
);

console.log("\nA confirmed send");
resetEnv({});
fakeProviders(201);
res = await hook("/auth-mail?secret=" + HOOK_SECRET, signup());
const sent = calls[0];
check("200 with an empty body is what GoTrue reads as sent", res.status === 200 && (await res.text()) === "{}");
check("Brevo is tried first", sent?.url === BREVO);
check("the mail goes to the account address", sent?.body?.to?.[0]?.email === "ada@example.com");
check("from the verified sender, bare", sent?.body?.sender?.email === "mail@studyforge.test");
check("with the signup subject", sent?.body?.subject === "Verify your email to start StudyForge", sent?.body?.subject);
check(
  "the button, the fallback href and the visible paste-in URL all carry the token",
  (sent?.body?.htmlContent.match(/token=hashed-token/g) || []).length === 3,
  String((sent?.body?.htmlContent.match(/token=hashed-token/g) || []).length),
);
check("the plain-text part carries the link too", sent?.body?.textContent.includes("token=hashed-token"));

console.log("\nAn address is attacker-controlled input");
resetEnv({});
fakeProviders(201);
res = await hook(
  "/auth-mail?secret=" + HOOK_SECRET,
  { user: { email: 'ada@example.com"><script>alert(1)</script>' }, email_data: signup().email_data },
);
const nasty = calls[0]?.body?.htmlContent ?? "";
check("the markup in the address never reaches the HTML", !nasty.includes("<script>"), nasty.slice(nasty.indexOf("<p style"), nasty.indexOf("<p style") + 160));
check("it is escaped instead", nasty.includes("&lt;script&gt;"));
check("and the mail still goes out", res.status === 200);

console.log("\nEvery action type GoTrue can ask for");
const subjects = {
  confirmation: "Verify your email to start StudyForge",
  recovery: "Reset your StudyForge password",
  magic_link: "Your StudyForge sign-in link",
  invite: "You are invited to StudyForge",
  email_change: "Confirm your new StudyForge email",
};
for (const [type, subject] of Object.entries(subjects)) {
  fakeProviders(201);
  await hook(
    "/auth-mail?secret=" + HOOK_SECRET,
    signup({ email_action_type: type, token_hash: "t-" + type }),
  );
  check(
    `${type} gets its own copy`,
    calls[0]?.body?.subject === subject &&
      calls[0]?.body?.htmlContent.includes("t-" + type),
    calls[0]?.body?.subject,
  );
}
fakeProviders(201);
await hook(
  "/auth-mail?secret=" + HOOK_SECRET,
  signup({ email_action_type: "phone_change" }),
);
check("an action type this file has never seen still sends, with generic copy", calls[0]?.body?.subject === "Confirm your StudyForge email");

console.log("\nWhen the providers refuse");
fakeProviders(401, "brevo.com");
res = await hook("/auth-mail?secret=" + HOOK_SECRET, signup());
check(
  "Resend carries the mail when Brevo refuses",
  res.status === 200 &&
    calls[0].url === BREVO &&
    calls[1].url === RESEND,
  JSON.stringify(calls.map((c) => c.url)),
);

fakeProviders(402);
res = await hook("/auth-mail?secret=" + HOOK_SECRET, signup());
check(
  "both refusing is reported as a failure, not swallowed as a 200",
  res.status === 502 && calls.length === 2,
  `${res.status} after ${calls.length} calls`,
);
check(
  "and the provider's own words travel back",
  (await res.text()).includes("HTTP 402"),
);

console.log("\n" + (failures.length ? `${failures.length} FAILED` : "all assertions held"));
for (const f of failures) console.log(" - " + f);
process.exitCode = failures.length ? 1 : 0;
