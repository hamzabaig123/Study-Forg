import QrGenerator from "@/pages/QrGenerator";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderWithProviders } from "@/test/render";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Public dynamic QR generator. Works without signing in: the visitor types a
 * destination, sees a live preview, and creates a short link whose URL is what
 * the QR actually encodes. The secret edit link is the only way back in.
 *
 * The backend actor is mocked, so this proves the page's own behavior and the
 * arguments it sends, not that the canister implements them.
 */
describe("QrGenerator", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: false }));
  });

  it("shows a live preview for a bare host and creates a short link whose QR encodes the absolute short URL", async () => {
    const user = userEvent.setup();
    const createLink = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: {
        id: 1n,
        code: "abc1234",
        shortUrl: "/r/abc1234",
        manageUrl: "/manage/secret-token",
        editToken: "secret-token",
        targetUrl: "https://example.com",
        status: { __kind__: "active" },
        createdAt: 1_700_000_000_000_000_000n,
      },
    });
    setMockActor(createMockActor({ createLink }));

    await renderWithProviders(<QrGenerator />);

    // Before creation the preview tracks the typed URL.
    await user.type(screen.getByLabelText(/destination url/i), "example.com");
    expect(
      await screen.findByLabelText(
        /qr code linking to https:\/\/example\.com/i,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create link/i }));

    await waitFor(() => {
      expect(createLink).toHaveBeenCalledWith("https://example.com");
    });

    // After creation the preview encodes the app's own absolute short URL.
    const absoluteShortUrl = `${window.location.origin}/r/abc1234`;
    expect(
      await screen.findByLabelText(
        new RegExp(
          `qr code linking to ${absoluteShortUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
          "i",
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue(absoluteShortUrl)).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("/manage/secret-token"),
    ).toBeInTheDocument();
  });

  it("rejects a javascript: target with a visible error and creates no link", async () => {
    const user = userEvent.setup();
    const createLink = vi.fn();
    setMockActor(createMockActor({ createLink }));

    await renderWithProviders(<QrGenerator />);

    await user.type(
      screen.getByLabelText(/destination url/i),
      "javascript:alert(1)",
    );

    // The create action stays disabled because the value is not previewable.
    expect(screen.getByRole("button", { name: /create link/i })).toBeDisabled();
    expect(createLink).not.toHaveBeenCalled();
  });

  it("surfaces a backend invalidUrl rejection without showing a success state", async () => {
    const user = userEvent.setup();
    const createLink = vi.fn().mockResolvedValue({
      __kind__: "err",
      err: {
        __kind__: "invalidUrl",
        invalidUrl: "Links to private or local addresses are not allowed.",
      },
    });
    setMockActor(createMockActor({ createLink }));

    await renderWithProviders(<QrGenerator />);

    await user.type(screen.getByLabelText(/destination url/i), "192.168.0.1");
    await user.click(screen.getByRole("button", { name: /create link/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /private or local addresses/i,
    );
    expect(document.querySelector('[data-ocid="qr.success_state"]')).toBeNull();
  });

  it("surfaces a rate-limited rejection with a retry message", async () => {
    const user = userEvent.setup();
    const createLink = vi.fn().mockResolvedValue({
      __kind__: "err",
      err: { __kind__: "rateLimited" },
    });
    setMockActor(createMockActor({ createLink }));

    await renderWithProviders(<QrGenerator />);

    await user.type(screen.getByLabelText(/destination url/i), "example.com");
    await user.click(screen.getByRole("button", { name: /create link/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /wait a moment/i,
    );
  });

  it("offers PNG and SVG downloads once a destination is previewable", async () => {
    const user = userEvent.setup();
    setMockActor(createMockActor());

    await renderWithProviders(<QrGenerator />);

    const png = screen.getByRole("button", { name: /png/i });
    const svg = screen.getByRole("button", { name: /svg/i });
    expect(png).toBeDisabled();
    expect(svg).toBeDisabled();

    await user.type(screen.getByLabelText(/destination url/i), "example.com");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /png/i })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: /svg/i })).toBeEnabled();
  });
});
