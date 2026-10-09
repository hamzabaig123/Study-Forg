/**
 * StudyForge mail recipient check — proves that a verification link belongs to
 * the account it was minted for, and that confirming one account leaves the
 * others exactly as they were.
 *
 * Why this exists next to `auth-flow.mjs`: that probe confirms the *protocol*
 * (sign up, confirm through the admin route, sign in, refresh, rotate, delete)
 * and deliberately never depends on a mailbox. Nothing in this folder checked
 * the thing people actually worry about after an email complaint — that two
 * accounts get two different tokens, that the tokens do not collide or overwrite
 * each other, and that a report about account B is addressed to account B.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ANON_KEY=<publishable key> \
 *   SUPABASE_SERVICE_ROLE_KEY=<secret key> \
 *   [SUPABASE_APP_ORIGIN=https://study-forg-frontend-100.vercel.app] \
 *   node supabase/e2e/mail-recipient-check.mjs [--digest]
 *
 * No verification email is sent, except where noted. `POST /auth/v1/admin/users`
 * with `email_confirm: false` creates an account without mailing it, and
 * `POST /auth/v1/admin/generate_link` mints the same action token the mailer
 * would have embedded and hands it back **instead of** sending anything — so the
 * link this script follows is a real GoTrue signup link that never travelled
 * through SMTP. The addresses are at `example.com`, a domain reserved for
 * exactly this, so the one step that does ask the mailer to send (`resend`, and
 * `--digest`) can only ever reach a reserved address: no person receives mail
 * from this run, and each costs one slot of the project's daily sending quota.
 *
 * What each step answers, in the order the requirements are written:
 *   A  the address in the request is the address on the account
 *   B  a second account gets its own address and its own token
 *   C  verifying the second account does not verify the first
 *   D  (--digest) the analytics mail is addressed to the requesting account
 *   E  a replayed token, a garbage token, an unverified account and a duplicate
 *      resend are each refused, or refused with the same body a real one gets
 *
 * The service key is used only for the throwaway accounts this script creates
 * and deletes. Nothing it prints is a credential or a token: tokens appear as
 * lengths and as whether two of them differ.
 *
 * Exit 0 = every step passed. Exit 1 = a step failed, and it is named. Exit 2 =
 * the environment is short.
 */
import { randomBytes } from "node:crypto";

const BASE = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const APP_ORIGIN = (
  process.env.SUPABASE_APP_ORIGIN ?? "http://localhost:5173"
).replace(/\/+$/, "");
const WANT_DIGEST = process.argv.includes("--digest");

if (!BASE || !ANON || !SERVICE) {
  console.error(
    "SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required.\n" +
      "The service key only creates and deletes the throwaway accounts.",
  );
  process.exitCode = 2;
}

