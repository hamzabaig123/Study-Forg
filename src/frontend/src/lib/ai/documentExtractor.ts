/**
 * Document extraction engine for StudyForge AI Studio.
 * Handles PDF text extraction, image preparation for multimodal AI,
 * and rule-based fallback heuristic question extraction.
 */

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface DocumentExtractionResult {
  fileName: string;
  fileType: "pdf" | "image" | "text";
  rawText: string;
  pages: ExtractedPage[];
  imageDataUrl?: string;
  imageMimeType?: string;
}

export interface HeuristicCandidate {
  id: string;
  type: "mcq" | "short_qa";
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  inferred: boolean;
  confidence: number;
  sourcePage?: number;
}

/* -------------------------------------------------------------------------- */
/* PDF.js Dynamic Loader                                                      */
/* -------------------------------------------------------------------------- */

let pdfjsLibPromise: Promise<any> | null = null;

async function getPdfJsLib(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error(
      "PDF processing is only supported in a browser environment.",
    );
  }
  if ((window as any).pdfjsLib) {
    return (window as any).pdfjsLib;
  }
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = new Promise((resolve, reject) => {
      // First try loading PDF.js script dynamically
      const existingScript = document.getElementById("pdfjs-lib-script");
      if (existingScript) {
        if ((window as any).pdfjsLib) {
          resolve((window as any).pdfjsLib);
          return;
        }
        existingScript.addEventListener("load", () =>
          resolve((window as any).pdfjsLib),
        );
        existingScript.addEventListener("error", reject);
        return;
      }

      const script = document.createElement("script");
      script.id = "pdfjs-lib-script";
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.async = true;
      script.onload = () => {
        const lib = (window as any).pdfjsLib;
        if (lib) {
          lib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          resolve(lib);
        } else {
          reject(new Error("PDF.js failed to initialize"));
        }
      };
      script.onerror = () =>
        reject(new Error("Could not load PDF extraction engine from CDN."));
      document.head.appendChild(script);
    });
  }
  return pdfjsLibPromise;
}

/**
 * Extract text page-by-page from an ArrayBuffer of a PDF document.
 */
export async function extractTextFromPdf(
  buffer: ArrayBuffer,
): Promise<ExtractedPage[]> {
  const pdfjs = await getPdfJsLib();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdfDoc = await loadingTask.promise;
  const pages: ExtractedPage[] = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const strings: string[] = [];
    let lastY: number | null = null;

    for (const item of content.items) {
      if ("str" in item) {
        // Simple line detection based on Y coordinate
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
          strings.push("\n");
        } else if (
          strings.length > 0 &&
          !strings[strings.length - 1].endsWith(" ")
        ) {
          strings.push(" ");
        }
        strings.push(item.str);
        lastY = item.transform[5];
      }
    }
    const pageText = strings.join("").trim();
    pages.push({ pageNumber: i, text: pageText });
  }

  return pages;
}

/* -------------------------------------------------------------------------- */
/* Image Compression & Base64 Converter                                       */
/* -------------------------------------------------------------------------- */

/**
 * Convert an image File into a base64 data URL, resizing if dimensions exceed maxDimension.
 */
export async function prepareImageForAi(
  file: File,
  maxDimension = 1800,
): Promise<{
  dataUrl: string;
  base64Data: string;
  mimeType: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Failed to decode image"));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          const rawUrl = reader.result as string;
          const base64 = rawUrl.split(",")[1];
          resolve({
            dataUrl: rawUrl,
            base64Data: base64,
            mimeType: file.type || "image/jpeg",
          });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const mimeType = "image/jpeg";
        const dataUrl = canvas.toDataURL(mimeType, 0.88);
        const base64Data = dataUrl.split(",")[1];
        resolve({ dataUrl, base64Data, mimeType });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/* -------------------------------------------------------------------------- */
/* High-Level File Ingestion                                                  */
/* -------------------------------------------------------------------------- */

export async function processUploadedFile(
  file: File,
): Promise<DocumentExtractionResult> {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage =
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name);

  if (isPdf) {
    const buffer = await file.arrayBuffer();
    try {
      const pages = await extractTextFromPdf(buffer);
      const rawText = pages
        .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
        .join("\n\n");
      return {
        fileName: file.name,
        fileType: "pdf",
        rawText,
        pages,
      };
    } catch {
      // In case PDF has no text layer (scanned PDF) or CDN is unreachable
      return {
        fileName: file.name,
        fileType: "pdf",
        rawText: `[PDF file "${file.name}" loaded (${Math.round(file.size / 1024)} KB). The text layer could not be parsed automatically. If this is a scanned PDF, use personal Gemini or OpenRouter vision keys for direct OCR, or paste text below.]`,
        pages: [],
      };
    }
  }

  if (isImage) {
    const { dataUrl, mimeType } = await prepareImageForAi(file);
    return {
      fileName: file.name,
      fileType: "image",
      rawText: `[Image "${file.name}" loaded (${Math.round(file.size / 1024)} KB). Ready for multimodal AI vision extraction.]`,
      pages: [{ pageNumber: 1, text: "" }],
      imageDataUrl: dataUrl,
      imageMimeType: mimeType,
    };
  }

  // Plain text / Markdown / CSV / JSON
  const rawText = await file.text();
  return {
    fileName: file.name,
    fileType: "text",
    rawText,
    pages: [{ pageNumber: 1, text: rawText }],
  };
}

