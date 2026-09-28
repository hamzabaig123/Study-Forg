/**
 * StudyForge live auth flow — the whole authentication protocol exercised
 * against a deployed GoTrue, in the order a real user meets it, and finished
 * by deleting the account it created.
 *
 * What the rest of this folder does not cover: `security-battery.mjs` probes
 * what a *stranger* cannot do (grants, RLS, throttles, forged addresses) and
 * `replay-sweep.mjs` probes what a *signed-in account* can do with its data.
 * Neither one walks the sign-up → confirm → sign-in → refresh → change →
 * reset → sign-out path itself, which is where a policy change or a GoTrue
 * upgrade silently breaks the product for everybody.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ANON_KEY=<publishable key> \
 *   SUPABASE_SERVICE_ROLE_KEY=<secret key> \
 *   [SUPABASE_PASSWORD_FLOOR=10] \
 *   node supabase/e2e/auth-flow.mjs
 *
 * The service key is used for exactly two calls on one throwaway account this
 * script creates: confirming its address (so the check does not depend on a
 * mailbox) and deleting it at the end. Everything else is the ordinary public
 * API. Nothing it prints is a credential — passwords it generates are shown as
 * lengths, and error bodies are echoed only for the refusals it expects.
 *
 * Exit 0 = every step passed. Exit 1 = a step failed and is named. Exit 2 = the
 * environment is short.
 *
 * It is a hand-run probe rather than a CI job: the two privileged calls need the
 * service key, and `supabase-ci.yml` keeps that key out of CI on purpose (the
 * replay sweep does the same work through a direct connection instead). Running
 * it is a step in the staging → production path in OPERATIONS.md, not a push
 * gate.
 */
import { randomBytes } from "node:crypto";

const BASE = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const FLOOR = Number(process.env.SUPABASE_PASSWORD_FLOOR ?? 10);

if (!BASE || !ANON || !SERVICE) {
  console.error(
    "SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required.\n" +
      "The service key is only used to confirm and then delete the throwaway account.",
  );
  process.exitCode = 2;
}

/** A password `length` characters long that still reads as a strong one. */
const password = (length) =>
  `Aq7!${randomBytes(Math.max(1, length - 4)).toString("hex")}`.slice(
    0,
    length,
  );

const stamp = randomBytes(4).toString("hex");
const email = `authflow-${stamp}@example.com`;
const hex = (n) => randomBytes(n).toString("hex");
const belowFloor = `Ab1!${hex(Math.max(1, FLOOR - 5))}`.slice(
  0,
  Math.max(1, FLOOR - 2),
);
const atFloor = password(FLOOR);
const first = password(FLOOR + 11);

let passed = 0;
const failures = [];

