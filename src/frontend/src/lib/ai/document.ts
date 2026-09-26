/**
 * Reading a source document into something a model (or the offline parser) can
 * work on.
 *
 * A PDF's text layer is read page by page; a PDF without one (a scan) and a
 * photograph of a page are instead rasterised into images so a vision model can
 * read them. Both end up as a `SourceDocument`, and `needsVision` is how the
 * rest of the app knows that no text was recovered and a model is required.
 */

export interface DocumentImage {
  /** 1-based page the image came from, so drafts keep their page label. */
  page: number;
  mimeType: string;
  /** Base64 payload without the `data:` prefix. */
  base64: string;
}

export type SourceKind = "pdf" | "image" | "text";

export interface SourceDocument {
  fileName: string;
  fileSize: number;
  kind: SourceKind;
  text: string;
  images: DocumentImage[];
  pageCount: number;
  /** True when there is no text to parse, so only a vision model can read it. */
  needsVision: boolean;
  /** True when `text` was cut down to fit one request. */
  truncated: boolean;
  /** Pages beyond `MAX_VISION_PAGES`, which are not rasterised. */
  pagesSkipped: number;
}

/**
 * Longest document read out of a file. A model request never sees all of it —
 * `extract` cuts it into per-page chunks — so this only bounds how much of a
 * very long PDF is parsed at all.
 */
export const MAX_TEXT_CHARACTERS = 200_000;

/**
 * Pages rasterised for vision reading when a PDF has no text layer. Each page
 * goes out as its own request, and the requests run a few at a time, so this
 * bounds the wait rather than the payload.
 */
export const MAX_VISION_PAGES = 40;

/** A page with fewer characters than this counts as a scan, not a text PDF. */
const MIN_CHARS_PER_PAGE = 24;

/** Longest side of an image sent to a model; bigger files are scaled down. */
const MAX_IMAGE_DIMENSION = 1800;

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|bmp|gif)$/i;

interface PdfPage {
  getTextContent: () => Promise<{ items: unknown[] }>;
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }) => { promise: Promise<void> };
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfDocument {
  numPages: number;
  getPage: (number: number) => Promise<PdfPage>;
}

interface PdfLibrary {
  getDocument: (options: {
    data: Uint8Array;
  }) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

const PDFJS_VERSION = "3.11.174";
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;
// cdnjs serves each version immutably, so the digest of this exact file can be
// pinned. The script runs with page privileges, and the AI provider keys are in
// localStorage on this page, so an unpinned CDN response is a key-theft path.
const PDFJS_INTEGRITY =
  "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e";

let pdfLibrary: Promise<PdfLibrary> | null = null;

/**
 * Load pdf.js from the CDN on first use, so the bundle stays small and the app
 * boots without a PDF engine it may never need.
 */
function loadPdfLibrary(): Promise<PdfLibrary> {
  const alreadyLoaded = (window as unknown as { pdfjsLib?: PdfLibrary })
    .pdfjsLib;
  if (alreadyLoaded) return Promise.resolve(alreadyLoaded);

  if (!pdfLibrary) {
    pdfLibrary = new Promise<PdfLibrary>((resolve, reject) => {
      const script = document.createElement("script");
      script.id = "studyforge-pdfjs";
      script.src = `${PDFJS_BASE}/pdf.min.js`;
      script.integrity = PDFJS_INTEGRITY;
      script.crossOrigin = "anonymous";
      script.async = true;
      script.onload = () => {
        const library = (window as unknown as { pdfjsLib?: PdfLibrary })
          .pdfjsLib;
        if (!library) {
          pdfLibrary = null;
          reject(new Error("The PDF engine did not initialise."));
          return;
        }
        library.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
        resolve(library);
      };
      script.onerror = () => {
        pdfLibrary = null;
        reject(
          new Error("Could not load the PDF engine. Check your connection."),
        );
      };
      document.head.appendChild(script);
    });
  }
  return pdfLibrary;
}

/**
 * Join pdf.js text items into lines. Items sharing a baseline are joined with a
 * space and a new baseline starts a new line — without that a paper reads as one
 * unbroken paragraph and the offline parser cannot find the question numbers.
 */
function itemsToText(items: unknown[]): string {
  const lines: string[] = [];
  let current = "";
  let lastY: number | null = null;

  for (const entry of items) {
    const item = entry as { str?: string; transform?: number[] };
    if (typeof item.str !== "string") continue;
    const y = item.transform?.[5] ?? 0;
    if (lastY !== null && Math.abs(y - lastY) > 4) {
      lines.push(current.trim());
      current = "";
    }
    current += `${item.str} `;
    lastY = y;
  }
  lines.push(current.trim());
  return lines.filter(Boolean).join("\n");
}

function clampText(text: string): string {
  return text.length > MAX_TEXT_CHARACTERS
    ? text.slice(0, MAX_TEXT_CHARACTERS)
    : text;
}

/** Pages drawn at once: one at a time makes a long scan slow to get going. */
const RENDER_CONCURRENCY = 3;

async function renderPage(pdf: PdfDocument, number: number) {
  const page = await pdf.getPage(number);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    await page.render({ canvasContext: context, viewport }).promise;
  } catch {
    return null;
  }
  const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  return base64 ? { page: number, mimeType: "image/jpeg", base64 } : null;
}

