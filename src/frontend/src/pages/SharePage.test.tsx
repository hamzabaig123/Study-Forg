import SharePage from "@/pages/SharePage";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { makeClass } from "@/test/fixtures";
import { createMockActor } from "@/test/mockActor";
import { renderWithProviders } from "@/test/render";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the share surface. The page must keep listing
 * the caller's links, keep the create action disabled until a target is chosen,
 * and keep revoking through the actor.
 */
describe("SharePage", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("shows the empty links state and a disabled create action before a target is chosen", async () => {
    const actor = createMockActor({
      listClasses: vi.fn().mockResolvedValue([makeClass()]),
      listShares: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<SharePage />);

    expect(await screen.findByText(/no share links yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create share link/i }),
    ).toBeDisabled();
  });

  it("lists the caller's existing share links with their public URL", async () => {
    const actor = createMockActor({
      listClasses: vi.fn().mockResolvedValue([]),
      listShares: vi.fn().mockResolvedValue([
        {
          token: "abc123",
          createdAt: 1_700_000_000_000_000_000n,
          target: { __kind__: "topic", topic: 4n },
        },
      ]),
    });
    setMockActor(actor);

    await renderWithProviders(<SharePage />);

    expect(
      await screen.findByText(`${window.location.origin}/shared/abc123`),
    ).toBeInTheDocument();
    expect(screen.getByText("1 link")).toBeInTheDocument();
  });

  it("revokes a share link through the actor after confirmation", async () => {
    const user = userEvent.setup();
    const revokeShare = vi.fn().mockResolvedValue(true);
    const actor = createMockActor({
      listClasses: vi.fn().mockResolvedValue([]),
      listShares: vi.fn().mockResolvedValue([
        {
          token: "abc123",
          createdAt: 1_700_000_000_000_000_000n,
          target: { __kind__: "topic", topic: 4n },
        },
      ]),
      revokeShare,
    });
    setMockActor(actor);

    await renderWithProviders(<SharePage />);

    await user.click(await screen.findByRole("button", { name: /revoke/i }));
    await user.click(
      await screen.findByRole("button", { name: /revoke link/i }),
    );

    await waitFor(() => {
      expect(revokeShare).toHaveBeenCalledWith("abc123");
    });
  });
});
