/**
 * Question exports, shared by the localStorage mock and the Supabase adapter.
 *
 * Both backends end every `exportContent` call through the same two writers, so
 * the CSV/PDF byte output is a property of the app rather than of whichever
 * store answered. A cutover must not change what a downloaded file looks like,
 * which is why these functions are exported rather than duplicated per backend.
 *
 * The PDF is written by hand (no dependency): A4 pages, a brand-coloured
 * header band, Helvetica typography, numbered question blocks separated by
 * rules, and a two-column answer key at the end so the question pages can be
 * handed out as a worksheet first. Fonts are the PDF base-14 family (never
 * embedded); text is WinAnsi with common typographic punctuation mapped over.
 */
import type { AnswerData, ExportFile, QuestionType } from "@/backend";
import { ExportFormat } from "@/backend";

/** The slice of a question a download can show. Both backends' rows satisfy it. */
export interface ExportableQuestion {
  prompt: string;
  questionType: QuestionType;
  answer: AnswerData;
  explanation?: string;
}

function slug(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9-_ ]+/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
  return cleaned.length > 0 ? cleaned : "export";
}

export function optionLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

export function answerSummary(answer: AnswerData): string {
  if (answer.__kind__ === "trueFalse") {
    return answer.trueFalse.correct ? "True" : "False";
  }
  if (answer.__kind__ === "shortAnswer") {
    return answer.shortAnswer.expected;
  }
  const options = answer.multipleChoice.options;
  const index = options.findIndex(
    (option) => option.id === answer.multipleChoice.correctOptionId,
  );
  if (index < 0) {
    return "";
  }
  return `${optionLetter(index)}) ${options[index].text}`;
}

