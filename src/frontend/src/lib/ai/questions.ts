/**
 * Question drafts and the two parsers that produce them.
 *
 * A draft is the shape the whole studio works with: the review cards, the queue
 * store, and the import into a topic's question bank all read these fields, so
 * the model's letter answers ("B") are normalised into option indexes here and
 * nowhere else.
 */

export type QuestionKind = "mcq" | "qa";

export interface QuestionDraft {
  id: string;
  kind: QuestionKind;
  question: string;
  /** Option texts for an MCQ, in A/B/C… order. Empty for a Q&A. */
  options: string[];
  /** Index into `options`, or null when the answer is free text. */
  correctIndex: number | null;
  /** Expected answer for a Q&A; the correct option text for an MCQ. */
  answer: string;
  explanation: string;
  /** True when the source did not state the answer and it was deduced. */
  inferred: boolean;
  page: number | null;
}

let idCounter = 0;

function draftId(): string {
  idCounter += 1;
  return `draft-${Date.now().toString(36)}-${idCounter}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/**
 * Turn one raw option string into plain text, dropping an "A)" / "(b) -" style
 * prefix a model or a PDF text layer may have carried along.
 */
function cleanOption(raw: unknown): string {
  return String(raw ?? "")
    .replace(/^\s*[\(\[]?[A-Za-z][\)\]\.\-:]\s*/, "")
    .trim();
}

function letterToIndex(letter: string): number | null {
  const upper = letter.trim().toUpperCase();
  if (upper.length === 1 && upper >= "A" && upper <= "Z") {
    return upper.charCodeAt(0) - 65;
  }
  return null;
}

function finalizeMcq(
  question: string,
  rawOptions: unknown[],
  answerText: string,
  explanation: string,
  inferred: boolean,
  page: number | null,
): QuestionDraft | null {
  const options = rawOptions.map(cleanOption).filter(Boolean);
  if (options.length < 2) return null;

  let correctIndex: number | null = null;
  let wasInferred = inferred;

  if (/^\d+$/.test(answerText)) {
    const asNumber = Number.parseInt(answerText, 10);
    correctIndex =
      asNumber >= 1 && asNumber <= options.length ? asNumber - 1 : 0;
    if (asNumber < 1 || asNumber > options.length) wasInferred = true;
  } else {
    const letter = letterToIndex(answerText);
    if (letter !== null && letter < options.length) {
      correctIndex = letter;
    } else {
      // Fall back to matching the answer text against the option texts.
      const normalized = cleanOption(answerText).toLowerCase();
      const matchIndex = normalized
        ? options.findIndex((option) => option.toLowerCase() === normalized)
        : -1;
      correctIndex = matchIndex >= 0 ? matchIndex : 0;
      if (matchIndex < 0) wasInferred = true;
    }
  }

  return {
    id: draftId(),
    kind: "mcq",
    question,
    options,
    correctIndex,
    answer: options[correctIndex] ?? "",
    explanation,
    inferred: wasInferred,
    page,
  };
}

/* -------------------------------------------------------------------------- */
/* Model response parser                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Read the JSON a chat model was asked to return.
 *
 * Models wrap the object in code fences, add a sentence before it, or leave a
 * trailing comma, so the payload is located by brace bounds and repaired before
 * `JSON.parse`. Anything that still fails is reported as an unusable response
 * rather than silently yielding an empty queue.
 */
export function parseModelResponse(rawText: string): QuestionDraft[] {
  let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "");
  cleaned = cleaned.replace(/\s*```$/i, "");

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const itemsSlice = cleaned.match(/"items"\s*:\s*(\[[\s\S]*\])\s*}/);
    if (!itemsSlice) {
      throw new Error("The AI reply was not valid JSON. Try again.");
    }
    try {
      parsed = { items: JSON.parse(itemsSlice[1]) };
    } catch {
      throw new Error("The AI reply was not valid JSON. Try again.");
    }
  }

  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : [];

  const drafts: QuestionDraft[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;

    const question = String(item.question ?? item.prompt ?? "").trim();
    if (question.length < 3) continue;

    const rawOptions = Array.isArray(item.options) ? item.options : [];
    const answerText = String(item.correctAnswer ?? item.answer ?? "").trim();
    const explanation = String(item.explanation ?? "").trim();
    const page =
      typeof item.sourcePage === "number" && item.sourcePage > 0
        ? Math.trunc(item.sourcePage)
        : null;
    const inferred = Boolean(item.inferred);

    const rawType = String(item.type ?? "").toLowerCase();
    const wantsQa =
      rawType.includes("qa") ||
      rawType.includes("short") ||
      rawType.includes("descriptive");
    const isMcq = rawOptions.length >= 2 && !wantsQa;

    if (isMcq) {
      const draft = finalizeMcq(
        question,
        rawOptions,
        answerText,
        explanation,
        inferred,
        page,
      );
      if (draft) drafts.push(draft);
      continue;
    }

    drafts.push({
      id: draftId(),
      kind: "qa",
      question,
      options: [],
      correctIndex: null,
      answer: answerText,
      explanation,
      inferred: inferred || answerText.length === 0,
      page,
    });
  }

  return drafts;
}