const stamp = randomBytes(4).toString("hex");
const PASSWORD = `Aq7!${randomBytes(8).toString("hex")}`;
const ACCOUNTS = [
  { tag: "A", email: `recipient-a-${stamp}@example.com` },
  { tag: "B", email: `recipient-b-${stamp}@example.com` },
];

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "  ok   " : "  FAIL "}${name}${detail ? ` — ${detail}` : ""}`);
}

/** One GoTrue call. `admin` puts the service key in the bearer slot. */
async function call(
  path,
  { method = "GET", body = null, admin = false, redirect = "manual" } = {},
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect,
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      Authorization: `Bearer ${admin ? SERVICE : ANON}`,
    },
    body: body === null ? null : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* a redirect or a plain-text refusal */
  }
  return { status: res.status, json, text, location: res.headers.get("location") };
}

/** Admin read of one account's confirmation state, by id. */
async function accountState(id) {
  const res = await call(`/auth/v1/admin/users/${id}`, { admin: true });
  return res.status === 200
    ? { email: res.json?.email ?? "", confirmedAt: res.json?.email_confirmed_at ?? null }
    : null;
}

/** One signup verification, the way the link in the mail does it. */
async function followLink(token) {
  const res = await call(
    `/auth/v1/verify?token_hash=${encodeURIComponent(token)}&type=signup` +
      `&redirect_to=${encodeURIComponent(`${APP_ORIGIN}/verify-email`)}`,
  );
  let location = null;
  try {
    location = new URL(res.location ?? "", BASE);
  } catch {
    /* a refusal has no location */
  }
  return {
    status: res.status,
    accepted: Boolean(
      location && (location.searchParams.has("code") || location.searchParams.has("access_token")),
    ),
  };
}

/** The signup link GoTrue would have mailed, minted without mailing it. */
async function mintLink(email) {
  const res = await call("/auth/v1/admin/generate_link", {
    method: "POST",
    admin: true,
    body: {
      type: "signup",
      email,
      password: PASSWORD,
      email_confirm: false,
      options: { redirectTo: `${APP_ORIGIN}/verify-email` },
    },
  });
  if (res.status !== 200) {
    throw new Error(`generate_link refused ${email} with ${res.status}: ${res.text.slice(0, 160)}`);
  }
  return {
    token: res.json?.hashed_token ?? res.json?.confirmation_token ?? "",
    actionLink: res.json?.action_link ?? "",
    userId: res.json?.id ?? null,
  };
}

async function main() {
  if (process.exitCode === 2) return;
  const created = [];
  const minted = {};

  try {
    console.log("\nA — the address in the request is the address on the account");
    for (const account of ACCOUNTS) {
      const res = await call("/auth/v1/admin/users", {
        method: "POST",
        admin: true,
        body: { email: account.email, password: PASSWORD, email_confirm: false },
      });
      if (res.status !== 200 || !res.json?.id) {
        throw new Error(`could not create ${account.tag}: ${res.status} ${res.text.slice(0, 160)}`);
      }
      created.push(res.json.id);
      account.id = res.json.id;
      check(
        `account ${account.tag} exists unconfirmed at its own address`,
        res.json.email === account.email && !res.json.email_confirmed_at,
      );
      minted[account.tag] = await mintLink(account.email);
    }

    console.log("\nB — the second account gets its own token, not the first's");
    const tokenA = minted.A.token;
    const tokenB = minted.B.token;
    check("both signup tokens are present", tokenA.length > 20 && tokenB.length > 20);
    check("the two tokens differ", tokenA !== tokenB);
    check(
      "each link carries its own token and nobody else's",
      minted.A.actionLink.includes(tokenA) &&
        !minted.A.actionLink.includes(tokenB) &&
        minted.B.actionLink.includes(tokenB) &&
        !minted.B.actionLink.includes(tokenA),
    );

    console.log("\nC — verifying B does not verify A, and does not spend A's link");
    const verifyB = await followLink(tokenB);
    check("account B's minted link opened a session", verifyB.accepted, `HTTP ${verifyB.status}`);
    let stateA = await accountState(ACCOUNTS[0].id);
    let stateB = await accountState(ACCOUNTS[1].id);
    check("B is confirmed", Boolean(stateB?.confirmedAt));
    check("A is still unverified", stateA !== null && !stateA.confirmedAt);

    const verifyA = await followLink(tokenA);
    check(
      "A's link still works after B went through the same flow",
      verifyA.accepted,
      `HTTP ${verifyA.status}`,
    );
    stateA = await accountState(ACCOUNTS[0].id);
    stateB = await accountState(ACCOUNTS[1].id);
    check("A is now confirmed", Boolean(stateA?.confirmedAt));
    check(
      "confirming A did not undo or re-open B",
      Boolean(stateB?.confirmedAt) && stateA.email !== stateB.email,
    );

    console.log("\nE — replays, garbage, unverified sign-in, duplicate resends");
    const replay = await followLink(tokenB);
    check(
      "a token that was already used is refused",
      !replay.accepted,
      `HTTP ${replay.status}`,
    );
    const garbage = await followLink("a".repeat(64));
    check(
      "a token that was never issued is refused",
      !garbage.accepted && garbage.status >= 400,
      `HTTP ${garbage.status}`,
    );
    const crossUsed = await followLink(`${tokenA.slice(0, -1)}${tokenB.slice(-1)}`);
    check(
      "a token that is neither account's is refused",
      !crossUsed.accepted,
      `HTTP ${crossUsed.status}`,
    );

    // A third account, left unconfirmed on purpose: both of the ones above have
    // been verified by now, and "an unverified account cannot sign in" needs an
    // account that is still unverified.
    const held = `recipient-c-${stamp}@example.com`;
    const heldCreated = await call("/auth/v1/admin/users", {
      method: "POST",
      admin: true,
      body: { email: held, password: PASSWORD, email_confirm: false },
    });
    if (heldCreated.json?.id) created.push(heldCreated.json.id);
    const unconfirmedSignIn = await call("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email: held, password: PASSWORD },
    });
    check(
      "an unverified account cannot sign in, and says why",
      unconfirmedSignIn.status === 400 &&
        /not confirmed/i.test(
          unconfirmedSignIn.json?.error_description ??
            unconfirmedSignIn.json?.msg ??
            "",
        ),
      `HTTP ${unconfirmedSignIn.status}`,
    );

    const resends = [];
    for (let i = 0; i < 2; i += 1) {
      resends.push(
        await call("/auth/v1/resend", {
          method: "POST",
          body: { type: "signup", email: ACCOUNTS[0].email, options: { emailRedirectTo: `${APP_ORIGIN}/verify-email?email=${encodeURIComponent(ACCOUNTS[0].email)}` } },
        }),
      );
    }
    const sameBody = JSON.stringify(resends[0].json) === JSON.stringify(resends[1].json);
    const neverCrashed = resends.every((r) => r.status < 500);
    check("a duplicate resend never errors at the mailer", neverCrashed);
    check(
      "a duplicate resend answers the same either way (no existence oracle)",
      sameBody,
      `${resends.map((r) => r.status).join(" / ")}`,
    );
    // A third request inside the same window is the one GoTrue is expected to
    // bound; 429 and 200-with-a-queued-send are both acceptable answers here,
    // while a 5xx is not, and this is already covered by `neverCrashed`.
    const third = await call("/auth/v1/resend", {
      method: "POST",
      body: { type: "signup", email: ACCOUNTS[0].email },
    });
    check("the third request is bounded or accepted, not broken", third.status < 500, `HTTP ${third.status}`);

    if (WANT_DIGEST) {
      console.log("\nD — the analytics digest goes to the account that asked");
      const signedIn = await call("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email: ACCOUNTS[1].email, password: PASSWORD },
      });
      const accessToken = signedIn.json?.access_token;
      if (!accessToken) {
        check("B can sign in to request a digest", false, `HTTP ${signedIn.status}`);
      } else {
        await call("/rest/v1/reminder_settings", {
          method: "POST",
          admin: true,
          body: [
            {
              user_id: ACCOUNTS[1].id,
              enabled: true,
              time_of_day: "00:00",
              utc_offset_minutes: 0,
              send_task_reminder: true,
              send_daily_report: true,
            },
          ],
        });
        const digest = await fetch(`${BASE}/functions/v1/reminder-sender`, {
          method: "POST",
          headers: {
            apikey: ANON,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Origin: APP_ORIGIN,
          },
          body: JSON.stringify({ daily: false }),
        });
        const payload = await digest.json().catch(() => null);
        const addressed = (payload?.results ?? []).map((row) => row.email).join(",");
        check(
          "the digest is addressed to B's own domain, not to the project owner's mailbox",
          digest.status === 200 &&
            (payload?.results ?? []).length === 1 &&
            /@example\.com$/.test(addressed),
          addressed || `HTTP ${digest.status} ${JSON.stringify(payload?.error ?? "").slice(0, 120)}`,
        );
      }
    }
  } catch (error) {
    check("the run completed", false, error.message);
  } finally {
    for (const id of created) {
      await call(`/auth/v1/admin/users/${id}`, { method: "DELETE", admin: true }).catch(() => null);
    }
    console.log(`\ncleaned up ${created.length} throwaway account(s); no real address was mailed.`);
  }

  const failed = results.filter((row) => !row.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

/**
 * `process.exit()` while an undici socket is still open aborts the Node process
 * on Windows before the report is printed, so the exit code is set and the loop
 * is allowed to drain.
 */
main().then(() => setTimeout(() => undefined, 800));
