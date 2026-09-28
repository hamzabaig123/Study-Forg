/**
 * The reason an auth link came back without opening a session.
 *
 * GoTrue spends a confirmation or recovery token on the first hit it receives,
 * then redirects to the app. When the token was already spent — the link was
 * opened once while the app was not running, or its hour passed — that redirect
 * carries `#error=access_denied&error_code=otp_expired&error_description=…` and
 * no session at all. supabase-js consumes such a hash in silence, so the landing
 * page reads as a form that simply does not work. Reading the fields is what
 * turns it into a sentence, and a link the visitor can ask for again.
 *
 * The PKCE flow puts the same three fields in the query string instead of the
 * fragment, so both are checked.
 */

/** A refusal the visitor can act on, named by the code GoTrue sent. */
export interface AuthLinkError {
  code: string;
  message: string;
}

/**
 * Codes that mean "this link is finished with" rather than "something broke".
 *
 * Each of them is fixed by the same action — request a fresh link — so they
 * share one sentence instead of three near-identical ones.
 */
const SPENT = new Set([
  "otp_expired",
  "bad_verification_code",
  "link_expired",
  "expired_token",
]);

const SPENT_MESSAGE =
  "That link has already been used, or it has expired. These links open once, so the first tap that could not reach the app spends it — ask for a new one.";

/** Anything else GoTrue named: its own words beat a guess, when it has any. */
function describe(code: string, detail: string) {
  if (SPENT.has(code)) {
    return SPENT_MESSAGE;
  }
  return (
    detail ||
    "The link could not be opened. Ask for a new one and try again straight away."
  );
}

/**
 * Read the auth error off the current URL, or `null` when there is none.
 *
 * `+` is how GoTrue separates words in these values, which is exactly what
 * `URLSearchParams` decodes, so the fragment needs no special handling beyond
 * dropping its leading `#`.
 */
export function authLinkError(
  url: { hash?: string; search?: string } = globalThis.location ?? {},
): AuthLinkError | null {
  for (const raw of [url.hash, url.search]) {
    if (!raw) {
      continue;
    }
    const params = new URLSearchParams(raw.replace(/^[#?]/, ""));
    const code = params.get("error_code") ?? params.get("error");
    if (!code) {
      continue;
    }
    return {
      code,
      message: describe(code, params.get("error_description") ?? ""),
    };
  }
  return null;
}
