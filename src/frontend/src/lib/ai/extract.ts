/**
 * The extraction pipeline: a document in, a queue of drafts out.
 *
 * With a key the document is sent to the model — one request per page when the
 * source is only readable as images, which is what keeps scanned papers and
 * photographs working. Without a key, any text the document carries is parsed
 * by rule instead, so a text-layer PDF still works offline.
 */

import type { DocumentImage, SourceDocument } from "@/lib/ai/document";
import {
  type ActiveProvider,
  activeProvider,
  callProvider,
} from "@/lib/ai/providers";
import {
  type QuestionDraft,
  parseModelResponse,
  parseTextWithRules,
} from "@/lib/ai/questions";

export type ExtractionEngine = "model" | "offline";

export interface ExtractionProgress {
  message: string;
  done: number;
  total: number;
}

export interface ExtractionOutcome {
  drafts: QuestionDraft[];
  engine: ExtractionEngine;
  /** Name of the model provider used, or null for the offline parse. */
  providerName: string | null;
}

interface Unit {
  instruction: string;
  images: DocumentImage[];
}

const PAGE_INSTRUCTION =
  "This is one page of an exam paper or textbook. Read the whole page, including any image, diagram or table, and extract every question on it. Set sourcePage to the page number given above.";

function buildUnits(source: SourceDocument): Unit[] {
  if (source.images.length > 0) {
    return source.images.map((image) => ({
      instruction: `Page ${image.page} of "${source.fileName}".\n\n${PAGE_INSTRUCTION}`,
      images: [image],
    }));
  }
  return [
    {
      instruction: `Document: "${source.fileName}".\n\n${source.text}`,
      images: [],
    },
  ];
}

/**
 * The same question can arrive twice when a model re-reads a page boundary, so
 * repeats are collapsed on the stem plus the first option.
 */
function dedupe(drafts: QuestionDraft[]): QuestionDraft[] {
  const seen = new Set<string>();
  const kept: QuestionDraft[] = [];
  for (const draft of drafts) {
    const key = `${draft.question.toLowerCase().replace(/\s+/g, " ")}|${
      draft.options[0] ?? ""
    }`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(draft);
  }
  return kept;
}

export class NoReadableSourceError extends Error {}

async function callAndParse(
  active: ActiveProvider,
  unit: Unit,
): Promise<QuestionDraft[]> {
  const reply = await callProvider(active, unit.instruction, unit.images);
  return parseModelResponse(reply);
}

export async function extractQuestions(
  source: SourceDocument,
  options: { onProgress?: (progress: ExtractionProgress) => void } = {},
): Promise<ExtractionOutcome> {
  const { onProgress } = options;
  const active = activeProvider();

  if (!active) {
    if (!source.text.trim()) {
      throw new NoReadableSourceError(
        "This file has no readable text, so it needs a vision model. Connect a Google Gemini or OpenRouter key, or point StudyForge at a local Ollama server, to extract from an image or a scanned PDF.",
      );
    }
    onProgress?.({ message: "Reading the document…", done: 1, total: 1 });
    return {
      drafts: dedupe(parseTextWithRules(source.text)),
      engine: "offline",
      providerName: null,
    };
  }

  const units = buildUnits(source);
  const collected: QuestionDraft[] = [];

  for (let index = 0; index < units.length; index += 1) {
    onProgress?.({
      message:
        units.length > 1
          ? `Reading page ${index + 1} of ${units.length} with ${active.provider.name}…`
          : `Asking ${active.provider.name} to structure the questions…`,
      done: index,
      total: units.length,
    });
    try {
      collected.push(...(await callAndParse(active, units[index])));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The request failed.";
      throw new Error(`${active.provider.name}: ${message}`);
    }
  }

  onProgress?.({
    message: "Structuring the questions…",
    done: units.length,
    total: units.length,
  });

  return {
    drafts: dedupe(collected),
    engine: "model",
    providerName: active.provider.name,
  };
}