function csvCell(value: string): string {
  const flattened = value.replace(/\r?\n/gu, " ").replace(/"/gu, '""');
  // A cell that opens with =, +, - or @ is a formula when the sheet opens, and
  // prompts/explanations are AI- or paste-supplied text. The tab keeps the byte
  // content intact while no spreadsheet evaluates it.
  const safe = /^[=+\-@]/u.test(flattened) ? `\t${flattened}` : flattened;
  return `"${safe}"`;
}

function csvFile(name: string, rows: ExportableQuestion[]): ExportFile {
  const header = [
    "Prompt",
    "Question type",
    "Options",
    "Correct answer",
    "Explanation",
  ].join(",");
  const body = rows.map((row) => {
    const options =
      row.answer.__kind__ === "multipleChoice"
        ? row.answer.multipleChoice.options
            .map((option, index) => `${optionLetter(index)}) ${option.text}`)
            .join(" | ")
        : "";
    return [
      csvCell(row.prompt),
      csvCell(row.questionType),
      csvCell(options),
      csvCell(answerSummary(row.answer)),
      csvCell(row.explanation ?? ""),
    ].join(",");
  });
  return {
    content: [header, ...body].join("\r\n"),
    mimeType: "text/csv",
    filename: `${slug(name)}.csv`,
  };
}

/* -------------------------------------------------------------------------- */
/* PDF writer                                                                  */
/* -------------------------------------------------------------------------- */

/** The brand primary — an sRGB stand-in for oklch(0.52 0.16 52). */
const BRAND: Rgb = { r: 0.749, g: 0.376, b: 0.145 };
const BRAND_DARK: Rgb = { r: 0.541, g: 0.243, b: 0.086 };
const BRAND_PALE: Rgb = { r: 0.949, g: 0.878, b: 0.804 };
const INK: Rgb = { r: 0.173, g: 0.161, b: 0.153 };
const MUTED: Rgb = { r: 0.42, g: 0.404, b: 0.384 };
const RULE: Rgb = { r: 0.847, g: 0.827, b: 0.792 };
const WASH: Rgb = { r: 0.973, g: 0.957, b: 0.929 };

interface Rgb {
  r: number;
  g: number;
  b: number;
}

type FontName = "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_BASELINE = 30;
const BODY_TOP = PAGE_HEIGHT - MARGIN;

const TYPE_LABEL: Record<QuestionType, string> = {
  multipleChoice: "Multiple choice",
  trueFalse: "True / false",
  shortAnswer: "Short answer",
};

/**
 * Standard AFM widths (1/1000 em) for the WinAnsi repertoire this writer
 * emits, so proportional line breaking is measured rather than estimated.
 */
const HELVETICA_WIDTHS: Record<string, number> = {
  " ": 278,
  "!": 278,
  '"': 355,
  "#": 556,
  $: 556,
  "%": 889,
  "&": 667,
  "'": 191,
  "(": 333,
  ")": 333,
  "*": 389,
  "+": 584,
  ",": 278,
  "-": 333,
  ".": 278,
  "/": 278,
  "0": 556,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
  ":": 278,
  ";": 278,
  "<": 584,
  "=": 584,
  ">": 584,
  "?": 556,
  "@": 1015,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  "[": 278,
  "\\": 278,
  "]": 278,
  "^": 469,
  _: 556,
  "`": 333,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  "{": 334,
  "|": 260,
  "}": 334,
  "~": 584,
  "•": 350,
  "’": 222,
  "‘": 222,
  "“": 333,
  "”": 333,
  "–": 556,
  "—": 1000,
  "…": 1000,
  é: 556,
  è: 556,
  ê: 556,
  à: 556,
  ç: 500,
  ü: 556,
  ö: 556,
  ä: 556,
  ß: 556,
  ñ: 556,
};

const HELVETICA_BOLD_WIDTHS: Record<string, number> = {
  " ": 278,
  "!": 333,
  '"': 474,
  "#": 556,
  $: 556,
  "%": 889,
  "&": 722,
  "'": 238,
  "(": 333,
  ")": 333,
  "*": 389,
  "+": 584,
  ",": 278,
  "-": 333,
  ".": 278,
  "/": 278,
  "0": 556,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
  ":": 333,
  ";": 333,
  "<": 584,
  "=": 584,
  ">": 584,
  "?": 611,
  "@": 975,
  A: 722,
  B: 722,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 556,
  K: 722,
  L: 611,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  "[": 333,
  "\\": 278,
  "]": 333,
  "^": 584,
  _: 556,
  "`": 333,
  a: 556,
  b: 611,
  c: 556,
  d: 611,
  e: 556,
  f: 333,
  g: 611,
  h: 611,
  i: 278,
  j: 278,
  k: 556,
  l: 278,
  m: 889,
  n: 611,
  o: 611,
  p: 611,
  q: 611,
  r: 389,
  s: 556,
  t: 333,
  u: 611,
  v: 556,
  w: 778,
  x: 556,
  y: 556,
  z: 500,
  "{": 389,
  "|": 280,
  "}": 389,
  "~": 584,
  "•": 350,
  "’": 278,
  "‘": 278,
  "“": 500,
  "”": 500,
  "–": 556,
  "—": 1000,
  "…": 1000,
  é: 556,
  è: 556,
  ê: 556,
  à: 556,
  ç: 556,
  ü: 611,
  ö: 611,
  ä: 611,
  ß: 611,
  ñ: 611,
};

/**
 * Reduce text to the ASCII subset the download pipeline can carry byte-exact:
 * the export is a JS string that the caller wraps in a Blob, which encodes
 * UTF-8 — so any code point above 127 would change the byte layout and break
 * the xref offsets. Common typographic marks are folded to ASCII equivalents
 * and accented letters are transliterated first.
 */
function toWinAnsi(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2018\u2019\u201B\u00B4\u201A]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/gu, '"')
    .replace(/[\u2013\u2014\u2212\u2012]/gu, "-")
    .replace(/\u2026/gu, "...")
    .replace(/[\u2022\u25CF\u25AA\u00B7\u25E6\u2043]/gu, "-")
    .replace(/\u00A0/gu, " ")
    .replace(/[\u0080-\uFFFF]/gu, "");
}

interface TextStyle {
  font: FontName;
  size: number;
  color?: Rgb;
  lineHeight: number;
}

function widthOf(text: string, style: TextStyle): number {
  const table =
    style.font === "Helvetica-Bold" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let total = 0;
  for (const char of text) {
    total += table[char] ?? (style.font === "Helvetica-Bold" ? 600 : 556);
  }
  return (total / 1000) * style.size;
}

