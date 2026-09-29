/**
 * One password policy for every sign-in mode.
 *
 * The floor is the deployed project's, not a preference: Supabase's GoTrue is
 * configured to 10 and answers anything shorter with `422 weak_password`
 * (measured live on 2026-09-28, on both the public sign-up route and an
 * authenticated password change). A browser that accepted 8 would hand the
 * visitor a round trip and a server's words instead of its own.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

export const PASSWORD_POLICY_MESSAGE = `Use a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`;

/** The refusal a form should show, or `undefined` when the password is usable. */
export function passwordLengthError(password: string): string | undefined {
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return undefined;
}

/**
 * The refusal for a password that already appears in public breach corpora,
 * or `null` when the password is not known-bad (or the check could not run).
 *
 * The lookup is Have I Been Pwned's k-anonymity range API: the browser sends
 * only the first five hex characters of the password's SHA-1 digest, and
 * matches the remainder against the returned suffix list — the full password
 * and its digest never leave the machine. GoTrue's own HIBP switch is
 * plan-gated (the project answers `402` on the config PATCH, measured live),
 * so this client-side check is the free equivalent and it runs on every path
 * that sets a password.
 *
 * Deliberately fail-open: an unreachable API or a missing WebCrypto must not
 * lock every visitor out of their account. A breach hit, by contrast, always
 * refuses — that answer is local, after the response arrives.
 */
export async function breachReason(
  password: string,
): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || !password) {
    return undefined;
  }
  let digest: string;
  try {
    const bytes = new Uint8Array(
      await subtle.digest("SHA-1", new TextEncoder().encode(password)),
    );
    // Upper case, which is the form the range API documents and answers in.
    digest = [...bytes]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  } catch {
    return undefined;
  }
  let body: string;
  try {
    const response = await fetch(
      `https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`,
      // A shared cache entry must not reveal that two visitors typed the same
      // prefix; `no-store` keeps the lookup out of the HTTP cache entirely.
      { cache: "no-store" },
    );
    if (!response.ok) {
      return undefined;
    }
    body = await response.text();
  } catch {
    return undefined;
  }
  const tail = digest.slice(5);
  for (const line of body.split("\n")) {
    const [suffix, count] = line.trim().split(":");
    if (suffix?.toUpperCase() === tail) {
      const times = Number(count);
      return `This password is already public — it appears in known data breaches${
        Number.isFinite(times) ? ` about ${times.toLocaleString()} times` : ""
      }. Choose a password nobody has seen before.`;
    }
  }
  return undefined;
}
