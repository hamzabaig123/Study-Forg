import ManageLink from "@/pages/ManageLink";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderPublicRoute } from "@/test/render";
import { LinkStatus } from "@/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "edit-token-abc";

function makeLinkDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    status: LinkStatus.active,
    code: "abc1234",
    createdAt: 1_700_000_000_000_000_000n,
    targetUrl: "https://example.com/spring",
    updatedAt: 1_700_000_000_000_000_000n,
    shortUrl: "http://localhost:3000/r/abc1234",
    ...overrides,
  };
}

function makeStats(overrides: Record<string, unknown> = {}) {
  return {
    perDay: [{ day: "2026-09-01", count: 3n }],
    totalScans: 3n,
    ...overrides,
  };
}

/**
 * Secret-token link management. The page is anonymous and token-gated: the
 * secret edit token in the URL is the only credential. The backend actor is
 * mocked, so this proves the page's wiring, not the canister's authorization.
 */
describe("ManageLink", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: false }));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
  });

  it("loads the link by its secret token and shows the short URL", async () => {
    const getLinkByToken = vi.fn().mockResolvedValue(makeLinkDetail());
    const getScanStats = vi.fn().mockResolvedValue(makeStats());
    setMockActor(createMockActor({ getLinkByToken, getScanStats }));

    await renderPublicRoute(<ManageLink />, {
      path: "/manage/$token",
      initialPath: `/manage/${TOKEN}`,
    });

    expect(await screen.findByText("Manage link")).toBeInTheDocument();
    expect(getLinkByToken).toHaveBeenCalledWith(TOKEN);
    expect(
      screen.getByDisplayValue("http://localhost:3000/r/abc1234"),
    ).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows the not-found state when the token resolves to no link", async () => {
    const getLinkByToken = vi.fn().mockResolvedValue(null);
    const getScanStats = vi.fn().mockResolvedValue(null);
    setMockActor(createMockActor({ getLinkByToken, getScanStats }));

    await renderPublicRoute(<ManageLink />, {
      path: "/manage/$token",
      initialPath: "/manage/expired",
    });

    expect(await screen.findByText("Link not found")).toBeInTheDocument();
  });

  it("saves a new destination and confirms the update", async () => {
    const user = userEvent.setup();
    const getLinkByToken = vi.fn().mockResolvedValue(makeLinkDetail());
    const getScanStats = vi.fn().mockResolvedValue(makeStats());
    const updateTarget = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: makeLinkDetail({ targetUrl: "https://example.com/summer" }),
    });
    setMockActor(
      createMockActor({ getLinkByToken, getScanStats, updateTarget }),
    );

    await renderPublicRoute(<ManageLink />, {
      path: "/manage/$token",
      initialPath: `/manage/${TOKEN}`,
    });

    const input = await screen.findByLabelText("Target URL");
    await user.clear(input);
    await user.type(input, "https://example.com/summer");
    await user.click(screen.getByRole("button", { name: /save destination/i }));

    await waitFor(() => {
      expect(updateTarget).toHaveBeenCalledWith(
        TOKEN,
        "https://example.com/summer",
      );
    });
    expect(await screen.findByText("Destination updated")).toBeInTheDocument();
  });

  it("rejects a non-http destination before calling the backend", async () => {
    const user = userEvent.setup();
    const getLinkByToken = vi.fn().mockResolvedValue(makeLinkDetail());
    const getScanStats = vi.fn().mockResolvedValue(makeStats());
    const updateTarget = vi.fn();
    setMockActor(
      createMockActor({ getLinkByToken, getScanStats, updateTarget }),
    );

    await renderPublicRoute(<ManageLink />, {
      path: "/manage/$token",
      initialPath: `/manage/${TOKEN}`,
    });

    const input = await screen.findByLabelText("Target URL");
    await user.clear(input);
    await user.type(input, "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: /save destination/i }));

    expect(
      await screen.findByText(/starting with http:\/\/ or https:\/\//i),
    ).toBeInTheDocument();
    expect(updateTarget).not.toHaveBeenCalled();
  });

  it("surfaces a backend invalidUrl rejection on the target field", async () => {
    const user = userEvent.setup();
    const getLinkByToken = vi.fn().mockResolvedValue(makeLinkDetail());
    const getScanStats = vi.fn().mockResolvedValue(makeStats());
    const updateTarget = vi.fn().mockResolvedValue({
      __kind__: "err",
      err: {
        __kind__: "invalidUrl",
        invalidUrl: "That address is not allowed.",
      },
    });
    setMockActor(
      createMockActor({ getLinkByToken, getScanStats, updateTarget }),
    );

    await renderPublicRoute(<ManageLink />, {
      path: "/manage/$token",
      initialPath: `/manage/${TOKEN}`,
    });

    const input = await screen.findByLabelText("Target URL");
    await user.clear(input);
    await user.type(input, "https://example.com/blocked");
    await user.click(screen.getByRole("button", { name: /save destination/i }));

    expect(
      await screen.findByText("That address is not allowed."),
    ).toBeInTheDocument();
  });

  it("pauses an active link through the backend", async () => {
    const user = userEvent.setup();
    const getLinkByToken = vi.fn().mockResolvedValue(makeLinkDetail());
    const getScanStats = vi.fn().mockResolvedValue(makeStats());
    const setPaused = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: makeLinkDetail({ status: LinkStatus.paused }),
    });
    setMockActor(createMockActor({ getLinkByToken, getScanStats, setPaused }));

    await renderPublicRoute(<ManageLink />, {
      path: "/manage/$token",
      initialPath: `/manage/${TOKEN}`,
    });

    await user.click(
      await screen.findByRole("button", { name: /pause link/i }),
    );

    await waitFor(() => {
      expect(setPaused).toHaveBeenCalledWith(TOKEN, true);
    });
  });

  it("shows the paused banner for a paused link", async () => {
    const getLinkByToken = vi
      .fn()
      .mockResolvedValue(makeLinkDetail({ status: LinkStatus.paused }));
    const getScanStats = vi.fn().mockResolvedValue(makeStats());
    setMockActor(createMockActor({ getLinkByToken, getScanStats }));

    await renderPublicRoute(<ManageLink />, {
      path: "/manage/$token",
      initialPath: `/manage/${TOKEN}`,
    });

    expect(await screen.findByText("This link is paused")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resume link/i }),
    ).toBeInTheDocument();
  });

  it("deletes the link after confirmation and shows the deleted state", async () => {
    const user = userEvent.setup();
    const getLinkByToken = vi.fn().mockResolvedValue(makeLinkDetail());
    const getScanStats = vi.fn().mockResolvedValue(makeStats());
    const deleteLink = vi.fn().mockResolvedValue({ __kind__: "ok", ok: null });
    setMockActor(createMockActor({ getLinkByToken, getScanStats, deleteLink }));

    await renderPublicRoute(<ManageLink />, {
      path: "/manage/$token",
      initialPath: `/manage/${TOKEN}`,
    });

    await user.click(
      await screen.findByRole("button", { name: /delete link/i }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: /^delete link$/i }),
    );

    await waitFor(() => {
      expect(deleteLink).toHaveBeenCalledWith(TOKEN);
    });
    expect(await screen.findByText("Link deleted")).toBeInTheDocument();
  });

  it("renders scan totals and the empty state when there are no scans", async () => {
    const getLinkByToken = vi.fn().mockResolvedValue(makeLinkDetail());
    const getScanStats = vi
      .fn()
      .mockResolvedValue({ perDay: [], totalScans: 0n });
    setMockActor(createMockActor({ getLinkByToken, getScanStats }));

    await renderPublicRoute(<ManageLink />, {
      path: "/manage/$token",
      initialPath: `/manage/${TOKEN}`,
    });

    expect(await screen.findByText("No scans yet")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
