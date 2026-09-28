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
