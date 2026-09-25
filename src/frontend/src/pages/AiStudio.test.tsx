/**
 * Journey coverage for the rebuilt AI Studio.
 *
 * These drive the real pipeline — paste text, offline parse, review, import —
 * against a mocked actor. A file upload is not exercised here because reading a
 * PDF needs the browser's canvas and the pdf.js worker; the parsers themselves
 * are covered in `lib/ai/questions.test.ts`.
 */

import { useStudioStore } from "@/lib/ai/studioStore";
import AiStudio from "@/pages/AiStudio";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { type MockActor, createMockActor } from "@/test/mockActor";
import { renderWithProviders } from "@/test/render";
import { QuestionType } from "@/types";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PASTED_QUESTIONS = `1. Which gas do plants absorb?
A) Oxygen
B) Carbon dioxide
C) Nitrogen
Answer: B

2. Define photosynthesis.
Answer: The process plants use to make food from light.`;

const TARGET = {
  classId: "10",
  subjectId: "20",
  chapterId: "30",
  topicId: "40",
};

const SOURCE = {
  fileName: "paper.pdf",
  engine: "offline" as const,
  providerName: null,
};

/** What a running local Ollama answers `/api/tags` with. */
const ollamaTags = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    models: [{ name: "qwen2.5vl:7b" }, { name: "llama3.1:8b" }],
  }),
});

