/**
 * The signed-in password form.
 *
 * The store is what refuses a change without the current password
 * (`session.test.ts` proves that), so what this file owns is the two ways the
 * form alone can break the guarantee: dropping the current-password field, and
 * swallowing the project's reason when it says no.
 */
import { ChangePasswordSection } from "@/components/settings/ChangePasswordSection";
import { useEmailPasswordAuth } from "@/hooks/useAuth";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useEmailPasswordAuth: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

/**
 * A Turnstile that solves itself the moment it is asked.
 *
 * The real script cannot load in jsdom and nobody can click a widget here, so
 * the stub hands back a token from its own `callback` and counts the renders —
 * the two things this form can actually get wrong: submitting ahead of the
 * check, and reusing a token the project already refused. `siteKey` is a
 * mutable hoisted value because the same form has to be tested configured and
 * unconfigured.
 */
const widget = vi.hoisted(() => ({ siteKey: "", renders: 0 }));

vi.mock("@/lib/turnstile", () => ({
  turnstileSiteKey: () => widget.siteKey,
  captchaConfigured: () => widget.siteKey !== "",
  loadTurnstile: () =>
    Promise.resolve({
      render: (
        _host: unknown,
        options: { callback?: (token: string) => void },
      ) => {
        widget.renders += 1;
        options.callback?.(`token-${widget.renders}`);
        return `widget-${widget.renders}`;
      },
      remove: () => {},
    }),
}));

const changePassword = vi.fn();

describe("ChangePasswordSection", () => {
  beforeEach(() => {
    changePassword.mockReset();
    widget.siteKey = "";
    widget.renders = 0;
    vi.mocked(useEmailPasswordAuth).mockReturnValue({
      changePassword,
    } as unknown as ReturnType<typeof useEmailPasswordAuth>);
  });

  async function fillAndSubmit() {
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Current password"),
      "the old secret",
    );
    await user.type(
      screen.getByLabelText("New password"),
      "a brand new secret",
    );
    await user.type(
      screen.getByLabelText("Repeat new password"),
      "a brand new secret",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    return user;
  }

  it("asks for the current password before anything else", () => {
    render(<ChangePasswordSection />);
    const current = screen.getByLabelText("Current password");
    expect(current).toHaveAttribute("type", "password");
    // A field the password manager will not refill is a field people paste into
    // the wrong box.
    expect(current).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("sends the three passwords it was given", async () => {
    changePassword.mockResolvedValue(undefined);
    render(<ChangePasswordSection />);

    await fillAndSubmit();

    // The fourth argument is the captcha token, and with no site key in the
    // build there is no widget to produce one — the call the store sees is the
    // call it saw before captcha existed.
    expect(changePassword).toHaveBeenCalledWith(
      "the old secret",
      "a brand new secret",
      "a brand new secret",
      undefined,
    );
    expect(widget.renders).toBe(0);
  });

  it("waits for the check before it will change the password", async () => {
    widget.siteKey = "site-key";
    changePassword.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChangePasswordSection />);

    await user.type(
      screen.getByLabelText("Current password"),
      "the old secret",
    );
    await user.type(
      screen.getByLabelText("New password"),
      "a brand new secret",
    );
    await user.type(
      screen.getByLabelText("Repeat new password"),
      "a brand new secret",
    );

    // The stub solves on the way in, so the form unlocks as soon as the token
    // lands — and the token it then sends is the widget's, not an empty string.
    const submit = await screen.findByRole("button", {
      name: "Change password",
    });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(changePassword).toHaveBeenCalledWith(
      "the old secret",
      "a brand new secret",
      "a brand new secret",
      "token-1",
    );
  });

  it("asks for a fresh check after a refusal", async () => {
    // A token is single-use: the grant that carried it has already spent it, so
    // a second attempt with the same one would be refused for a reason the
    // visitor cannot act on.
    widget.siteKey = "site-key";
    changePassword
      .mockRejectedValueOnce(new Error("The current password is incorrect."))
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChangePasswordSection />);

    await user.type(screen.getByLabelText("Current password"), "wrong secret");
    await user.type(
      screen.getByLabelText("New password"),
      "a brand new secret",
    );
    await user.type(
      screen.getByLabelText("Repeat new password"),
      "a brand new secret",
    );
    const submit = screen.getByRole("button", { name: "Change password" });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The current password is incorrect.",
    );
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(changePassword).toHaveBeenLastCalledWith(
      "wrong secret",
      "a brand new secret",
      "a brand new secret",
      "token-2",
    );
  });

  it("keeps the store's reason on the card", async () => {
    changePassword.mockRejectedValue(
      new Error("The current password is incorrect."),
    );
    render(<ChangePasswordSection />);

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The current password is incorrect.",
    );
  });

  it("offers nothing where there is no password to change", () => {
    // The dev mock keeps its accounts in this browser and Internet Identity has
    // no password at all; a form there would be a promise nothing can keep.
    vi.mocked(useEmailPasswordAuth).mockReturnValue({
      changePassword: null,
    } as unknown as ReturnType<typeof useEmailPasswordAuth>);

    render(<ChangePasswordSection />);

    expect(screen.queryByLabelText("Current password")).toBe(null);
  });
});
