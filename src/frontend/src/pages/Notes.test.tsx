import { ThemeProvider } from "@/components/theme/ThemeProvider";
import Notes from "@/pages/Notes";
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
        { id: "b1", kind: "paragraph", text: "Mitosis has four phases." },
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
 * The private notes workspace. The page reads and mutates notes through the
 * mocked backend actor; the router registers the list and detail routes so the
 * create flow's navigation resolves.
 */
async function renderNotes() {
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
    component: Notes,
  });
  const noteDetailRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/notes/$noteId",
    component: () => <div data-testid="note-detail-route" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([notesRoute, noteDetailRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ["/notes"] }),
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

describe("Notes", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("lists the caller's notes with title, excerpt, and labels", async () => {
    const listNotes = vi.fn().mockResolvedValue([
      makeNote({
        id: 1n,
        title: "Cell division",
        subjectLabel: "Biology",
        chapterLabel: "Cell Cycle",
      }),
    ]);
    const listTrashedNotes = vi.fn().mockResolvedValue([]);
    setMockActor(createMockActor({ listNotes, listTrashedNotes }));

    await renderNotes();

    expect(await screen.findByText("Cell division")).toBeInTheDocument();
    expect(screen.getByText(/mitosis has four phases/i)).toBeInTheDocument();
    expect(screen.getByText("Biology")).toBeInTheDocument();
    expect(screen.getByText("Cell Cycle")).toBeInTheDocument();
  });

  it("shows the empty state when the caller has no notes", async () => {
    const listNotes = vi.fn().mockResolvedValue([]);
    const listTrashedNotes = vi.fn().mockResolvedValue([]);
    setMockActor(createMockActor({ listNotes, listTrashedNotes }));

    await renderNotes();

    expect(await screen.findByText("No notes yet")).toBeInTheDocument();
  });

  it("searches notes through the backend after the debounce settles", async () => {
    const user = userEvent.setup();
    const listNotes = vi.fn().mockResolvedValue([makeNote()]);
    const listTrashedNotes = vi.fn().mockResolvedValue([]);
    setMockActor(createMockActor({ listNotes, listTrashedNotes }));

    await renderNotes();

    await screen.findByText("Cell division");
    await user.type(screen.getByLabelText("Search notes"), "mitosis");

    await waitFor(() => {
      expect(listNotes).toHaveBeenCalledWith("mitosis");
    });
  });

  it("creates a note and navigates to its editor", async () => {
    const user = userEvent.setup();
    const listNotes = vi.fn().mockResolvedValue([]);
    const listTrashedNotes = vi.fn().mockResolvedValue([]);
    const createNote = vi.fn().mockResolvedValue(makeNote({ id: 9n }));
    setMockActor(createMockActor({ listNotes, listTrashedNotes, createNote }));

    await renderNotes();

    await user.click(await screen.findByRole("button", { name: /new note/i }));

    await waitFor(() => {
      expect(createNote).toHaveBeenCalled();
    });
    const [title, subject, chapter, topic, documentJson, searchText] =
      createNote.mock.calls[0];
    expect(title).toBe("Untitled note");
    expect(subject).toBeNull();
    expect(chapter).toBeNull();
    expect(topic).toBeNull();
    expect(JSON.parse(documentJson).blocks).toHaveLength(1);
    expect(searchText).toBe("");
    expect(await screen.findByTestId("note-detail-route")).toBeInTheDocument();
  });

  it("renames a note through the dialog", async () => {
    const user = userEvent.setup();
    const listNotes = vi.fn().mockResolvedValue([makeNote()]);
    const listTrashedNotes = vi.fn().mockResolvedValue([]);
    const renameNote = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: makeNote({ title: "Renamed" }),
    });
    setMockActor(createMockActor({ listNotes, listTrashedNotes, renameNote }));

    await renderNotes();

    await user.click(
      await screen.findByRole("button", { name: /rename cell division/i }),
    );
    const input = await screen.findByLabelText("Note title");
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.click(screen.getByRole("button", { name: /save title/i }));

    await waitFor(() => {
      expect(renameNote).toHaveBeenCalledWith(1n, "Renamed");
    });
  });

  it("moves a note to trash after confirmation", async () => {
    const user = userEvent.setup();
    const listNotes = vi.fn().mockResolvedValue([makeNote()]);
    const listTrashedNotes = vi.fn().mockResolvedValue([]);
    const softDeleteNote = vi
      .fn()
      .mockResolvedValue({ __kind__: "ok", ok: makeNote() });
    setMockActor(
      createMockActor({ listNotes, listTrashedNotes, softDeleteNote }),
    );

    await renderNotes();

    await user.click(
      await screen.findByRole("button", {
        name: /move cell division to trash/i,
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: /move to trash/i }),
    );

    await waitFor(() => {
      expect(softDeleteNote).toHaveBeenCalledWith(1n);
    });
  });

  it("restores a trashed note from the trash view", async () => {
    const user = userEvent.setup();
    const listNotes = vi.fn().mockResolvedValue([]);
    const listTrashedNotes = vi
      .fn()
      .mockResolvedValue([makeNote({ deletedAt: NOW })]);
    const restoreNote = vi
      .fn()
      .mockResolvedValue({ __kind__: "ok", ok: makeNote() });
    setMockActor(createMockActor({ listNotes, listTrashedNotes, restoreNote }));

    await renderNotes();

    await user.click(await screen.findByRole("tab", { name: /trash/i }));
    await user.click(await screen.findByRole("button", { name: /restore/i }));

    await waitFor(() => {
      expect(restoreNote).toHaveBeenCalledWith(1n);
    });
  });

  it("permanently deletes a trashed note after confirmation", async () => {
    const user = userEvent.setup();
    const listNotes = vi.fn().mockResolvedValue([]);
    const listTrashedNotes = vi
      .fn()
      .mockResolvedValue([makeNote({ deletedAt: NOW })]);
    const permanentlyDeleteNote = vi
      .fn()
      .mockResolvedValue({ __kind__: "ok", ok: null });
    setMockActor(
      createMockActor({ listNotes, listTrashedNotes, permanentlyDeleteNote }),
    );

    await renderNotes();

    await user.click(await screen.findByRole("tab", { name: /trash/i }));
    await user.click(
      await screen.findByRole("button", {
        name: /permanently delete cell division/i,
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: /delete forever/i }),
    );

    await waitFor(() => {
      expect(permanentlyDeleteNote).toHaveBeenCalledWith(1n);
    });
  });
});
