/**
 * The extraction pipeline: a document in, a queue of drafts out.
 *
 * With a key the document is sent to the model in sections — one request per
 * page for a scan or photograph, one per page-sized chunk of a text PDF — and
 * those requests run a few at a time because a page of an exam paper is
 * something a model answers in seconds, while a whole document is something it
 * answers in minutes and gets half right. Without a key, any text the document
 * carries is parsed by rule instead, so a text-layer PDF still works offline.
 */

import type { DocumentImage, SourceDocument } from "@/lib/ai/document";
import {
  type ActiveProvider,
  ProviderUnavailableError,
  activeProvider,
  callProvider,
} from "@/lib/ai/providers";
import {
  type QuestionDraft,
  draftKey,
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
  /** A model the run had to fall back to, or null when the chosen one answered. */
  model: string | null;
  /** Sections the provider refused; their questions are simply not in `drafts`. */
  skipped: number;
  /**
   * Pages whose unit never answered, so the queue can say what is missing
   * after a toast has faded. Packed multi-page units are counted in `skipped`
   * but cannot name a page.
   */
  missing: number[];
  /** Why sections were lost, deduped. Empty when the whole document was read. */
  warnings: string[];
}

interface Unit {
  instruction: string;
  images: DocumentImage[];
  /** The page a unit came from, when it covers exactly one. */
  page: number | null;
  /**
   * Whether the source has pages at all. A text PDF is split on `--- Page N
   * ---` markers and a packed unit asks the model to name the page per
   * question, so its `sourcePage` is worth keeping. Pasted text has no pages,
   * so a number the model returns for it cannot be true of anything, and the
   * queue would print "Page 99" as a fact about a document that has no page 99.
   */
  pagesNamed: boolean;
}

const PAGE_INSTRUCTION =
  "This is one page of an exam paper or textbook. Read the whole page, including any image, diagram or table, and extract every question on it. Set sourcePage to the page number given above.";

/**
 * Characters of text per request. A model asked to structure a whole PDF slows
 * down and starts dropping questions, so long text is cut into page-shaped
 * chunks and the chunks run side by side.
 */
const TEXT_CHUNK_CHARACTERS = 7_000;

/**
 * Pages asked for one per request before packing starts. A page number the
 * pipeline knows is better than one the model guesses, and a document of a
 * few dozen pages is a few dozen small, fast requests — only beyond this does
 * the round-trip count outweigh the accuracy.
 */
const MAX_SINGLE_PAGE_UNITS = 24;

const PAGE_MARKER = /^--- Page (\d+) ---$/;

/** The line `readDocument` writes ahead of each page, rebuilt when pages pack. */
const pageMarker = (page: number) => `--- Page ${page} ---`;

/** The page markers `readDocument` writes between a PDF's pages. */
function splitByPageMarkers(
  text: string,
): Array<{ page: number; text: string }> | null {
  const lines = text.split("\n");
  const pages: Array<{ page: number; text: string }> = [];
  let current: { page: number; text: string } | null = null;
  let marked = 0;

  for (const line of lines) {
    const match = PAGE_MARKER.exec(line.trim());
    if (match) {
      marked += 1;
      if (current) pages.push(current);
      current = { page: Number(match[1]), text: "" };
      continue;
    }
    if (current) current.text += `${line}\n`;
  }
  if (current) pages.push(current);
  return marked > 1 ? pages : null;
}

