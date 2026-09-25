import ExportPage from "@/pages/ExportPage";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import {
  makeChapter,
  makeClass,
  makeSubject,
  makeTopic,
} from "@/test/fixtures";
import { createMockActor } from "@/test/mockActor";
import { renderWithProviders } from "@/test/render";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the export surface. The page must keep
 * offering CSV and PDF, keep the download action disabled until a target is
 * chosen, and keep calling the actor with the selected target and format.
 */
describe("ExportPage", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
    // jsdom implements neither the object-URL API nor anchor navigation, both
    // of which the download path uses. Stub them so a successful export does
    // not surface as an unhandled rejection.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the nothing-to-export state and a disabled download action", async () => {
    const actor = createMockActor({
      listClasses: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<ExportPage />);

    expect(
      await screen.findByText(/nothing to export yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download file/i }),
    ).toBeDisabled();
  });

  it("exports the selected topic as CSV through the actor", async () => {
    const user = userEvent.setup();
    const exportContent = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: {
        filename: "Mitochondria.csv",
        mimeType: "text/csv",
        content: "prompt\nWhich organelle produces ATP?",
      },
    });
    const actor = createMockActor({
      listClasses: vi.fn().mockResolvedValue([makeClass()]),
      listSubjects: vi.fn().mockResolvedValue([makeSubject()]),
      listChapters: vi.fn().mockResolvedValue([makeChapter()]),
      listTopics: vi.fn().mockResolvedValue([makeTopic()]),
      exportContent,
    });
    setMockActor(actor);

    await renderWithProviders(<ExportPage />);

    // The Radix triggers are not label-associated, so address them by their
    // stable app-owned test ids rather than by accessible name.
    const select = (ocid: string) => {
      const trigger = document.querySelector(`[data-ocid="${ocid}"]`);
      if (!trigger) throw new Error(`missing select ${ocid}`);
      return trigger as HTMLElement;
    };

    // Drill down: class → subject → chapter → topic.
    await user.click(select("export.class_select"));
    await user.click(
      await screen.findByRole("option", { name: "Biology 101" }),
    );

    await user.click(select("export.subject_select"));
    await user.click(
      await screen.findByRole("option", { name: "Cell Biology" }),
    );

    await user.click(select("export.chapter_select"));
    await user.click(
      await screen.findByRole("option", { name: "Cell Structure" }),
    );

    await user.click(select("export.topic_select"));
    await user.click(
      await screen.findByRole("option", { name: "Mitochondria" }),
    );

    await user.click(screen.getByRole("button", { name: /download file/i }));

    await waitFor(() => {
      expect(exportContent).toHaveBeenCalledTimes(1);
    });
    // The hook calls the actor positionally: (target, format).
    expect(exportContent.mock.calls[0][0]).toEqual({
      __kind__: "topic",
      topic: 4n,
    });
    expect(exportContent.mock.calls[0][1]).toBe("csv");
  });
});
