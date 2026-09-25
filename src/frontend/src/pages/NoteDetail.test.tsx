import { ThemeProvider } from "@/components/theme/ThemeProvider";
import NoteDetail from "@/pages/NoteDetail";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { createTestQueryClient } from "@/test/render";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = 1_700_000_000_000_000_000n;

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    status: "active",
    documentJson: JSON.stringify({
      version: 1,
      blocks: [
        { id: "b1", kind: "heading", text: "Mitosis" },
        { id: "b2", kind: "paragraph", text: "Four phases." },
      ],
    }),
    title: "Cell division",
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1n,
    ...overrides,
  };
}

/**
 * The note editor. Autosave, the stale-revision guard, and share-link
 * management are exercised against the mocked backend actor.
 */
async function renderNoteDetail(noteId = "1") {
  const queryClient = createTestQueryClient();
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "app",
    component: () => <Outlet />,
  });
  const notesRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/notes",
    component: () => <div data-testid="notes-route" />,
  });
  const noteDetailRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/notes/$noteId",
    component: NoteDetail,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([notesRoute, noteDetailRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: [`/notes/${noteId}`] }),
  });
  await router.load();
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("NoteDetail", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
    window.localStorage.clear();
  });

  it("loads the note and renders its title and preview", async () => {
    const getNote = vi.fn().mockResolvedValue(makeNote());
    const listNoteShares = vi.fn().mockResolvedValue([]);
    setMockActor(createMockActor({ getNote, listNoteShares }));

    const { container } = await renderNoteDetail();

    expect(
      await screen.findByDisplayValue("Cell division"),
    ).toBeInTheDocument();
    const preview = container.querySelector(
      '[data-ocid="note_detail.preview"]',
    );
    expect(preview).not.toBeNull();
    expect(
      within(preview as HTMLElement).getByText("Mitosis"),
    ).toBeInTheDocument();
    expect(
      within(preview as HTMLElement).getByText("Four phases."),
    ).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("autosaves an edit and reports the saved status", async () => {
    const user = userEvent.setup();
    const getNote = vi.fn().mockResolvedValue(makeNote());
    const listNoteShares = vi.fn().mockResolvedValue([]);
    const updateNote = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: makeNote({ revision: 2n, title: "Cell division revised" }),
    });
    setMockActor(createMockActor({ getNote, listNoteShares, updateNote }));

    await renderNoteDetail();

    const title = await screen.findByDisplayValue("Cell division");
    await user.clear(title);
    await user.type(title, "Cell division revised");

    await waitFor(
      () => {
        expect(updateNote).toHaveBeenCalled();
      },
      { timeout: 4000 },
    );
    const call = updateNote.mock.calls[0];
    expect(call[0]).toBe(1n);
    expect(call[1]).toBe("Cell division revised");
    expect(call[7]).toBe(1n);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("pauses autosave and warns when the revision is stale", async () => {
    const user = userEvent.setup();
    const getNote = vi.fn().mockResolvedValue(makeNote());
    const listNoteShares = vi.fn().mockResolvedValue([]);
    const updateNote = vi.fn().mockResolvedValue({
      __kind__: "err",
      err: {
        __kind__: "staleRevision",
        staleRevision: { expected: 1n, actual: 5n },
      },
    });
    setMockActor(createMockActor({ getNote, listNoteShares, updateNote }));

    await renderNoteDetail();

    const title = await screen.findByDisplayValue("Cell division");
    await user.clear(title);
    await user.type(title, "Conflicting edit");

    expect(
      await screen.findByText(
        /a newer version of this note exists/i,
        undefined,
        {
          timeout: 4000,
        },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reload server version/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /overwrite with mine/i }),
    ).toBeInTheDocument();
  });

  it("shows a failed status and a retry button when a save rejects", async () => {
    const user = userEvent.setup();
    const getNote = vi.fn().mockResolvedValue(makeNote());
    const listNoteShares = vi.fn().mockResolvedValue([]);
    const updateNote = vi.fn().mockRejectedValue(new Error("network down"));
    setMockActor(createMockActor({ getNote, listNoteShares, updateNote }));

    await renderNoteDetail();

    const title = await screen.findByDisplayValue("Cell division");
    await user.clear(title);
    await user.type(title, "Offline edit");

    expect(
      await screen.findByText("Failed", undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("creates a share link for the note", async () => {
    const user = userEvent.setup();
    const getNote = vi.fn().mockResolvedValue(makeNote());
    const listNoteShares = vi.fn().mockResolvedValue([]);
    const createNoteShare = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: {
        status: "active",
        token: "share-token",
        noteId: 1n,
        createdAt: NOW,
      },
    });
    setMockActor(createMockActor({ getNote, listNoteShares, createNoteShare }));

    await renderNoteDetail();

    await user.click(
      await screen.findByRole("button", { name: /create share link/i }),
    );

    await waitFor(() => {
      expect(createNoteShare).toHaveBeenCalledWith(1n);
    });
  });

  it("lists an active share and revokes it after confirmation", async () => {
    const user = userEvent.setup();
    const getNote = vi.fn().mockResolvedValue(makeNote());
    const listNoteShares = vi
      .fn()
      .mockResolvedValue([
        { status: "active", token: "share-token", noteId: 1n, createdAt: NOW },
      ]);
    const revokeNoteShare = vi
      .fn()
      .mockResolvedValue({ __kind__: "ok", ok: null });
    setMockActor(createMockActor({ getNote, listNoteShares, revokeNoteShare }));

    await renderNoteDetail();

    expect(
      await screen.findByDisplayValue(
        "http://localhost:3000/shared/note/share-token",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /revoke link/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: /revoke link/i }),
    );

    await waitFor(() => {
      expect(revokeNoteShare).toHaveBeenCalledWith("share-token");
    });
  });

  it("shows the not-found state when the note does not resolve", async () => {
    const getNote = vi.fn().mockResolvedValue(null);
    const listNoteShares = vi.fn().mockResolvedValue([]);
    setMockActor(createMockActor({ getNote, listNoteShares }));

    await renderNoteDetail();

    expect(await screen.findByText("Note not found")).toBeInTheDocument();
  });
});
