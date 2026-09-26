/**
 * Token generation and hashing for the share/link surface.
 *
 * The mock backend keeps every token in plaintext inside the localStorage
 * archive, so a dump of that one key is a dump of every share link and every
 * short-link management page. Against Postgres only the sha256 digest is stored
 * (see `supabase/migrations/0001_init.sql`), and the plain value is handed to
 * the caller exactly once, at creation.
 */

/** Same alphabet as the mock's short codes, so existing /r/:code links stay valid in shape. */
const SHORT_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const SHORT_CODE_LENGTH = 7;

/** Same alphabet and length as the mock's edit tokens. */
const EDIT_TOKEN_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const EDIT_TOKEN_LENGTH = 32;

const SHARE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SHARE_RANDOM_LENGTH = 24;

/**
 * Uniform sample from `alphabet`.
 *
 * `byte % alphabet.length` biases the first characters whenever the alphabet
 * length does not divide 256 — which is true for all three alphabets above — so
 * values in the leftover range are drawn again. The mock also fell back to
 * `Math.random()` when `crypto` was missing; a token generator has no safe
 * fallback, so it just throws.
 */
function randomFromAlphabet(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  const limit = 256 - (256 % alphabet.length);
  const picked: string[] = [];
  while (picked.length < length) {
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) {
        picked.push(alphabet.charAt(byte % alphabet.length));
        if (picked.length === length) {
          break;
        }
      }
    }
  }
  return picked.join("");
}

export function newShortCode(): string {
  return randomFromAlphabet(SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH);
}

export function newEditToken(): string {
  return randomFromAlphabet(EDIT_TOKEN_ALPHABET, EDIT_TOKEN_LENGTH);
}

/** Preserves the `share_…` / `note_…` prefixes the routes and tests already match on. */
export function newShareToken(prefix: "share" | "note"): string {
  return `${prefix}_${randomFromAlphabet(SHARE_ALPHABET, SHARE_RANDOM_LENGTH)}`;
}

/** Lowercase hex sha256, which is the only form of a token the database sees. */
export async function tokenHash(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