async function renderPages(
  pdf: PdfDocument,
  numbers: number[],
): Promise<DocumentImage[]> {
  const images: DocumentImage[] = [];
  for (let start = 0; start < numbers.length; start += RENDER_CONCURRENCY) {
    const batch = numbers.slice(start, start + RENDER_CONCURRENCY);
    const drawn = await Promise.all(batch.map((n) => renderPage(pdf, n)));
    for (const image of drawn) if (image) images.push(image);
  }
  return images.sort((a, b) => a.page - b.page);
}

async function readPdf(file: File): Promise<SourceDocument> {
  const buffer = await file.arrayBuffer();
  const pdf = await (await loadPdfLibrary()).getDocument({
    data: new Uint8Array(buffer),
  }).promise;

  const pages: string[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    pages.push(itemsToText((await page.getTextContent()).items));
  }

  // A page under the per-page floor carries no text layer worth reading: it is
  // a scan, a diagram, or a blank.
  const scanned = new Set<number>();
  pages.forEach((body, index) => {
    if (body.trim().length < MIN_CHARS_PER_PAGE) scanned.add(index + 1);
  });

  const characters = pages.reduce((sum, text) => sum + text.length, 0);
  if (characters >= MIN_CHARS_PER_PAGE * pages.length) {
    const text = pages
      .map((body, index) => ({ body, number: index + 1 }))
      .filter((entry) => !scanned.has(entry.number))
      .map((entry) => `--- Page ${entry.number} ---\n${entry.body}`)
      .join("\n\n")
      .trim();
    // A mostly-textual PDF can still hold scanned pages. Sending only the text
    // half would drop those pages' questions without a word of warning, so they
    // go over as image units and the count says what could not be sent.
    const toDraw = [...scanned].slice(0, MAX_VISION_PAGES);
    const images = await renderPages(pdf, toDraw);
    return {
      fileName: file.name,
      fileSize: file.size,
      kind: "pdf",
      text: clampText(text),
      images,
      pageCount: pdf.numPages,
      needsVision: false,
      truncated: text.length > MAX_TEXT_CHARACTERS,
      // Uncapped scans and pages whose canvas render failed.
      pagesSkipped: scanned.size - images.length,
    };
  }

  // No text layer: rasterise the pages so a vision model can read the scan.
  const rasterised = Math.min(pdf.numPages, MAX_VISION_PAGES);
  const numbers = Array.from({ length: rasterised }, (_, index) => index + 1);
  const images = await renderPages(pdf, numbers);
  return {
    fileName: file.name,
    fileSize: file.size,
    kind: "pdf",
    text: "",
    images,
    pageCount: pdf.numPages,
    needsVision: rasterised > 0,
    truncated: false,
    // Pages past the cap, plus any whose render failed.
    pagesSkipped: Math.max(0, pdf.numPages - images.length),
  };
}

/** Downscale before encoding: models reject very large images. */
async function readImage(file: File): Promise<SourceDocument> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not decode the image."));
      image.onload = () => {
        const scale = Math.min(
          1,
          MAX_IMAGE_DIMENSION / Math.max(image.width, image.height),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(String(reader.result));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.88));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

  return {
    fileName: file.name,
    fileSize: file.size,
    kind: "image",
    text: "",
    images: [
      { page: 1, mimeType: "image/jpeg", base64: dataUrl.split(",")[1] ?? "" },
    ],
    pageCount: 1,
    needsVision: true,
    truncated: false,
    pagesSkipped: 0,
  };
}

/** Read an uploaded file into text and/or images, ready for extraction. */
export async function readDocument(file: File): Promise<SourceDocument> {
  if (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  ) {
    return readPdf(file);
  }
  if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name)) {
    return readImage(file);
  }

  const text = (await file.text()).trim();
  return {
    fileName: file.name,
    fileSize: file.size,
    kind: "text",
    text: clampText(text),
    images: [],
    pageCount: 1,
    needsVision: text.length === 0,
    truncated: text.length > MAX_TEXT_CHARACTERS,
    pagesSkipped: 0,
  };
}

/** One-line, human-readable summary of what was read from the file. */
export function describeDocument(document: SourceDocument): string {
  const size =
    document.fileSize >= 1024 * 1024
      ? `${(document.fileSize / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(document.fileSize / 1024))} KB`;
  const pages = document.kind === "pdf" ? `${document.pageCount} pages · ` : "";

  if (document.needsVision) {
    const skipped =
      document.pagesSkipped > 0
        ? ` · ${document.pagesSkipped} page${
            document.pagesSkipped === 1 ? "" : "s"
          } not read`
        : "";
    return `${pages}${size} · image only, needs a vision model${skipped}`;
  }
  return `${pages}${size} · ${document.text.length.toLocaleString()} characters`;
}