function contentActor(overrides: Partial<MockActor> = {}): MockActor {
  return createMockActor({
    listClasses: vi.fn().mockResolvedValue([{ id: 10n, name: "Grade 11" }]),
    listSubjects: vi.fn().mockResolvedValue([{ id: 20n, name: "Physics" }]),
    listChapters: vi.fn().mockResolvedValue([{ id: 30n, name: "Light" }]),
    listTopics: vi
      .fn()
      .mockResolvedValue([{ id: 40n, name: "Photosynthesis" }]),
    createQuestion: vi.fn().mockResolvedValue({ id: 907n }),
    ...overrides,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  setMockAuth(createAuthState());
  useStudioStore.setState({
    drafts: [],
    source: null,
    target: { classId: null, subjectId: null, chapterId: null, topicId: null },
    filters: { status: "all", kind: "all", query: "" },
  });
});

describe("AI Studio", () => {
  it("opens on an empty queue and states that parsing runs offline", async () => {
    setMockActor(contentActor());

    await renderWithProviders(<AiStudio />);

    expect(
      await screen.findByRole("heading", {
        name: /turn a pdf or image into questions/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Offline parser").length).toBeGreaterThan(0);
    expect(await screen.findByText(/no drafts yet/i)).toBeInTheDocument();
    // Nothing may reach the question bank before the reviewer approves it.
    expect(screen.queryByText(/approved$/i)).toBeNull();
  });

  it("parses pasted questions into a review queue without a key", async () => {
    const user = userEvent.setup();
    setMockActor(contentActor());

    await renderWithProviders(<AiStudio />);

    await user.click(await screen.findByRole("tab", { name: /paste text/i }));
    fireEvent.change(screen.getByLabelText(/questions to extract/i), {
      target: { value: PASTED_QUESTIONS },
    });
    await user.click(
      await screen.findByRole("button", {
        name: /parse questions from text/i,
      }),
    );

    expect(
      await screen.findByText("Which gas do plants absorb?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Carbon dioxide")).toBeInTheDocument();
    expect(screen.getByText("Define photosynthesis.")).toBeInTheDocument();
    expect(screen.getByText(/2 drafts from pasted text/i)).toBeInTheDocument();
    expect(
      screen.getByText(/2 to review · 0 approved · 0 saved/),
    ).toBeInTheDocument();
  });

  it("saves an approved MCQ into the selected topic", async () => {
    const user = userEvent.setup();
    const actor = contentActor();
    setMockActor(actor);
    useStudioStore.getState().replaceQueue(
      [
        {
          id: "draft-1",
          kind: "mcq",
          question: "Which gas do plants absorb?",
          options: ["Oxygen", "Carbon dioxide", "Nitrogen"],
          correctIndex: 1,
          answer: "Carbon dioxide",
          explanation: "Plants take in CO2.",
          inferred: false,
          page: null,
        },
      ],
      SOURCE,
    );
    useStudioStore.getState().setTarget(TARGET);

    await renderWithProviders(<AiStudio />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: /save 1 approved/i }));

    await waitFor(() => {
      expect(actor.createQuestion).toHaveBeenCalledWith(
        40n,
        "Which gas do plants absorb?",
        QuestionType.multipleChoice,
        {
          __kind__: "multipleChoice",
          multipleChoice: {
            options: [
              { id: 1n, text: "Oxygen" },
              { id: 2n, text: "Carbon dioxide" },
              { id: 3n, text: "Nitrogen" },
            ],
            correctOptionId: 2n,
          },
        },
        "Plants take in CO2.",
      );
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("blocks a batch save until a topic is chosen", async () => {
    const user = userEvent.setup();
    setMockActor(contentActor());
    useStudioStore.getState().replaceQueue(
      [
        {
          id: "draft-1",
          kind: "qa",
          question: "Define photosynthesis.",
          options: [],
          correctIndex: null,
          answer: "Making food from light.",
          explanation: "",
          inferred: false,
          page: null,
        },
      ],
      SOURCE,
    );

    await renderWithProviders(<AiStudio />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));
    expect(
      screen.getByRole("button", { name: /save 1 approved/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/choose a target topic above/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Pick a topic")).toBeInTheDocument();
  });

  it("filters the queue by type and search text", async () => {
    const user = userEvent.setup();
    setMockActor(contentActor());
    useStudioStore.getState().replaceQueue(
      [
        {
          id: "draft-1",
          kind: "mcq",
          question: "Which gas do plants absorb?",
          options: ["Oxygen", "Carbon dioxide"],
          correctIndex: 1,
          answer: "Carbon dioxide",
          explanation: "",
          inferred: false,
          page: null,
        },
        {
          id: "draft-2",
          kind: "qa",
          question: "Define photosynthesis.",
          options: [],
          correctIndex: null,
          answer: "Making food from light.",
          explanation: "",
          inferred: false,
          page: null,
        },
      ],
      SOURCE,
    );

    await renderWithProviders(<AiStudio />);
    await screen.findByText("Which gas do plants absorb?");

    await user.click(screen.getByRole("button", { name: "Q&A" }));
    expect(screen.getByText("Define photosynthesis.")).toBeInTheDocument();
    expect(
      screen.queryByText("Which gas do plants absorb?"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "MCQs" }));
    fireEvent.change(screen.getByLabelText(/search drafts/i), {
      target: { value: "photosynthesis" },
    });
    expect(
      await screen.findByText(/no drafts match these filters/i),
    ).toBeInTheDocument();
  });

  it("connects a key from the in-page dialog and switches the engine", async () => {
    const user = userEvent.setup();
    setMockActor(contentActor());

    await renderWithProviders(<AiStudio />);

    await user.click(
      await screen.findByRole("button", { name: /connect ai key/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /gemini/i }));
    fireEvent.change(within(dialog).getByLabelText(/gemini key/i), {
      target: { value: "AIza-test-key-123456" },
    });
    await user.click(
      within(dialog).getByRole("button", { name: /use google gemini/i }),
    );

    await waitFor(() => {
      expect(window.localStorage.getItem("studyforge.ai.gemini_key")).toBe(
        "AIza-test-key-123456",
      );
    });
    expect(window.localStorage.getItem("studyforge.ai.provider")).toBe(
      "gemini",
    );
    // The current Flash model is used unless the reviewer picks another.
    expect(window.localStorage.getItem("studyforge.ai.model")).toBeNull();
    expect(
      await screen.findByText("Extract all MCQs and Q&A"),
    ).toBeInTheDocument();
    // The engine badge now names the connected provider, and the dialog is gone.
    expect(screen.getAllByText("Google Gemini").length).toBeGreaterThan(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers a provider's models and remembers the one picked", async () => {
    const user = userEvent.setup();
    setMockActor(contentActor());
    vi.stubGlobal("fetch", ollamaTags);

    await renderWithProviders(<AiStudio />);
    await user.click(
      await screen.findByRole("button", { name: /connect ai key/i }),
    );
    const dialog = await screen.findByRole("dialog");

    // Gemini's list is fixed, so the picker opens on the newest Flash model.
    const geminiModel = within(dialog).getByRole("combobox", {
      name: /gemini model/i,
    });
    expect(geminiModel).toHaveTextContent("Gemini 3.8 Flash");

    // Ollama needs no key; its models come from the local server.
    await user.click(within(dialog).getByRole("radio", { name: /ollama/i }));
    expect(
      await within(dialog).findByText("No key needed"),
    ).toBeInTheDocument();
    const ollamaModel = within(dialog).getByRole("combobox", {
      name: /ollama model/i,
    });
    expect(ollamaModel).toHaveTextContent("qwen2.5vl:7b");

    await user.click(ollamaModel);
    await user.click(
      await screen.findByRole("option", { name: "llama3.1:8b" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: /use ollama/i }),
    );

    await waitFor(() => {
      expect(window.localStorage.getItem("studyforge.ai.provider")).toBe(
        "ollama",
      );
    });
    expect(
      JSON.parse(localStorage.getItem("studyforge.ai.model") ?? "{}"),
    ).toEqual({ ollama: "llama3.1:8b" });
    vi.unstubAllGlobals();
  });
});
