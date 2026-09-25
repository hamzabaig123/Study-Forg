import ChapterDetail from "@/pages/ChapterDetail";
import ClassDetail from "@/pages/ClassDetail";
import SubjectDetail from "@/pages/SubjectDetail";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import {
  makeChapter,
  makeChapterDetail,
  makeClass,
  makeClassDetail,
  makeSubject,
  makeSubjectDetail,
  makeTopic,
} from "@/test/fixtures";
import { createMockActor } from "@/test/mockActor";
import { renderRoute } from "@/test/render";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the class → subject → chapter → topic
 * drill-down. These pages are existing study behavior that must keep working
 * while the sidebar and router gain unrelated entries, so this freezes the
 * hierarchy rendering, the child links, and the create flows.
 */
describe("ClassDetail", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("renders the class header and links each subject to its detail route", async () => {
    const actor = createMockActor({
      getClass: vi.fn().mockResolvedValue(
        makeClassDetail({
          class: makeClass({ id: 1n, name: "Biology 101" }),
          subjects: [
            makeSubject({ id: 2n, name: "Cell Biology" }),
            makeSubject({ id: 5n, name: "Genetics" }),
          ],
        }),
      ),
      listSubjects: vi
        .fn()
        .mockResolvedValue([
          makeSubject({ id: 2n, name: "Cell Biology" }),
          makeSubject({ id: 5n, name: "Genetics" }),
        ]),
    });
    setMockActor(actor);

    await renderRoute(<ClassDetail />, {
      path: "/classes/$classId",
      initialPath: "/classes/1",
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Biology 101" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /cell biology/i })).toHaveAttribute(
      "href",
      "/subjects/2",
    );
    expect(screen.getByRole("link", { name: /genetics/i })).toHaveAttribute(
      "href",
      "/subjects/5",
    );
  });

  it("shows the empty state when the class has no subjects", async () => {
    const actor = createMockActor({
      getClass: vi.fn().mockResolvedValue(
        makeClassDetail({
          class: makeClass({ id: 1n, name: "Biology 101" }),
          subjects: [],
        }),
      ),
      listSubjects: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderRoute(<ClassDetail />, {
      path: "/classes/$classId",
      initialPath: "/classes/1",
    });

    expect(await screen.findByText(/no subjects yet/i)).toBeInTheDocument();
  });

  it("creates a subject through the dialog and calls the actor with the class id", async () => {
    const user = userEvent.setup();
    const createSubject = vi.fn().mockResolvedValue(makeSubject());
    const actor = createMockActor({
      getClass: vi.fn().mockResolvedValue(
        makeClassDetail({
          class: makeClass({ id: 1n, name: "Biology 101" }),
          subjects: [],
        }),
      ),
      listSubjects: vi.fn().mockResolvedValue([]),
      createSubject,
    });
    setMockActor(actor);

    await renderRoute(<ClassDetail />, {
      path: "/classes/$classId",
      initialPath: "/classes/1",
    });

    await user.click(
      await screen.findByRole("button", { name: /new subject/i }),
    );
    await user.type(await screen.findByLabelText(/^name$/i), "Genetics");
    await user.click(screen.getByRole("button", { name: /create subject/i }));

    await waitFor(() => {
      expect(createSubject).toHaveBeenCalledTimes(1);
    });
    expect(createSubject.mock.calls[0][0]).toBe(1n);
    expect(createSubject.mock.calls[0][1]).toBe("Genetics");
  });

  it("shows the not-found state when the class cannot be loaded", async () => {
    const actor = createMockActor({
      getClass: vi.fn().mockResolvedValue(null),
      listSubjects: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderRoute(<ClassDetail />, {
      path: "/classes/$classId",
      initialPath: "/classes/1",
    });

    await waitFor(() => {
      expect(screen.getByText(/class not found/i)).toBeInTheDocument();
    });
  });
});

describe("SubjectDetail", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("renders the subject header and links each chapter to its detail route", async () => {
    const actor = createMockActor({
      getSubject: vi.fn().mockResolvedValue(
        makeSubjectDetail({
          subject: makeSubject({ id: 2n, name: "Cell Biology" }),
          chapters: [makeChapter({ id: 3n, name: "Cell Structure" })],
        }),
      ),
      listChapters: vi
        .fn()
        .mockResolvedValue([makeChapter({ id: 3n, name: "Cell Structure" })]),
    });
    setMockActor(actor);

    await renderRoute(<SubjectDetail />, {
      path: "/subjects/$subjectId",
      initialPath: "/subjects/2",
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Cell Biology" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /cell structure/i }),
    ).toHaveAttribute("href", "/chapters/3");
  });

  it("shows the empty state when the subject has no chapters", async () => {
    const actor = createMockActor({
      getSubject: vi.fn().mockResolvedValue(
        makeSubjectDetail({
          subject: makeSubject({ id: 2n, name: "Cell Biology" }),
          chapters: [],
        }),
      ),
      listChapters: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderRoute(<SubjectDetail />, {
      path: "/subjects/$subjectId",
      initialPath: "/subjects/2",
    });

    expect(await screen.findByText(/no chapters yet/i)).toBeInTheDocument();
  });

  it("creates a chapter through the dialog and calls the actor with the subject id", async () => {
    const user = userEvent.setup();
    const createChapter = vi.fn().mockResolvedValue(makeChapter());
    const actor = createMockActor({
      getSubject: vi.fn().mockResolvedValue(
        makeSubjectDetail({
          subject: makeSubject({ id: 2n, name: "Cell Biology" }),
          chapters: [],
        }),
      ),
      listChapters: vi.fn().mockResolvedValue([]),
      createChapter,
    });
    setMockActor(actor);

    await renderRoute(<SubjectDetail />, {
      path: "/subjects/$subjectId",
      initialPath: "/subjects/2",
    });

    await user.click(
      await screen.findByRole("button", { name: /new chapter/i }),
    );
    await user.type(await screen.findByLabelText(/^name$/i), "Cell Structure");
    await user.click(screen.getByRole("button", { name: /create chapter/i }));

    await waitFor(() => {
      expect(createChapter).toHaveBeenCalledTimes(1);
    });
    expect(createChapter.mock.calls[0][0]).toBe(2n);
    expect(createChapter.mock.calls[0][1]).toBe("Cell Structure");
  });
});

describe("ChapterDetail", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("renders the chapter header and links each topic to its detail route", async () => {
    const actor = createMockActor({
      getChapter: vi.fn().mockResolvedValue(
        makeChapterDetail({
          chapter: makeChapter({ id: 3n, name: "Cell Structure" }),
          topics: [makeTopic({ id: 4n, name: "Mitochondria" })],
        }),
      ),
      listTopics: vi
        .fn()
        .mockResolvedValue([makeTopic({ id: 4n, name: "Mitochondria" })]),
    });
    setMockActor(actor);

    await renderRoute(<ChapterDetail />, {
      path: "/chapters/$chapterId",
      initialPath: "/chapters/3",
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Cell Structure" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /mitochondria/i })).toHaveAttribute(
      "href",
      "/topics/4",
    );
  });

  it("shows the empty state when the chapter has no topics", async () => {
    const actor = createMockActor({
      getChapter: vi.fn().mockResolvedValue(
        makeChapterDetail({
          chapter: makeChapter({ id: 3n, name: "Cell Structure" }),
          topics: [],
        }),
      ),
      listTopics: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderRoute(<ChapterDetail />, {
      path: "/chapters/$chapterId",
      initialPath: "/chapters/3",
    });

    expect(await screen.findByText(/no topics yet/i)).toBeInTheDocument();
  });

  it("creates a topic through the dialog and calls the actor with the chapter id", async () => {
    const user = userEvent.setup();
    const createTopic = vi.fn().mockResolvedValue(makeTopic());
    const actor = createMockActor({
      getChapter: vi.fn().mockResolvedValue(
        makeChapterDetail({
          chapter: makeChapter({ id: 3n, name: "Cell Structure" }),
          topics: [],
        }),
      ),
      listTopics: vi.fn().mockResolvedValue([]),
      createTopic,
    });
    setMockActor(actor);

    await renderRoute(<ChapterDetail />, {
      path: "/chapters/$chapterId",
      initialPath: "/chapters/3",
    });

    await user.click(await screen.findByRole("button", { name: /new topic/i }));
    await user.type(await screen.findByLabelText(/^name$/i), "Mitochondria");
    await user.click(screen.getByRole("button", { name: /create topic/i }));

    await waitFor(() => {
      expect(createTopic).toHaveBeenCalledTimes(1);
    });
    expect(createTopic.mock.calls[0][0]).toBe(3n);
    expect(createTopic.mock.calls[0][1]).toBe("Mitochondria");
  });
});