/* -------------------------------------------------------------------------- */
/* Rule-Based Fallback Heuristic Question Extractor                           */
/* -------------------------------------------------------------------------- */

const OPTION_REGEX = /^\s*(?:[\(\[]?([A-Fa-f])[\)\]\.:\-]\s*)(.+)$/;
const ANSWER_REGEX =
  /^\s*(?:ans(?:wer)?|correct\s*(?:option|answer)?)\s*[:=\-]?\s*(.+)/i;
const EXPLANATION_REGEX =
  /^\s*(?:exp(?:lanation)?|sol(?:ution)?|note)\s*[:=\-]\s*(.+)/i;

export function extractQuestionsHeuristically(
  rawText: string,
): HeuristicCandidate[] {
  if (!rawText.trim()) return [];

  // Normalize line endings
  const cleanText = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split on question patterns: e.g. "1.", "Q1.", "Question 1:", "1)", etc.
  const blocks = cleanText
    .split(/(?=^\s*(?:(?:q(?:uestion)?|item|problem)\s*)?\d+\s*[\.\):\-]\s*)/im)
    .map((b) => b.trim())
    .filter(Boolean);

  const candidates: HeuristicCandidate[] = [];

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const optionLines: string[] = [];
    const questionLines: string[] = [];
    let rawAnswerText: string | null = null;
    let detectedExplanation: string | null = null;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      const expMatch = line.match(EXPLANATION_REGEX);
      if (expMatch) {
        detectedExplanation = expMatch[1].trim();
        continue;
      }

      const ansMatch = line.match(ANSWER_REGEX);
      if (ansMatch) {
        rawAnswerText = ansMatch[1].trim();
        continue;
      }

      // Check for option line (only after the first line so question numbers aren't treated as options)
      const optMatch = line.match(OPTION_REGEX);
      if (optMatch && (lineIdx > 0 || optionLines.length > 0)) {
        optionLines.push(optMatch[2].trim());
      } else {
        questionLines.push(line);
      }
    }

    // Clean question prompt
    const stem = questionLines
      .join(" ")
      .replace(
        /^\s*(?:(?:q(?:uestion)?|item|problem)\s*)?\d+\s*[\.\):\-]\s*/i,
        "",
      )
      .trim();

    if (stem.length < 3) continue;

    const isMcq = optionLines.length >= 2;
    const type: "mcq" | "short_qa" = isMcq ? "mcq" : "short_qa";

    let correctAnswer = "";
    let inferred = false;

    if (isMcq) {
      if (rawAnswerText) {
        const letterMatch = rawAnswerText.match(
          /(?:option\s*)?[\(\[]?([A-Da-d])[\)\]\.]?/i,
        );
        if (letterMatch) {
          correctAnswer = letterMatch[1].toUpperCase();
        } else if (/^[1-4]$/.test(rawAnswerText)) {
          correctAnswer = String.fromCharCode(
            64 + Number.parseInt(rawAnswerText, 10),
          );
        } else {
          correctAnswer = "A";
          inferred = true;
        }
      } else {
        correctAnswer = "A";
        inferred = true;
      }
    } else {
      if (rawAnswerText) {
        correctAnswer = rawAnswerText;
        inferred = false;
      } else {
        correctAnswer = "";
        inferred = true;
      }
    }

    candidates.push({
      id: `heur-${Date.now()}-${index}`,
      type,
      question: stem,
      options: isMcq ? optionLines.slice(0, 6) : undefined,
      correctAnswer,
      explanation: detectedExplanation ?? undefined,
      inferred,
      confidence: isMcq && !inferred ? 0.94 : 0.72,
      sourcePage: 1,
    });
  }

  return candidates;
}
