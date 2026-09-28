import { describe, expect, it } from "vitest";
import { authLinkError } from "./authLinkError";

/**
 * The shapes GoTrue actually redirects with.
 *
 * A spent recovery link and a working one differ by three words in the
 * fragment, and the page cannot tell them apart without reading them — so the
 * strings below are copied from what the project sends, not invented.
 */
describe("reading the reason off an auth link", () => {
  it("names a reset link that was already spent", () => {
    const error = authLinkError({
      hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    });
    expect(error?.code).toBe("otp_expired");
    expect(error?.message).toMatch(/already been used|expired/i);
    // The visitor's next step is the one thing the raw code never says.
    expect(error?.message).toMatch(/ask for a new one/i);
  });

  it("reads the same fields out of a PKCE query string", () => {
    const error = authLinkError({
      search: "?error=otp_expired&error_description=Token+has+expired",
    });
    expect(error?.code).toBe("otp_expired");
  });

  it("keeps the project's own words when the code means nothing specific", () => {
    const error = authLinkError({
      hash: "#error=server_error&error_description=A+mailer+refused+the+send",
    });
    expect(error?.message).toBe("A mailer refused the send");
  });

  it("says something for a code that arrives without a description", () => {
    const error = authLinkError({ hash: "#error=unauthorized" });
    expect(error?.message).toMatch(/could not be opened/i);
  });

  it("finds nothing in a link that worked", () => {
    // A successful implicit link carries a session in the fragment; treating
    // that as a failure would show an error card on the way into the app.
    expect(
      authLinkError({
        hash: "#access_token=eyJhbGci&token_type=bearer&type=recovery",
      }),
    ).toBeNull();
    expect(authLinkError({ search: "?code=abc123" })).toBeNull();
    expect(authLinkError({})).toBeNull();
    expect(authLinkError({ hash: "", search: "" })).toBeNull();
  });
});
