/**
 * The URL rules one StudyForge short link must satisfy, in one place.
 *
 * Three other copies of this rule set exist — `url_target_problem` plus
 * `private_host_problem` in `supabase/migrations/0001_init.sql`, and
 * `hostOf`/`isPrivateHost` in the canister's `lib/qr-links.mo` — because the
 * check belongs where the write happens, and each backend is a separate
 * deployable. This file is the TypeScript one, and it now has a second job: the
 * `/r/:code` page reads it before it navigates.
 *
 * That second job is why it lives in `lib/security` rather than in
 * `src/mocks/backend.ts`, which was its only caller. A redirect that trusts the
 * stored string trusts whatever wrote it — an archive restored from a file, a
 * row written before the CHECK existed, a canister that validates on its own
 * terms, or hand-run SQL. `javascript:` and `data:` reach `
 * window.location.replace()` and run in *this* origin, which is the one holding
 * the session.
 */

const SHORT_PATH_PREFIX = "/r/";

/** Mirrors `pathOf` in `lib/qr-links.mo`, stopping at a query or fragment. */
function pathOf(remainder: string): string {
  const parts = remainder.split("/");
  if (parts.length < 2) {
    return "";
  }
  let path = "/";
  for (let index = 1; index < parts.length; index += 1) {
    const segment = parts[index];
    if (segment.startsWith("?") || segment.startsWith("#")) {
      break;
    }
    path += segment;
    if (index + 1 < parts.length) {
      path += "/";
    }
  }
  return path;
}

/** Mirrors `hostOf` in `lib/qr-links.mo`: userinfo, port and path are dropped. */
function hostOf(remainder: string): string {
  let host = remainder.split("/")[0].split("?")[0].split("#")[0];
  const at = host.split("@");
  host = at[at.length - 1];
  // A bracketed IPv6 host contains colons, so keep the brackets and stop after
  // the closing one rather than splitting on the first colon.
  if (host.startsWith("[")) {
    return `${host.split("]")[0]}]`;
  }
  return host.split(":")[0];
}

/** Mirrors `isPrivateHost` in `lib/qr-links.mo`: loopback, ULA and RFC1918 literals. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "[::1]") {
    return true;
  }
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
    return true;
  }
  const octets = h.split(".");
  if (octets.length !== 4) {
    return false;
  }
  const first = Number(octets[0]);
  const second = Number(octets[1]);
  if (first === 10 || first === 127) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  return first === 172 && second >= 16 && second <= 31;
}

export function urlProblem(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return "Enter a URL to shorten.";
  }
  const separator = trimmed.indexOf("://");
  if (separator < 0) {
    return "URL must start with http:// or https://";
  }
  const scheme = trimmed.slice(0, separator).toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return "Only http and https links are allowed.";
  }
  const remainder = trimmed.slice(separator + 3);
  if (remainder.length === 0) {
    return "URL is missing a host.";
  }
  const host = hostOf(remainder);
  if (host.length === 0) {
    return "URL is missing a host.";
  }
  if (isPrivateHost(host)) {
    return "Links to private or local addresses are not allowed.";
  }
  if (pathOf(remainder).startsWith(SHORT_PATH_PREFIX)) {
    return "Links cannot point back at this app's short links.";
  }
  return null;
}

/**
 * The stored target, or nothing worth navigating to.
 *
 * Deliberately the same predicate the minting side uses rather than a stricter
 * one: refusing `http://` here would break links their owner is entitled to have
 * saved, and the write already passed that rule. What this closes is the sink
 * trusting a string it never checked.
 */
export function safeRedirectUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return urlProblem(raw) === null ? raw.trim() : null;
}
