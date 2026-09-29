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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useEmailPasswordAuth: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const changePassword = vi.fn();

describe("ChangePasswordSection", () => {
  beforeEach(() => {
    changePassword.mockReset();
    vi.mocked(useEmailPasswordAuth).mockReturnValue({
      changePassword,
    } as unknown as ReturnType<typeof useEmailPasswordAuth>);
  });

  async function fillAndSubmit() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Current password"), "the old secret");
    await user.type(screen.getByLabelText("New password"), "a brand new secret");
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

    expect(changePassword).toHaveBeenCalledWith(
      "the old secret",
      "a brand new secret",
      "a brand new secret",
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
