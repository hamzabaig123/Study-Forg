import { RequireAuth } from "@/components/layout/RequireAuth";
import { setLocalAccount, setMockActor } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderGuard } from "@/test/renderGuard";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Email/password accounts only exist beside the dev mock backend.
vi.mock("@/lib/authMode", () => ({ USE_LOCAL_ACCOUNTS: true }));

/**
 * Characterization baseline for the local account sign-in gate. The guard keeps
 * visitors without a session at the login screen, holds an account with an
 * unverified email at the verification screen, and renders the signed-in shell
 * once the email is verified.
 */
describe("RequireAuth", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setMockActor(null);
  });

  it("redirects a visitor without a session to the login screen", async () => {
    await renderGuard(RequireAuth);

    expect(await screen.findByText("Log in screen")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });

  it("holds an account with an unverified email at the verification screen", async () => {
    setLocalAccount({ emailVerified: false });

    await renderGuard(RequireAuth);

    expect(await screen.findByText("Verify your email")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });

  it("renders the signed-in shell for a verified account", async () => {
    setLocalAccount({ name: "Hamza" });
    setMockActor(createMockActor());

    await renderGuard(RequireAuth);

    expect(await screen.findByText("Dashboard body")).toBeInTheDocument();
    expect(screen.getByText("StudyForge")).toBeInTheDocument();
  });

  it("waits for the backend before showing the shell", async () => {
    setLocalAccount({ name: "Hamza" });
    setMockActor(null);

    await renderGuard(RequireAuth);

    expect(
      await screen.findByText("Loading your workspace…"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });
});
