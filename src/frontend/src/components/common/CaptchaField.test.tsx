/**
 * The captcha widget.
 *
 * The decision under test is the one that costs a user something: this component
 * fails **closed**. A script it cannot fetch leaves the form shut with a retry
 * rather than sending the request without a token, because "let it through when
 * the check is unavailable" is the exact hole the check exists to close — and it
 * is a decision only a test can keep, since the next reader of that loader will
 * see a blocked form and be tempted to relax it.
 */
import { CaptchaField } from "@/components/common/CaptchaField";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The callbacks Cloudflare takes when it renders a widget. */
interface WidgetOptions {
  sitekey: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

const widget = vi.hoisted(() => ({
  siteKey: "site-key",
  unreachable: false,
  /** What the stub last rendered with, so a test can drive its callbacks. */
  options: null as Record<string, unknown> | null,
  renders: 0,
}));

vi.mock("@/lib/turnstile", () => ({
  turnstileSiteKey: () => widget.siteKey,
  captchaConfigured: () => widget.siteKey !== "",
  loadTurnstile: () =>
    widget.unreachable
      ? Promise.reject(new Error("could not reach the challenge"))
      : Promise.resolve({
          render: (_host: unknown, options: Record<string, unknown>) => {
            widget.renders += 1;
            widget.options = options;
            return `widget-${widget.renders}`;
          },
          remove: () => {},
        }),
}));

/** Wait for the stub to have rendered, and read back what it was given. */
async function solvedWidget(): Promise<WidgetOptions> {
  await waitFor(() => expect(widget.options).not.toBeNull());
  return widget.options as unknown as WidgetOptions;
}

describe("CaptchaField", () => {
  beforeEach(() => {
    widget.siteKey = "site-key";
    widget.unreachable = false;
    widget.options = null;
    widget.renders = 0;
  });

  it("renders nothing where the build carries no site key", () => {
    widget.siteKey = "";
    const onToken = vi.fn();
    const { container } = render(<CaptchaField onToken={onToken} />);

    expect(container).toBeEmptyDOMElement();
    expect(onToken).not.toHaveBeenCalled();
  });

  it("hands the solved token to the form", async () => {
    const onToken = vi.fn();
    render(<CaptchaField onToken={onToken} />);

    (await solvedWidget()).callback?.("solved-token");
    expect(onToken).toHaveBeenCalledWith("solved-token");
  });

  it("takes the token back when the check expires", async () => {
    // A stale token is worse than none: the form would submit one the project
    // already refused, and the visitor would read that as a bad password.
    const onToken = vi.fn();
    render(<CaptchaField onToken={onToken} />);

    (await solvedWidget())["expired-callback"]?.();
    expect(onToken).toHaveBeenCalledWith(null);
  });

  it("fails closed when the challenge script cannot be fetched", async () => {
    widget.unreachable = true;
    const onToken = vi.fn();
    render(<CaptchaField onToken={onToken} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not reach the human check/i,
    );
    expect(onToken).toHaveBeenCalledWith(null);
  });

  it("reaches for the script again when asked, and only then", async () => {
    widget.unreachable = true;
    const user = userEvent.setup();
    render(<CaptchaField onToken={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /try again/i }));
    expect(widget.renders).toBe(0);

    // The retry is the only way back for a browser that briefly lost the
    // network, so it has to re-run the loader rather than clear the message.
    widget.unreachable = false;
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(widget.renders).toBe(1));
  });
});
