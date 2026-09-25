import { SESSION_KEY } from "@/lib/localAuth";
import SettingsPage from "@/pages/SettingsPage";
import { setLocalAccount, setMockActor } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderWithProviders } from "@/test/render";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = 1_700_000_000_000_000_000n;

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Ada",
    studyGoal: "Pass the exam",
    dailyTarget: 20n,
    appearance: "light",
    updatedAt: NOW,
    ...overrides,
  };
}

/**
 * Account settings. The page seeds a local draft from the backend record and
 * saves it back through the mocked actor; the danger zone requires a typed
 * phrase and a re-authentication step before it signs the caller out.
 */
describe("SettingsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setLocalAccount({ name: "Ada" });
  });

  it("seeds the form from the caller's saved settings", async () => {
    const getMySettings = vi.fn().mockResolvedValue(makeSettings());
    setMockActor(createMockActor({ getMySettings }));

    await renderWithProviders(<SettingsPage />);

    expect(await screen.findByDisplayValue("Ada")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pass the exam")).toBeInTheDocument();
    expect(screen.getByDisplayValue("20")).toBeInTheDocument();
    expect(screen.getByText("Synced")).toBeInTheDocument();
  });

  it("saves an edited profile through the backend", async () => {
    const user = userEvent.setup();
    const getMySettings = vi.fn().mockResolvedValue(makeSettings());
    const saveMySettings = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: makeSettings({ displayName: "Grace" }),
    });
    setMockActor(createMockActor({ getMySettings, saveMySettings }));

    await renderWithProviders(<SettingsPage />);

    const name = await screen.findByDisplayValue("Ada");
    await user.clear(name);
    await user.type(name, "Grace");

    const save = await screen.findByRole("button", { name: /save changes/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => {
      expect(saveMySettings).toHaveBeenCalledWith(
        "Grace",
        "Pass the exam",
        20n,
        "light",
      );
    });
  });

  it("blocks saving when the daily target is not a whole number in range", async () => {
    const user = userEvent.setup();
    const getMySettings = vi.fn().mockResolvedValue(makeSettings());
    const saveMySettings = vi.fn();
    setMockActor(createMockActor({ getMySettings, saveMySettings }));

    await renderWithProviders(<SettingsPage />);

    const target = await screen.findByDisplayValue("20");
    await user.clear(target);
    await user.type(target, "0");

    expect(await screen.findByText(/between 1 and 1000/i)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: /save changes/i });
    expect(save).toBeDisabled();
    expect(saveMySettings).not.toHaveBeenCalled();
  });

  it("surfaces a backend invalidInput error on the matching field", async () => {
    const user = userEvent.setup();
    const getMySettings = vi.fn().mockResolvedValue(makeSettings());
    const saveMySettings = vi.fn().mockResolvedValue({
      __kind__: "err",
      err: {
        __kind__: "invalidInput",
        invalidInput: "Display name is too long",
      },
    });
    setMockActor(createMockActor({ getMySettings, saveMySettings }));

    await renderWithProviders(<SettingsPage />);

    const name = await screen.findByDisplayValue("Ada");
    await user.clear(name);
    await user.type(name, "A very long name");
    const save = await screen.findByRole("button", { name: /save changes/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    expect(
      await screen.findByText("Display name is too long"),
    ).toBeInTheDocument();
  });

  it("applies a theme immediately when its card is selected", async () => {
    const user = userEvent.setup();
    const getMySettings = vi.fn().mockResolvedValue(makeSettings());
    setMockActor(createMockActor({ getMySettings }));

    const { container } = await renderWithProviders(<SettingsPage />);

    await screen.findByDisplayValue("Ada");
    const dark = container.querySelector(
      '[data-ocid="settings.appearance.theme_card.dark"]',
    ) as HTMLButtonElement;
    expect(dark).not.toBeNull();
    await user.click(dark);

    expect(dark).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("exports the caller's data through the backend", async () => {
    const user = userEvent.setup();
    const getMySettings = vi.fn().mockResolvedValue(makeSettings());
    const exportMyData = vi.fn().mockResolvedValue({
      content: "{}",
      mimeType: "application/json",
      filename: "studyforge-export.json",
    });
    setMockActor(createMockActor({ getMySettings, exportMyData }));
    // jsdom does not implement object URLs; the page builds a download link.
    const createObjectURL = vi.fn().mockReturnValue("blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    await renderWithProviders(<SettingsPage />);

    await user.click(
      await screen.findByRole("button", { name: /download my data/i }),
    );

    await waitFor(() => {
      expect(exportMyData).toHaveBeenCalled();
    });
  });

  it("requires the typed phrase and re-authentication before clearing local data", async () => {
    const user = userEvent.setup();
    const getMySettings = vi.fn().mockResolvedValue(makeSettings());
    setMockActor(createMockActor({ getMySettings }));
    expect(window.localStorage.getItem(SESSION_KEY)).not.toBeNull();

    await renderWithProviders(<SettingsPage />);

    await user.click(
      await screen.findByRole("button", { name: /clear local data/i }),
    );

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: /clear local data/i,
    });
    expect(confirm).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText(/type .clear local data. to confirm/i),
      "clear local data",
    );
    await user.click(within(dialog).getByRole("button", { name: /verify/i }));

    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => {
      expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    });
  });
});