/** Cut unmarked text on paragraph boundaries so no question is split in two. */
function splitByLength(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > TEXT_CHUNK_CHARACTERS) {
    const window = rest.slice(0, TEXT_CHUNK_CHARACTERS);
    const paragraph = window.lastIndexOf("\n\n");
    const sentence = window.lastIndexOf("\n");
    const cut =
      paragraph > TEXT_CHUNK_CHARACTERS / 2
        ? paragraph
        : sentence > TEXT_CHUNK_CHARACTERS / 2
          ? sentence
          : TEXT_CHUNK_CHARACTERS;
    chunks.push(window.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Pack whole pages into requests, and keep the page number when only one fits. */
function packPages(
  pages: Array<{ page: number; text: string }>,
  fileName: string,
): Unit[] {
  const units: Unit[] = [];
  let batch: Array<{ page: number; text: string }> = [];
  let size = 0;

  const flush = () => {
    if (batch.length === 0) return;
    const only = batch.length === 1 ? batch[0].page : null;
    // Where several pages share a request the model has to say which page each
    // question came from, so the boundaries have to be in the text it reads.
    const text = batch
      .map((page) =>
        only
          ? page.text.trim()
          : `${pageMarker(page.page)}\n${page.text.trim()}`,
      )
      .join("\n\n");
    units.push({
      instruction: only
        ? `Page ${only} of "${fileName}".\n\n${PAGE_INSTRUCTION}\n\n${text}`
        : `Pages ${batch[0].page}–${batch[batch.length - 1].page} of "${fileName}", as text. Each page below starts with its own "--- Page N ---" marker. Read every page and extract every question on it, setting sourcePage to the page the marker gives.\n\n${text}`,
      images: [],
      page: only,
      pagesNamed: true,
    });
    batch = [];
    size = 0;
  };

  for (const page of pages) {
    if (size > 0 && size + page.text.length > TEXT_CHUNK_CHARACTERS) flush();
    batch.push(page);
    size += page.text.length;
    if (size >= TEXT_CHUNK_CHARACTERS) flush();
  }
  flush();
  return units;
}

function textUnits(source: SourceDocument): Unit[] {
  const text = source.text.trim();
  if (!text) return [];

  const pages = splitByPageMarkers(text);
  if (pages && pages.length > 1) {
    if (pages.length <= MAX_SINGLE_PAGE_UNITS) {
      return pages.map((page) => ({
        instruction: `Page ${page.page} of "${source.fileName}", as text.\n\n${PAGE_INSTRUCTION}\n\n${page.text.trim()}`,
        images: [],
        page: page.page,
        pagesNamed: true,
      }));
    }
    const units = packPages(pages, source.fileName);
    if (units.length > 1) return units;
  }

  if (text.length > TEXT_CHUNK_CHARACTERS) {
    return splitByLength(text).map((chunk) => ({
      instruction: `Part of "${source.fileName}", sent in sections. Extract every complete question in this section.\n\n${chunk}`,
      images: [],
      page: null,
      pagesNamed: false,
    }));
  }

  return [
    {
      instruction: `Document: "${source.fileName}".\n\n${text}`,
      images: [],
      page: null,
      pagesNamed: false,
    },
  ];
}

function buildUnits(source: SourceDocument): Unit[] {
  const imageUnits: Unit[] = source.images.map((image) => ({
    instruction: `Page ${image.page} of "${source.fileName}".\n\n${PAGE_INSTRUCTION}`,
    images: [image],
    page: image.page,
    pagesNamed: true,
  }));
  // A partly-scanned PDF carries both halves: pages with a text layer and pages
  // that were rasterised. Reading only one of them would drop the other's
  // questions, so the two are sent as units of their own and ordered by page.
  return [...imageUnits, ...textUnits(source)].sort(
    (a, b) => (a.page ?? 0) - (b.page ?? 0),
  );
}

/**
 * The same question can arrive twice when a model re-reads a page boundary, so
 * repeats are collapsed on the question's whole visible shape.
 */
function dedupe(drafts: QuestionDraft[]): QuestionDraft[] {
  const seen = new Set<string>();
  const kept: QuestionDraft[] = [];
  for (const draft of drafts) {
    const key = draftKey(draft);
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
  onNotice: (message: string) => void,
  budget: { busy: Set<string> },
): Promise<QuestionDraft[]> {
  const reply = await callProvider(
    active,
    unit.instruction,
    unit.images,
    onNotice,
    budget,
  );
  const drafts = parseModelResponse(reply.text);
  // A unit that came from one known page should not rely on the model to
  // remember that page — it mislabels items whenever it is tired.
  if (unit.page !== null) {
    for (const draft of drafts) draft.page = unit.page;
  } else if (!unit.pagesNamed) {
    // Past text has no pages, so the number is not a mislabel to correct but a
    // fact about a document that has none. The queue would otherwise show
    // "Page 99" over a question from a 153-character paste.
    for (const draft of drafts) draft.page = null;
  }
  return drafts;
}

/**
 * How many sections to request at once. The bottleneck is the provider's own
 * latency, so this is a real speed-up — but a free-tier key answers 429 above
 * roughly three simultaneous requests, which costs more in retries than it
 * saves in wall time.
 */
const PAGE_CONCURRENCY = 3;

/**
 * Two sections refusing means the key is saturated, not that the next section
 * will fare any better, so the run stops asking and keeps what it got instead
 * of spending another minute failing.
 */
const MAX_REFUSALS = 2;

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
      model: null,
      skipped: 0,
      missing: [],
      warnings: [],
    };
  }

  const units = buildUnits(source);
  if (units.length === 0) {
    throw new NoReadableSourceError(
      `Nothing readable was found in "${source.fileName}". If it is a scan, connect a vision model or export it as a PDF with a text layer.`,
    );
  }
  const askedFor = active.model;
  const usedModels = new Set<string>();
  /** Models this run has watched refuse; later sections start elsewhere. */
  const budget = { busy: new Set<string>() };
  /** Indexed by unit, so the queue reads in page order however the replies land. */
  const results: QuestionDraft[][] = [];
  const refusals: string[] = [];
  let fatal: Error | null = null;
  let completed = 0;

  const announce = (index: number, message?: string) => {
    onProgress?.({
      message:
        message ??
        (units.length > 1
          ? `Reading section ${index + 1} of ${units.length} with ${active.provider.name}… (${completed} done)`
          : `Asking ${active.provider.name} to structure the questions…`),
      done: completed,
      total: units.length,
    });
  };

  const stopped = () => fatal !== null || refusals.length >= MAX_REFUSALS;

  const runUnit = async (index: number) => {
    if (stopped()) return;
    announce(index);
    try {
      const drafts = await callAndParse(
        active,
        units[index],
        (notice) => announce(index, notice),
        budget,
      );
      usedModels.add(active.model);
      results[index] = drafts;
    } catch (error) {
      // A section whose provider refused every model is lost; a section that
      // failed for another reason ends the run. Either way the sections that
      // did answer are kept, so one busy page no longer discards a whole PDF.
      if (error instanceof ProviderUnavailableError) {
        refusals.push(error.message);
      } else {
        fatal = new Error(
          `${active.provider.name}: ${error instanceof Error ? error.message : "The request failed."}`,
        );
      }
    } finally {
      completed += 1;
      announce(index);
    }
  };

  // The first unit runs alone so callProvider's model walk locks onto a model
  // that answers; the rest inherit it through `active.model`, which is what
  // makes the fan-out cheap instead of every worker hitting the same 503 wall.
  await runUnit(0);

  if (units.length > 1 && !stopped()) {
    let cursor = 1;
    const worker = async () => {
      while (!stopped() && cursor < units.length) {
        const index = cursor;
        cursor += 1;
        await runUnit(index);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PAGE_CONCURRENCY, units.length - 1) },
        worker,
      ),
    );
  }

  const drafts = dedupe(results.flat());
  const failure =
    fatal ?? (refusals.length > 0 ? new Error(refusals[0]) : null);
  // An empty queue is only a failure when a section was actually lost. When
  // every section answered and each said "no questions here", that is the
  // honest result and the page says so rather than blaming the provider.
  if (drafts.length === 0 && failure !== null) {
    throw failure;
  }

  // A lost section has to be reported with its real reason. "2 sections could
  // not be read, run again" is wrong advice for a refused key, and the retry is
  // what produced the message in the first place.
  const warnings = [
    ...new Set([...(failure ? [failure.message] : []), ...refusals]),
  ].slice(0, 2);

  onProgress?.({
    message: "Structuring the questions…",
    done: units.length,
    total: units.length,
  });

  const missing = units
    .filter((unit, index) => !results[index] && unit.page !== null)
    .map((unit) => unit.page as number)
    .sort((a, b) => a - b);

  return {
    drafts,
    engine: "model",
    providerName: active.provider.name,
    model:
      [...usedModels].filter((name) => name !== askedFor).join(", ") || null,
    skipped: units.length - results.filter(Boolean).length,
    missing,
    warnings,
  };
}
