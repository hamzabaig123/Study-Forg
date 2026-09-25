import SharedNoteView from "@/pages/SharedNoteView";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderPublicRoute } from "@/test/render";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = 1_700_000_000_000_000_000n;
const TOKEN = "note-share-token";

function makeSharedNote(overrides: Record<string, unknown> = {}) {
  return {
    title: "Cell division",
    documentJson: JSON.stringify({
      version: 1,
      blocks: [
        { id: "b1", kind: "heading", text: "Mitosis" },
        { id: "b2", kind: "paragraph", text: "Four phases." },
        { id: "b3", kind: "bulletList", items: ["Prophase", "Metaphase"] },
        { id: "b4", kind: "callout", text: "Remember the spindle." },
        { id: "b5", kind: "formula", text: "2n -> 2n" },
        { id: "b6", kind: "divider" },
      ],
    }),
    updatedAt: NOW,
    revision: 1n,
    ...overrides,
  };
}

/**
 * Public read-only shared note. Anonymous callers are allowed; the share token
 * in the URL is the only credential. The backend actor is mocked, so this
 * proves the page's own loading/unavailable/rendered states, not the canister's
 * authorization or revocation behavior.
 */
describe("SharedNoteView", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: false }));
  });

  it("shows the loading state while the shared note resolves", async () => {
    // A promise that never settles keeps the query in its loading state.
    const getSharedNote = vi.fn().mockReturnValue(new Promise(() => {}));
    setMockActor(createMockActor({ getSharedNote }));

    await renderPublicRoute(<SharedNoteView />, {
      path: "/shared/note/$token",
      initialPath: `/shared/note/${TOKEN}`,
    });

    expect(
      document.querySelector('[data-ocid="shared_note.loading_state"]'),
    ).not.toBeNull();
    expect(getSharedNote).toHaveBeenCalledWith(TOKEN);
  });

  it("shows the unavailable state for an invalid or revoked token", async () => {
    const getSharedNote = vi.fn().mockResolvedValue(null);
    setMockActor(createMockActor({ getSharedNote }));

    await renderPublicRoute(<SharedNoteView />, {
      path: "/shared/note/$token",
      initialPath: "/shared/note/revoked-token",
    });

    expect(
      await screen.findByText("This note isn't available"),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="shared_note.unavailable_state"]'),
    ).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /back to studyforge/i }),
    ).toHaveAttribute("href", "/");
    expect(document.querySelector('[data-ocid="shared_note.page"]')).toBeNull();
  });

  it("shows the unavailable state when the share lookup rejects", async () => {
    const getSharedNote = vi.fn().mockRejectedValue(new Error("not found"));
    setMockActor(createMockActor({ getSharedNote }));

    await renderPublicRoute(<SharedNoteView />, {
      path: "/shared/note/$token",
      initialPath: "/shared/note/deleted-token",
    });

    expect(
      await screen.findByText("This note isn't available"),
    ).toBeInTheDocument();
  });

  it("renders the title and every block of a valid shared note", async () => {
    const getSharedNote = vi.fn().mockResolvedValue(makeSharedNote());
    setMockActor(createMockActor({ getSharedNote }));

    await renderPublicRoute(<SharedNoteView />, {
      path: "/shared/note/$token",
      initialPath: `/shared/note/${TOKEN}`,
    });

    const page = await screen.findByRole("heading", { name: "Cell division" });
    expect(page).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="shared_note.page"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-ocid="shared_note.updated_at"]'),
    ).not.toBeNull();

    const renderer = document.querySelector(
      '[data-ocid="note.renderer"]',
    ) as HTMLElement;
    expect(renderer).not.toBeNull();
    expect(within(renderer).getByText("Mitosis")).toBeInTheDocument();
    expect(within(renderer).getByText("Four phases.")).toBeInTheDocument();
    expect(within(renderer).getByText("Prophase")).toBeInTheDocument();
    expect(within(renderer).getByText("Metaphase")).toBeInTheDocument();
    expect(
      within(renderer).getByText("Remember the spindle."),
    ).toBeInTheDocument();
    expect(within(renderer).getByText("2n -> 2n")).toBeInTheDocument();
    expect(renderer.querySelector('[data-block="divider"]')).not.toBeNull();
  });

  it("falls back to 'Untitled note' when the shared note has no title", async () => {
    const getSharedNote = vi
      .fn()
      .mockResolvedValue(makeSharedNote({ title: "" }));
    setMockActor(createMockActor({ getSharedNote }));

    await renderPublicRoute(<SharedNoteView />, {
      path: "/shared/note/$token",
      initialPath: `/shared/note/${TOKEN}`,
    });

    expect(
      await screen.findByRole("heading", { name: "Untitled note" }),
    ).toBeInTheDocument();
  });
});