/** Greedy word wrap honouring real glyph widths. Long words are hard-broken. */
function wrapText(text: string, style: TextStyle, maxWidth: number): string[] {
  const normalized = toWinAnsi(text).replace(/\s+/gu, " ").trim();
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  const fits = (candidate: string) => widthOf(candidate, style) <= maxWidth;

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (fits(word)) {
      current = word;
      continue;
    }
    // Hard-break a word longer than the whole column.
    let chunk = "";
    for (const char of word) {
      if (chunk && !fits(`${chunk}${char}`)) {
        lines.push(`${chunk}-`);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

function rgb(color: Rgb): string {
  const to = (v: number) => (Math.round(v * 255) / 255).toFixed(3);
  return `${to(color.r)} ${to(color.g)} ${to(color.b)}`;
}

function escapePdfText(text: string): string {
  return text
    .replace(/\\/gu, "\\\\")
    .replace(/\(/gu, "\\(")
    .replace(/\)/gu, "\\)");
}

const FONT_KEYS: Record<FontName, string> = {
  Helvetica: "F1",
  "Helvetica-Bold": "F2",
  "Helvetica-Oblique": "F3",
};

/** One absolutely positioned page under construction. */
class Page {
  readonly ops: string[] = [];

  rect(x: number, y: number, width: number, height: number, color: Rgb): void {
    this.ops.push(
      `${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`,
    );
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: Rgb,
    width = 0.75,
  ): void {
    this.ops.push(
      `${rgb(color)} RG ${width.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`,
    );
  }

  text(
    text: string,
    x: number,
    baselineY: number,
    style: TextStyle,
    align: "left" | "right" = "left",
  ): void {
    const content = toWinAnsi(text);
    if (!content) return;
    const drawX = align === "right" ? x - widthOf(content, style) : x;
    this.ops.push(
      [
        "BT",
        `${rgb(style.color ?? INK)} rg`,
        `/${FONT_KEYS[style.font]} ${style.size} Tf`,
        `1 0 0 1 ${drawX.toFixed(2)} ${baselineY.toFixed(2)} Tm`,
        `(${escapePdfText(content)}) Tj`,
        "ET",
      ].join("\n"),
    );
  }
}

interface Doc {
  pages: Page[];
}

function newPage(doc: Doc, footerRight: string): Page {
  const page = new Page();
  doc.pages.push(page);
  const pageIndex = doc.pages.length;
  page.line(
    MARGIN,
    FOOTER_BASELINE + 14,
    PAGE_WIDTH - MARGIN,
    FOOTER_BASELINE + 14,
    RULE,
    0.75,
  );
  page.text("StudyForge", MARGIN, FOOTER_BASELINE + 2, {
    font: "Helvetica-Bold",
    size: 7.5,
    color: MUTED,
    lineHeight: 9,
  });
  page.text(
    `Page ${pageIndex} — ${footerRight}`,
    PAGE_WIDTH - MARGIN,
    FOOTER_BASELINE + 2,
    { font: "Helvetica", size: 7.5, color: MUTED, lineHeight: 9 },
    "right",
  );
  return page;
}

/** The brand band at the top of page 1. */
function openDocument(
  doc: Doc,
  title: string,
  subtitle: string,
  meta: string,
  footerRight: string,
): { page: Page; y: number } {
  const page = newPage(doc, footerRight);
  const bandHeight = 108;
  page.rect(0, PAGE_HEIGHT - bandHeight, PAGE_WIDTH, bandHeight, BRAND_DARK);
  page.rect(0, PAGE_HEIGHT - bandHeight - 5, PAGE_WIDTH, 5, BRAND);

  page.text("STUDYFORGE", MARGIN, PAGE_HEIGHT - 30, {
    font: "Helvetica-Bold",
    size: 8.5,
    color: BRAND_PALE,
    lineHeight: 10,
  });
  const titleStyle: TextStyle = {
    font: "Helvetica-Bold",
    size: 21,
    color: { r: 1, g: 1, b: 1 },
    lineHeight: 25,
  };
  const titleLines = wrapText(title, titleStyle, CONTENT_WIDTH - 130);
  let ty = PAGE_HEIGHT - 58;
  for (const line of titleLines.slice(0, 2)) {
    page.text(line, MARGIN, ty, titleStyle);
    ty -= titleStyle.lineHeight;
  }
  page.text(toWinAnsi(subtitle).slice(0, 130), MARGIN, ty - 1, {
    font: "Helvetica",
    size: 9.5,
    color: BRAND_PALE,
    lineHeight: 12,
  });
  page.text(
    meta,
    PAGE_WIDTH - MARGIN,
    PAGE_HEIGHT - 30,
    { font: "Helvetica", size: 8.5, color: BRAND_PALE, lineHeight: 10 },
    "right",
  );

  return { page, y: PAGE_HEIGHT - bandHeight - 34 };
}

interface Pen {
  doc: Doc;
  page: Page;
  y: number;
  footerRight: string;
}

function ensureRoom(pen: Pen, needed: number): void {
  if (pen.y - needed < FOOTER_BASELINE + 26) {
    pen.page = newPage(pen.doc, pen.footerRight);
    pen.y = BODY_TOP;
  }
}

function questionBlock(pen: Pen, index: number, row: ExportableQuestion): void {
  const { page } = pen;

  const numberStyle: TextStyle = {
    font: "Helvetica-Bold",
    size: 10,
    color: { r: 1, g: 1, b: 1 },
    lineHeight: 12,
  };
  const promptStyle: TextStyle = {
    font: "Helvetica",
    size: 10.5,
    color: INK,
    lineHeight: 15,
  };
  const optionStyle: TextStyle = {
    font: "Helvetica",
    size: 9.5,
    color: MUTED,
    lineHeight: 13.5,
  };
  const typeStyle: TextStyle = {
    font: "Helvetica-Oblique",
    size: 7.5,
    color: MUTED,
    lineHeight: 9,
  };

  const promptLines = wrapText(row.prompt, promptStyle, CONTENT_WIDTH - 60);
  const options =
    row.answer.__kind__ === "multipleChoice"
      ? row.answer.multipleChoice.options
      : [];
  const optionLines = options.map((option, optionIndex) =>
    wrapText(
      `${optionLetter(optionIndex)})  ${option.text}`,
      optionStyle,
      CONTENT_WIDTH - 76,
    ),
  );
  const height =
    24 +
    promptLines.length * promptStyle.lineHeight +
    (optionLines.length > 0
      ? optionLines.reduce(
          (sum, lines) => sum + lines.length * optionStyle.lineHeight,
          0,
        ) + 4
      : 0) +
    18;

  ensureRoom(pen, height);

  // Question card: brand number chip, type label, prompt, lettered options.
  const chipSize = 18;
  const chipTop = pen.y - 6;
  page.rect(MARGIN, chipTop - chipSize, chipSize, chipSize, BRAND);
  const numberWidth = widthOf(String(index), numberStyle);
  page.text(
    String(index),
    MARGIN + (chipSize - numberWidth) / 2,
    chipTop - 9.5,
    numberStyle,
  );
  page.text(
    TYPE_LABEL[row.questionType],
    MARGIN + chipSize + 10,
    chipTop - 9.5,
    typeStyle,
  );

  let ty = chipTop - chipSize - promptStyle.size;
  for (const line of promptLines) {
    page.text(line, MARGIN + chipSize + 10, ty, promptStyle);
    ty -= promptStyle.lineHeight;
  }

  if (optionLines.length > 0) {
    ty -= 3;
    for (const lines of optionLines) {
      for (const line of lines) {
        page.text(line, MARGIN + chipSize + 22, ty, optionStyle);
        ty -= optionStyle.lineHeight;
      }
    }
  }

  pen.y = ty - 8;
  page.line(MARGIN, pen.y, PAGE_WIDTH - MARGIN, pen.y, RULE, 0.6);
  pen.y -= 14;
}

function assemblePdf(doc: Doc, objects: string[]): string {
  const pageObjectNumbers: number[] = [];
  let nextObjectNumber = 6; // 1 catalog, 2 pages tree, 3-5 fonts
  for (let i = 0; i < doc.pages.length; i += 1) {
    pageObjectNumbers.push(nextObjectNumber);
    nextObjectNumber += 2;
  }

  objects.unshift(
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${String(doc.pages.length)} /Kids [${pageObjectNumbers
      .map((num) => `${String(num)} 0 R`)
      .join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>",
  );

  doc.pages.forEach((page, index) => {
    const contentNumber = pageObjectNumbers[index] + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${String(contentNumber)} 0 R >>`,
    );
    const stream = page.ops.join("\n");
    objects.push(
      `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return pdf;
}

function pdfFile(name: string, rows: ExportableQuestion[]): ExportFile {
  const doc: Doc = { pages: [] };
  const objects: string[] = [];
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const meta = `${rows.length} ${rows.length === 1 ? "question" : "questions"} · ${today}`;

  const open = openDocument(
    doc,
    name,
    "Practice worksheet — try every question before the answer key",
    meta,
    name,
  );
  const pen: Pen = { doc, page: open.page, y: open.y, footerRight: name };

  pen.page.text(
    `This set contains ${rows.length} ${rows.length === 1 ? "question" : "questions"}. Answers and explanations begin on the key page.`,
    MARGIN,
    pen.y,
    { font: "Helvetica-Oblique", size: 9, color: MUTED, lineHeight: 12 },
  );
  pen.y -= 22;

  rows.forEach((row, index) => {
    questionBlock(pen, index + 1, row);
  });

  // Answer key: banded heading, then two columns of entries with explanations.
  let keyPage = newPage(doc, name);
  keyPage.rect(0, PAGE_HEIGHT - 64, PAGE_WIDTH, 64, WASH);
  keyPage.rect(0, PAGE_HEIGHT - 64, PAGE_WIDTH, 3, BRAND);
  keyPage.text("Answer key", MARGIN, PAGE_HEIGHT - 40, {
    font: "Helvetica-Bold",
    size: 14,
    color: BRAND_DARK,
    lineHeight: 16,
  });
  keyPage.text(
    name,
    PAGE_WIDTH - MARGIN,
    PAGE_HEIGHT - 40,
    { font: "Helvetica", size: 9, color: MUTED, lineHeight: 12 },
    "right",
  );

  const entryStyle: TextStyle = {
    font: "Helvetica",
    size: 9.5,
    color: INK,
    lineHeight: 13,
  };
  const explanationStyle: TextStyle = {
    font: "Helvetica-Oblique",
    size: 8.5,
    color: MUTED,
    lineHeight: 11.5,
  };
  const columnWidth = (CONTENT_WIDTH - 28) / 2;
  const keyTop = PAGE_HEIGHT - 94;
  const perColumn = Math.ceil(rows.length / 2);
  let column = 0;
  let baseY = keyTop;
  let y = baseY;
  rows.forEach((row, index) => {
    // First half fills the left column, the rest the right; a column that
    // overflows the page continues on the next page, left column first.
    if (index === perColumn) {
      column = 1;
      y = keyTop;
    }
    const lines = wrapText(
      `${index + 1}.  ${answerSummary(row.answer)}`,
      entryStyle,
      columnWidth,
    );
    const explanation = row.explanation
      ? wrapText(row.explanation, explanationStyle, columnWidth - 12)
      : [];
    const blockHeight =
      lines.length * entryStyle.lineHeight +
      explanation.length * explanationStyle.lineHeight +
      7;
    if (y - blockHeight < FOOTER_BASELINE + 30) {
      keyPage = newPage(doc, name);
      column = 0;
      baseY = BODY_TOP;
      y = baseY;
    }
    let ty = y;
    const x = MARGIN + column * (columnWidth + 28);
    for (const line of lines) {
      keyPage.text(line, x, ty, entryStyle);
      ty -= entryStyle.lineHeight;
    }
    for (const line of explanation) {
      keyPage.text(line, x + 12, ty, explanationStyle);
      ty -= explanationStyle.lineHeight;
    }
    y = ty - 7;
  });

  return {
    content: assemblePdf(doc, objects),
    mimeType: "application/pdf",
    filename: `${slug(name)}.pdf`,
  };
}

export function exportFileFor(
  name: string,
  rows: ExportableQuestion[],
  format: ExportFormat,
): ExportFile {
  return format === ExportFormat.pdf
    ? pdfFile(name, rows)
    : csvFile(name, rows);
}
