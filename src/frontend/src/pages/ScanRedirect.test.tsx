import ScanRedirect from "@/pages/ScanRedirect";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderRoute } from "@/test/render";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Short-code scan redirect. Anonymous callers are allowed. A live link
 * redirects to its current target; a paused or deleted link shows an
 * unavailable page instead. The backend actor is mocked.
 */
describe("ScanRedirect", () => {
  const replace = vi.fn();

  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: false }));
    // jsdom's `location.replace` is not implemented; the page calls it to
    // leave for the target, so capture the call instead of navigating.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, replace, origin: "http://localhost:3000" },
    });
  });

  afterEach(() => {
    replace.mockReset();
  });

  it("resolves an active code and redirects to the current target", async () => {
    const resolveCode = vi.fn().mockResolvedValue({
      __kind__: "redirect",
      redirect: { targetUrl: "https://example.com/spring" },
    });
    setMockActor(createMockActor({ resolveCode }));

    await renderRoute(<ScanRedirect />, {
      path: "/r/$code",
      initialPath: "/r/abc1234",
    });

    await waitFor(() => {
      expect(resolveCode).toHaveBeenCalledWith(
        "abc1234",
        expect.anything(),
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("https://example.com/spring");
    });
    expect(await screen.findByText(/taking you there/i)).toBeInTheDocument();
  });

  it("shows the paused unavailable page instead of redirecting", async () => {
    const resolveCode = vi.fn().mockResolvedValue({
      __kind__: "unavailable",
      unavailable: "paused",
    });
    setMockActor(createMockActor({ resolveCode }));

    await renderRoute(<ScanRedirect />, {
      path: "/r/$code",
      initialPath: "/r/paused1",
    });

    expect(
      await screen.findByRole("heading", { name: /this link is paused/i }),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows the deleted unavailable page instead of redirecting", async () => {
    const resolveCode = vi.fn().mockResolvedValue({
      __kind__: "unavailable",
      unavailable: "deleted",
    });
    setMockActor(createMockActor({ resolveCode }));

    await renderRoute(<ScanRedirect />, {
      path: "/r/$code",
      initialPath: "/r/gone123",
    });

    expect(
      await screen.findByRole("heading", { name: /this link was removed/i }),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows the not-found unavailable page for an unknown code", async () => {
    const resolveCode = vi.fn().mockResolvedValue({
      __kind__: "unavailable",
      unavailable: "notFound",
    });
    setMockActor(createMockActor({ resolveCode }));

    await renderRoute(<ScanRedirect />, {
      path: "/r/$code",
      initialPath: "/r/missing",
    });

    expect(
      await screen.findByRole("heading", { name: /this link doesn't exist/i }),
    ).toBeInTheDocument();
  });

  it("submits an abuse report for an unavailable link", async () => {
    const user = userEvent.setup();
    const resolveCode = vi.fn().mockResolvedValue({
      __kind__: "unavailable",
      unavailable: "notFound",
    });
    const reportAbuse = vi.fn().mockResolvedValue({ __kind__: "ok" });
    setMockActor(createMockActor({ resolveCode, reportAbuse }));

    await renderRoute(<ScanRedirect />, {
      path: "/r/$code",
      initialPath: "/r/spam123",
    });

    await user.type(
      await screen.findByLabelText(/report this link/i),
      "This is spam",
    );
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => {
      expect(reportAbuse).toHaveBeenCalledWith("spam123", "This is spam");
    });
    expect(
      await screen.findByText(/your report has been recorded/i),
    ).toBeInTheDocument();
  });
});
