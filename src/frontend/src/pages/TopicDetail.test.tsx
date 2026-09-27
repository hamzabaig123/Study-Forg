import { ThemeProvider } from "@/components/theme/ThemeProvider";
import TopicDetail from "@/pages/TopicDetail";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { makeQuestion, makeTopic } from "@/test/fixtures";
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
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Render a page that reads route params, at the real route path, so
 * `useParams({ from: "/app/topics/$topicId" })` resolves.
 */
async function renderTopicDetail(topicId: string) {
  const queryClient = createTestQueryClient();
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "app",
    component: () => <Outlet />,
  });
  const topicRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/topics/$topicId",
    component: TopicDetail,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([topicRoute])]),
    history: createMemoryHistory({ initialEntries: [`/topics/${topicId}`] }),
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

describe("TopicDetail", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("lists the questions in the topic", async () => {
    const actor = createMockActor({
      getTopic: vi.fn().mockResolvedValue({
        topic: makeTopic({ id: 4n, name: "Mitochondria" }),
        questions: [],
      }),
      getTopicPath: vi.fn().mockResolvedValue(null),
      listQuestions: vi
        .fn()
        .mockResolvedValue([
          makeQuestion({ id: 10n, prompt: "Which organelle produces ATP?" }),
        ]),
    });
    setMockActor(actor);

    await renderTopicDetail("4");

    expect(
      await screen.findByText("Which organelle produces ATP?"),
    ).toBeInTheDocument();
  });

  it("creates a multiple-choice question through the form", async () => {
    const user = userEvent.setup();
    const createQuestion = vi.fn().mockResolvedValue(makeQuestion());
    const actor = createMockActor({
      getTopic: vi.fn().mockResolvedValue({
        topic: makeTopic({ id: 4n, name: "Mitochondria" }),
        questions: [],
      }),
      getTopicPath: vi.fn().mockResolvedValue(null),
      listQuestions: vi.fn().mockResolvedValue([]),
      createQuestion,
    });
    setMockActor(actor);

    await renderTopicDetail("4");

    await user.click(
      await screen.findByRole("button", { name: /new question/i }),
    );

    const prompt = await screen.findByLabelText(/prompt/i);
    await user.type(prompt, "Which organelle produces ATP?");
    await user.type(screen.getByPlaceholderText("Option 1"), "Mitochondria");
    await user.type(screen.getByPlaceholderText("Option 2"), "Nucleus");

    await user.click(screen.getByRole("button", { name: /add question/i }));

    await waitFor(() => {
      expect(createQuestion).toHaveBeenCalledTimes(1);
    });
    const [topicId, promptText, questionType, answer] =
      createQuestion.mock.calls[0];
    expect(topicId).toBe(4n);
    expect(promptText).toBe("Which organelle produces ATP?");
    expect(questionType).toBe("multipleChoice");
    expect(answer.__kind__).toBe("multipleChoice");
    expect(answer.multipleChoice.options).toHaveLength(2);
  });

  it("creates a true/false question through the form", async () => {
    const user = userEvent.setup();
    const createQuestion = vi.fn().mockResolvedValue(makeQuestion());
    const actor = createMockActor({
      getTopic: vi.fn().mockResolvedValue({
        topic: makeTopic({ id: 4n, name: "Mitochondria" }),
        questions: [],
      }),
      getTopicPath: vi.fn().mockResolvedValue(null),
      listQuestions: vi.fn().mockResolvedValue([]),
      createQuestion,
    });
    setMockActor(actor);

    await renderTopicDetail("4");

    await user.click(
      await screen.findByRole("button", { name: /new question/i }),
    );
    await user.type(
      await screen.findByLabelText(/prompt/i),
      "The mitochondria is the powerhouse of the cell.",
    );

    // Switch the type select to True / false.
    await user.click(screen.getByRole("combobox", { name: /question type/i }));
    await user.click(
      await screen.findByRole("option", { name: /true \/ false/i }),
    );

    await user.click(screen.getByRole("button", { name: /add question/i }));

    await waitFor(() => {
      expect(createQuestion).toHaveBeenCalledTimes(1);
    });
    const [, , questionType, answer] = createQuestion.mock.calls[0];
    expect(questionType).toBe("trueFalse");
    expect(answer.__kind__).toBe("trueFalse");
  });

  it("creates a short-answer question through the form", async () => {
    const user = userEvent.setup();
    const createQuestion = vi.fn().mockResolvedValue(makeQuestion());
    const actor = createMockActor({
      getTopic: vi.fn().mockResolvedValue({
        topic: makeTopic({ id: 4n, name: "Mitochondria" }),
        questions: [],
      }),
      getTopicPath: vi.fn().mockResolvedValue(null),
      listQuestions: vi.fn().mockResolvedValue([]),
      createQuestion,
    });
    setMockActor(actor);

    await renderTopicDetail("4");

    await user.click(
      await screen.findByRole("button", { name: /new question/i }),
    );
    await user.type(
      await screen.findByLabelText(/prompt/i),
      "Name the powerhouse of the cell.",
    );

    await user.click(screen.getByRole("combobox", { name: /question type/i }));
    await user.click(
      await screen.findByRole("option", { name: /short answer/i }),
    );

    await user.type(
      await screen.findByLabelText(/expected answer/i),
      "Mitochondria",
    );

    await user.click(screen.getByRole("button", { name: /add question/i }));

    await waitFor(() => {
      expect(createQuestion).toHaveBeenCalledTimes(1);
    });
    const [, , questionType, answer] = createQuestion.mock.calls[0];
    expect(questionType).toBe("shortAnswer");
    expect(answer.__kind__).toBe("shortAnswer");
    expect(answer.shortAnswer.expected).toBe("Mitochondria");
  });

  it("routes the practice and timed-test actions into the builder, inert without questions", async () => {
    const actor = createMockActor({
      getTopic: vi.fn().mockResolvedValue({
        topic: makeTopic({ id: 4n, name: "Mitochondria" }),
        questions: [],
      }),
      getTopicPath: vi.fn().mockResolvedValue(null),
      listQuestions: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderTopicDetail("4");

    // The actions are links into /test-builder (preselected and mode-set);
    // with an empty topic they carry aria-disabled rather than a disabled
    // button, so the anchor is rendered but styled and marked inert.
    const practice = await screen.findByRole("link", {
      name: /^practice$/i,
    });
    expect(practice).toHaveAttribute("aria-disabled", "true");
    expect(practice).toHaveAttribute(
      "href",
      expect.stringContaining("/test-builder"),
    );
    const timed = screen.getByRole("link", { name: /timed test/i });
    expect(timed).toHaveAttribute("aria-disabled", "true");
    expect(timed.getAttribute("href")).toContain("mode=timed");
  });
});
