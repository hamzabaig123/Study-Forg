/**
 * The extraction pipeline: how a document is cut into requests, how those
 * requests run, and what the queue ends up holding. The provider is stubbed at
 * `fetch`, so these assert the shape and the parallelism of a real run.
 */

import type { DocumentImage, SourceDocument } from "@/lib/ai/document";
import { extractQuestions } from "@/lib/ai/extract";
import { saveKey, setPreferredChoice, setSavedModel } from "@/lib/ai/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPLY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '{"items":[]}' }] } }],
});

function image(page: number): DocumentImage {
  return { page, mimeType: "image/jpeg", base64: "A".repeat(12) };
}

function textDocument(text: string, pageCount = 1): SourceDocument {
  return {
    fileName: "paper.pdf",
    fileSize: text.length,
    kind: "pdf",
    text,
    images: [],
    pageCount,
    needsVision: false,
    truncated: false,
    pagesSkipped: 0,
  };
}

function pageMarker(page: number): string {
  return `--- Page ${page} ---`;
}

/** One MCQ per page so a draft can be traced back to the request that made it. */
function pageBody(page: number, filler = ""): string {
  return `${pageMarker(page)}\n${filler}${page}. Which gas do plants absorb?\nA) Oxygen\nB) Carbon dioxide\nAnswer: B`;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  saveKey("gemini", "AIza-test");
  setPreferredChoice("gemini");
  setSavedModel("gemini", "gemini-3.7-flash");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cutting a document into requests", () => {
  it("sends one request per rasterised page", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => REPLY });

    const outcome = await extractQuestions({
      fileName: "scan.pdf",
      fileSize: 300,
      kind: "pdf",
      text: "",
      images: [image(1), image(2), image(3)],
      pageCount: 3,
      needsVision: true,
      truncated: false,
      pagesSkipped: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(outcome.engine).toBe("model");
    expect(outcome.model).toBeNull();
  });

  it("keeps a short text document as the single request it was", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => REPLY });

    await extractQuestions(textDocument(pageBody(1)));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { contents: Array<{ parts: Array<{ text?: string }> }> };
    const sent = body.contents[0].parts.map((part) => part.text ?? "").join("");
    expect(sent).toContain('Document: "paper.pdf"');
  });

  it("splits a long PDF by page instead of asking for the whole thing at once", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => REPLY });
    const filler = "x".repeat(9000);
    const text = [1, 2, 3, 4]
      .map((page) => pageBody(page, filler))
      .join("\n\n");

    await extractQuestions(textDocument(text, 4));

    // Four oversized pages cannot share a request, so each gets its own.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const sent = fetchMock.mock.calls.map((call) => {
      const body = JSON.parse(
        (call as [string, RequestInit])[1].body as string,
      ) as {
        contents: Array<{ parts: Array<{ text?: string }> }>;
      };
      return body.contents[0].parts.map((part) => part.text ?? "").join("");
    });
    expect(sent.some((instruction) => instruction.includes("Page 2 of"))).toBe(
      true,
    );
  });

  it("asks for each page separately so its number is never guessed", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => REPLY });
    const text = [1, 2].map((page) => pageBody(page)).join("\n\n");

    const outcome = await extractQuestions(textDocument(text, 2));

    // Small pages could have shared one request; they do not, because the
    // pipeline then knows the page of every draft instead of trusting a model
    // that reads "--- Page 3 ---" and answers "1" for everything on it.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.drafts.every((draft) => draft.page !== undefined)).toBe(
      true,
    );
    const sent = fetchMock.mock.calls.map((call) => {
      const body = JSON.parse(
        (call as [string, RequestInit])[1].body as string,
      ) as {
        contents: Array<{ parts: Array<{ text?: string }> }>;
      };
      return body.contents[0].parts.map((part) => part.text ?? "").join("");
    });
    expect(sent[0]).toContain("Page 1 of");
    expect(sent[1]).toContain("Page 2 of");
  });

  it("marks the pages inside a packed request for a long document", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => REPLY });
    // 30 pages of a few hundred characters each: too many to ask for one at a
    // time, so they pack — and the boundaries have to survive the packing.
    const text = Array.from({ length: 30 }, (_, i) => pageBody(i + 1)).join(
      "\n\n",
    );

    await extractQuestions(textDocument(text, 30));

    expect(fetchMock.mock.calls.length).toBeLessThan(30);
    const sent = (
      fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    )
      .map((call) => {
        const body = JSON.parse(call[1].body as string) as {
          contents: Array<{ parts: Array<{ text?: string }> }>;
        };
        return body.contents[0].parts.map((part) => part.text ?? "").join("");
      })
      .join("\n");
    expect(sent).toContain("--- Page 14 ---");
  });
});