/* -------------------------------------------------------------------------- */
/* Offline rule-based parser                                                   */
/* -------------------------------------------------------------------------- */

const NUMBERED =
  /^\s*(?:(?:q(?:uestion)?|item|problem|ex(?:ercise)?)\s*)?\d+\s*[.)\-:]\s*/i;
const OPTION_LINE = /^\s*[\(\[]?([A-Za-z])[\)\]\.\-:]\s*(.+)$/;
const ANSWER_LINE =
  /^\s*(?:ans(?:wer)?|correct\s*(?:option|answer)|solution)\s*[:=\-]\s*(.+)/i;
const EXPLANATION_LINE =
  /^\s*(?:exp(?:lanation)?|sol(?:ution)?|note|hint)\s*[:=\-]\s*(.+)/i;

/**
 * Find question blocks in plain text without calling a model.
 *
 * This is the no-key path: it works on any document with a text layer that
 * follows the usual exam layout (numbered stems, lettered options, an optional
 * `Answer:` line). Answers that the text does not state are marked inferred so
 * the reviewer has to look at them.
 */
export function parseTextWithRules(rawText: string): QuestionDraft[] {
  const text = rawText.replace(/\r\n?/g, "\n");
  if (!text.trim()) return [];

  const blocks = text
    .split(
      /(?=^\s*(?:(?:q(?:uestion)?|item|problem|ex(?:ercise)?)\s*)?\d+\s*[.)\-:]\s*)/im,
    )
    .map((block) => block.trim())
    .filter(Boolean);

  const drafts: QuestionDraft[] = [];
  for (const block of blocks) {
    // A block that does not open with a numbered marker is prose, not a
    // question, and turning a paragraph into a fake Q&A is worse than
    // reporting nothing.
    if (!NUMBERED.test(block)) continue;

    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const stemLines: string[] = [];
    const options: string[] = [];
    let answerText = "";
    let explanation = "";

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      const explanationMatch = line.match(EXPLANATION_LINE);
      if (explanationMatch) {
        explanation = explanationMatch[1].trim();
        continue;
      }
      const answerMatch = line.match(ANSWER_LINE);
      if (answerMatch) {
        answerText = answerMatch[1].trim();
        continue;
      }
      const optionMatch = line.match(OPTION_LINE);
      // Only after the stem, so "1." numbered lines are not read as options.
      if (optionMatch && (index > 0 || options.length > 0)) {
        const option = cleanOption(line);
        if (option) options.push(option);
        continue;
      }
      // Anything loose after the options belongs to the next section of the
      // paper ("Section B - Short Answer"), not to this stem.
      if (options.length > 0) continue;
      stemLines.push(line);
    }

    const question = stemLines.join(" ").replace(NUMBERED, "").trim();
    if (question.length < 3) continue;

    if (options.length >= 2) {
      const draft = finalizeMcq(
        question,
        options,
        answerText,
        explanation,
        answerText.length === 0,
        null,
      );
      if (draft) drafts.push(draft);
      continue;
    }

    drafts.push({
      id: draftId(),
      kind: "qa",
      question,
      options: [],
      correctIndex: null,
      answer: answerText,
      explanation,
      inferred: answerText.length === 0,
      page: null,
    });
  }

  return drafts;
}

/** How many drafts carry an answer that nothing in the source confirmed. */
export function countInferred(drafts: QuestionDraft[]): number {
  return drafts.filter((draft) => draft.inferred).length;
}