async function step(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (cause) {
    failures.push(name);
    console.error(
      `  FAIL  ${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function gotrue(
  path,
  { method = "GET", token = null, secret = false, body = null } = {},
) {
  // The admin routes authenticate the *service* key as a bearer token, with the
  // publishable key still riding along as `apikey` the way the client sends it.
  const headers = secret
    ? { apikey: ANON, Authorization: `Bearer ${SERVICE}` }
    : { apikey: ANON };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const describe = ({ status, json }) =>
  `HTTP ${status}${json?.error_code ? ` ${json.error_code}` : json?.msg ? ` ${String(json.msg).slice(0, 60)}` : ""}`;

let userId = null;
let session = null;

async function main() {
  if (process.exitCode === 2) return;

  await step("GoTrue answers /auth/v1/health", async () => {
    const res = await gotrue("/auth/v1/health");
    must(res.status === 200, describe(res));
    must(res.json?.version, "no version in the reply");
    console.log(
      `        GoTrue ${res.json.version}, password floor under test ${FLOOR}`,
    );
  });

  await step(
    `sign-up refuses a password below the floor (${belowFloor.length} chars)`,
    async () => {
      const res = await gotrue("/auth/v1/signup", {
        method: "POST",
        body: { email: `below-${stamp}@example.com`, password: belowFloor },
      });
      must(
        res.status >= 400,
        `a ${belowFloor.length}-character password was accepted`,
      );
      must(
        /weak_password/.test(res.json?.error_code ?? res.text ?? ""),
        describe(res),
      );
    },
  );

  await step(
    "sign-up creates the account, confirms by mail, and withholds the session",
    async () => {
      const res = await gotrue("/auth/v1/signup", {
        method: "POST",
        body: { email, password: first },
      });
      // GoTrue answers sign-up with the user object inline; supabase-js then hands
      // it back as `{user, session}`. Accept either shape so the probe does not
      // break on a response-format change that the client already tolerates.
      const created = res.json?.user ?? (res.json?.id ? res.json : null);
      userId = created?.id ?? userId;
      must(res.status === 200, describe(res));
      must(
        created?.id,
        `sign-up returned no user id: ${res.text.slice(0, 120)}`,
      );
      must(
        !res.json?.session,
        "sign-up handed out a session for an address that has not been confirmed",
      );
    },
  );

  await step("the unconfirmed account cannot sign in", async () => {
    const res = await gotrue("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email, password: first },
    });
    must(
      res.status >= 400,
      `an unconfirmed account got ${res.json?.session ? "a session" : "in"}`,
    );
    console.log(`        refused as ${describe(res)}`);
  });

  await step(
    "an unknown address is refused the same way (no account enumeration)",
    async () => {
      const known = await gotrue("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email: `nobody-${stamp}@example.com`, password: first },
      });
      must(known.status >= 400, "a nonexistent address signed in");
      must(
        /invalid_credentials|InvalidLogin/.test(
          `${known.json?.error_code} ${known.json?.msg}`,
        ),
        describe(known),
      );
    },
  );

  await step("confirming the address unblocks the password grant", async () => {
    const confirm = await gotrue(`/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      secret: true,
      body: { email_confirm: true },
    });
    must(confirm.status === 200, `admin confirm said ${describe(confirm)}`);
    const res = await gotrue("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email, password: first },
    });
    must(res.status === 200, describe(res));
    must(
      res.json?.access_token && res.json?.refresh_token,
      "the grant returned an incomplete pair",
    );
    session = res.json;
  });

  await step(
    "the access token reads /auth/v1/user for that address",
    async () => {
      const res = await gotrue("/auth/v1/user", {
        token: session.access_token,
      });
      must(res.status === 200, describe(res));
      must(res.json?.email === email, `answered for ${res.json?.email}`);
      must(res.json?.aud === "authenticated", `aud is ${res.json?.aud}`);
    },
  );

  await step(
    "the refresh grant rotates the pair and the new token works",
    async () => {
      const res = await gotrue("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: session.refresh_token },
      });
      must(res.status === 200, describe(res));
      must(
        res.json?.access_token !== session.access_token,
        "refresh handed back the same access token",
      );
      must(res.json?.refresh_token, "no refresh token in the reply");
      const read = await gotrue("/auth/v1/user", {
        token: res.json.access_token,
      });
      must(
        read.status === 200,
        `the rotated token cannot read the user (${describe(read)})`,
      );
      session = res.json;
    },
  );

  await step(
    `the update path enforces the floor too (${belowFloor.length} chars refused)`,
    async () => {
      const res = await gotrue("/auth/v1/user", {
        method: "PUT",
        token: session.access_token,
        body: { password: belowFloor },
      });
      must(
        res.status >= 400,
        `an update to ${belowFloor.length} characters was accepted`,
      );
      must(
        /weak_password/.test(res.json?.error_code ?? res.text ?? ""),
        describe(res),
      );
    },
  );

  await step(
    "changing the password keeps the session and replaces the secret",
    async () => {
      const update = await gotrue("/auth/v1/user", {
        method: "PUT",
        token: session.access_token,
        body: { password: atFloor },
      });
      must(update.status === 200, describe(update));
      must(
        update.json?.id === userId,
        `the update answered for ${update.json?.id}`,
      );
      must(
        update.json?.aud === "authenticated",
        "the password change dropped the account out of the authenticated audience",
      );
      const stale = await gotrue("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email, password: first },
      });
      must(stale.status >= 400, "the previous password still signs in");
      const fresh = await gotrue("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email, password: atFloor },
      });
      must(
        fresh.status === 200,
        `a floor-length password cannot sign in (${describe(fresh)})`,
      );
      session = fresh.json;
    },
  );

  await step(
    "password recovery is accepted by the mailer for a live redirect origin",
    async () => {
      const res = await gotrue("/auth/v1/recover", {
        method: "POST",
        body: { email, redirect_to: `${BASE}/reset-password` },
      });
      must(res.status === 200, describe(res));
      must(
        !/Redirect not allowed/i.test(res.text),
        `the redirect allow-list refused ${BASE}/reset-password: ${res.text.slice(0, 120)}`,
      );
    },
  );

  await step(
    "sign-out invalidates the access token and the refresh token",
    async () => {
      const out = await gotrue("/auth/v1/logout", {
        method: "POST",
        token: session.access_token,
      });
      must(out.status === 204 || out.status === 200, describe(out));
      const read = await gotrue("/auth/v1/user", {
        token: session.access_token,
      });
      must(
        read.status >= 400,
        `the signed-out access token still reads the user (${describe(read)})`,
      );
      console.log(`        signed-out access token: ${describe(read)}`);
      const refresh = await gotrue("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: session.refresh_token },
      });
      must(
        refresh.status >= 400,
        `the signed-out refresh token still mints sessions (${describe(refresh)})`,
      );
    },
  );

  await step("deleting the account ends it", async () => {
    const res = await gotrue(`/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      secret: true,
    });
    must(res.status === 200, describe(res));
    userId = null;
    const signIn = await gotrue("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email, password: atFloor },
    });
    must(signIn.status >= 400, "a deleted account can still sign in");
  });
}

await main();

if (userId) {
  // The run failed somewhere between creating the account and deleting it; the
  // throwaway must not survive to become a real row with a real id.
  await gotrue(`/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    secret: true,
  }).catch(() => null);
}

console.log(`\n${passed} passed, ${failures.length} failed against ${BASE}`);
for (const name of failures) console.log(`  - ${name}`);
process.exitCode = process.exitCode === 2 ? 2 : failures.length ? 1 : 0;