describe("running the requests", () => {
  it("asks for several pages at once after the first one settles the model", async () => {
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, text: async () => REPLY };
    });
    const filler = "y".repeat(9000);
    const text = [1, 2, 3, 4, 5, 6, 7, 8].map((page) => pageBody(page, filler));

    await extractQuestions(textDocument(text.join("\n\n"), 8));

    expect(fetchMock).toHaveBeenCalledTimes(8);
    // The warm-up page runs alone, so the fan-out starts after it.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("stops asking once a page has failed", async () => {
    const refused = {
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({ error: { message: "The input text is too long." } }),
    };
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => REPLY });
    fetchMock.mockResolvedValue(refused);

    const filler = "z".repeat(9000);
    const text = [1, 2, 3, 4, 5, 6].map((page) => pageBody(page, filler));

    await expect(
      extractQuestions(textDocument(text.join("\n\n"), 6)),
    ).rejects.toThrow(/Google Gemini: The input text is too long/);
    // One warm-up page, then the pages already in flight — and nothing after
    // the refusal, because a request the model rejects is not worth repeating.
    expect(fetchMock).toHaveBeenCalledTimes(1 + 3);
  });

  it("keeps the pages that answered when another page stays busy", async () => {
    vi.useFakeTimers();
    const itemsFor = (page: number) =>
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    items: [
                      {
                        type: "mcq",
                        question: `Page ${page}: which gas do plants absorb?`,
                        options: ["Oxygen", "Carbon dioxide"],
                        correctAnswer: "B",
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      });
    const busy = {
      ok: false,
      status: 429,
      text: async () =>
        JSON.stringify({ error: { message: "Rate limit exceeded." } }),
      headers: new Headers(),
    };

    // Page 2 is refused by every model in the walk; the other two answer.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body ?? "{}") as string) as {
        contents: Array<{ parts: Array<{ text?: string }> }>;
      };
      const sent = body.contents[0].parts
        .map((part) => part.text ?? "")
        .join("");
      if (sent.includes("Page 2 of")) return busy;
      const page = Number(/Page (\d+) of/.exec(sent)?.[1] ?? "1");
      return { ok: true, text: async () => itemsFor(page) };
    });

    const running = extractQuestions({
      fileName: "scan.pdf",
      fileSize: 300,
      kind: "pdf",
      text: "",
      images: [image(1), image(2), image(3)],
      pageCount: 3,
      needsVision: true,
      truncated: false,
      pagesSkipped: 0,
    });
    await vi.runAllTimersAsync();
    const outcome = await running;
    vi.useRealTimers();

    expect(outcome.drafts.map((draft) => draft.page)).toEqual([1, 3]);
    expect(outcome.skipped).toBe(1);
    // The page itself, not just a count: the queue says "page 2 not read" long
    // after the toast has faded.
    expect(outcome.missing).toEqual([2]);
    // The reason travels with the count: "1 section could not be read" alone
    // reads as a blip even when no model will answer at all.
    expect(outcome.warnings[0]).toMatch(/Google Gemini/);
  });

  it("labels a draft with the page its request came from", async () => {
    const itemsFor = (page: number) =>
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    items: [
                      {
                        type: "mcq",
                        question: `Page ${page}: which gas do plants absorb?`,
                        options: ["Oxygen", "Carbon dioxide"],
                        correctAnswer: "B",
                        sourcePage: 1,
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      });

    // The model insists everything came from page 1; the pipeline knows better.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body ?? "{}") as string) as {
        contents: Array<{ parts: Array<{ text?: string }> }>;
      };
      const sent = body.contents[0].parts
        .map((part) => part.text ?? "")
        .join("");
      const match = /Page (\d+) of/.exec(sent);
      const page = Number(match?.[1] ?? "1");
      return { ok: true, text: async () => itemsFor(page) };
    });

    const outcome = await extractQuestions({
      fileName: "scan.pdf",
      fileSize: 300,
      kind: "pdf",
      text: "",
      images: [image(1), image(2), image(3)],
      pageCount: 3,
      needsVision: true,
      truncated: false,
      pagesSkipped: 0,
    });

    expect(outcome.drafts.map((draft) => draft.page)).toEqual([1, 2, 3]);
    expect(outcome.drafts.map((draft) => draft.question)).toEqual([
      "Page 1: which gas do plants absorb?",
      "Page 2: which gas do plants absorb?",
      "Page 3: which gas do plants absorb?",
    ]);
  });

  it("drops a page number a model invented for text that has no pages", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      items: [
                        {
                          type: "mcq",
                          question: "Which gas do plants absorb?",
                          options: ["Oxygen", "Carbon dioxide"],
                          correctAnswer: "B",
                          sourcePage: 99,
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
    });

    const outcome = await extractQuestions({
      fileName: "Pasted text",
      fileSize: 60,
      kind: "text",
      text: "1. Which gas do plants absorb?\nA) Oxygen\nB) Carbon dioxide\nAnswer: B",
      images: [],
      pageCount: 0,
      needsVision: false,
      truncated: false,
      pagesSkipped: 0,
    });

    expect(outcome.drafts).toHaveLength(1);
    // Pasted text is sent as one unit with no page markers in it, so 99 is not
    // a label to correct — the document has no pages, and the queue would
    // print "Page 99" as a fact about 60 characters of text.
    expect(outcome.drafts[0]?.page).toBeNull();
  });

  it("reports progress as sections finish, not as they start", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => REPLY });
    const filler = "w".repeat(9000);
    const text = [1, 2, 3].map((page) => pageBody(page, filler));
    const seen: Array<{ done: number; total: number }> = [];

    await extractQuestions(textDocument(text.join("\n\n"), 3), {
      onProgress: ({ done, total }) => seen.push({ done, total }),
    });

    expect(seen[seen.length - 1]).toEqual({ done: 3, total: 3 });
    expect(seen.some((entry) => entry.done === 1)).toBe(true);
  });
});

