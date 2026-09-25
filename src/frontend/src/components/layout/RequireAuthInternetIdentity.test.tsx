import { RequireAuth } from "@/components/layout/RequireAuth";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderGuard } from "@/test/renderGuard";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The same guard against a real canister, where the session is an Internet
 * Identity principal rather than a local account. There is no email to confirm,
 * so a signed-in principal always reaches the shell, and the only waiting state
 * is the identity being restored on load.
 */
describe("RequireAuth with Internet Identity", () => {
  beforeEach(() => {
    setMockActor(null);
  });

  it("redirects a visitor without an identity to the login screen", async () => {
    setMockAuth(createAuthState({ isAuthenticated: false, identity: null }));

    await renderGuard(RequireAuth);

    expect(await screen.findByText("Log in screen")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });

  it("holds the guard while the stored identity is being restored", async () => {
    setMockAuth(
      createAuthState({
        isAuthenticated: false,
        identity: null,
        isInitializing: true,
      }),
    );

    await renderGuard(RequireAuth);

    expect(
      await screen.findByText("Restoring your session…"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Log in screen")).not.toBeInTheDocument();
  });

  it("renders the signed-in shell for a principal without an email step", async () => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
    setMockActor(createMockActor());

    await renderGuard(RequireAuth);

    expect(await screen.findByText("Dashboard body")).toBeInTheDocument();
    expect(screen.queryByText("Verify your email")).not.toBeInTheDocument();
  });
});
