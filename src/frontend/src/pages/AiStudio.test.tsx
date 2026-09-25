import AiStudio from "@/pages/AiStudio";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderWithProviders } from "@/test/render";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("AI Studio", () => {
  beforeEach(() => {
    localStorage.clear();
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("shows the built-in AI state and a visible way to add a personal key when none is configured", async () => {
    const actor = createMockActor({
      getAiConfig: vi.fn().mockResolvedValue({
        hasPersonalKey: false,
        keyHint: [],
      }),
      listClasses: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<AiStudio />);

    expect(
      await screen.findByText(/using the built-in ai/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /add a personal key/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/no key required/i).length).toBeGreaterThan(0);
  });

  it("shows the personal-key state when a key is configured", async () => {
    const actor = createMockActor({
      getAiConfig: vi.fn().mockResolvedValue({
        hasPersonalKey: true,
        keyHint: ["sk-…1234"],
      }),
      listClasses: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<AiStudio />);

    expect(
      await screen.findByText(/using your personal openai key/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /manage key/i }),
    ).toBeInTheDocument();
  });

  it("renders the document extraction uploader by default", async () => {
    const actor = createMockActor({
      getAiConfig: vi.fn().mockResolvedValue({
        hasPersonalKey: false,
        keyHint: [],
      }),
      listClasses: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<AiStudio />);

    expect(
      await screen.findByText(/upload document or image/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/pdf \(text or scanned\), png, jpg, webp, or txt/i),
    ).toBeInTheDocument();
  });

  it("switches to prompt question generator tab and displays prompt form", async () => {
    const user = userEvent.setup();
    const actor = createMockActor({
      getAiConfig: vi.fn().mockResolvedValue({
        hasPersonalKey: false,
        keyHint: [],
      }),
      listClasses: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<AiStudio />);

    const promptTab = await screen.findByRole("tab", {
      name: /prompt question generator/i,
    });
    await user.click(promptTab);

    expect(
      await screen.findByText(/no drafts generated yet/i),
    ).toBeInTheDocument();
  });
});