describe("what the queue keeps", () => {
  function replyWith(items: unknown[]) {
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify({ items }) }] } },
          ],
        }),
    };
  }

  it("drops a repeated question but keeps one that only shares its stem", async () => {
    const stem = "Which gas do plants absorb?";
    fetchMock.mockResolvedValue(
      replyWith([
        {
          type: "mcq",
          question: stem,
          options: ["A) Oxygen", "B) Carbon dioxide"],
          answer: "B",
        },
        {
          type: "mcq",
          question: stem,
          options: ["A) Oxygen", "B) Carbon dioxide"],
          answer: "B",
        },
        {
          type: "mcq",
          question: stem,
          options: ["A) Nitrogen", "B) Hydrogen"],
          answer: "A",
        },
      ]),
    );

    const outcome = await extractQuestions(textDocument(pageBody(1)));

    // The first two are one question read twice; the third shares only the
    // instruction, and its options make it a different question.
    expect(outcome.drafts).toHaveLength(2);
  });

  it("sends a partly scanned PDF as text pages and image pages together", async () => {
    const units: Array<{ images: number }> = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body ?? "{}") as string) as {
        contents: Array<{
          parts: Array<{ text?: string; inlineData?: unknown }>;
        }>;
      };
      const parts = body.contents[0].parts;
      units.push({ images: parts.filter((part) => part.inlineData).length });
      return { ok: true, text: async () => REPLY };
    });

    const outcome = await extractQuestions({
      ...textDocument(`${pageBody(1)}\n\n${pageBody(2)}`, 3),
      images: [image(3)],
    });

    // Dropping either half would lose those pages' questions silently.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(units.filter((unit) => unit.images > 0)).toHaveLength(1);
    expect(units.filter((unit) => unit.images === 0)).toHaveLength(2);
    expect(outcome.skipped).toBe(0);
  });

  it("says so when the document holds nothing a model can read", async () => {
    await expect(extractQuestions(textDocument("   "))).rejects.toThrow(
      /Nothing readable/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
