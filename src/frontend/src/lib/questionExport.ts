/**
 * Question exports, shared by the localStorage mock and the Supabase adapter.
 *
 * Both backends end every `exportContent` call through the same two writers, so
 * the CSV/PDF byte output is a property of the app rather than of whichever
 * store answered. A cutover must not change what a downloaded file looks like,
 * which is why these functions are exported rather than duplicated per backend.
 *
 * The PDF is written by hand (no dependency): A4 pages carrying a double-rule
 * frame with brand corner studs, a gradient cover panel, section headings that
 * name the question type, question cards with a brand accent bar, lettered
 * choice boxes / true-false circles / ruled answer lines, and a two-column
 * answer key on its own banded page so the question pages can be handed out as
 * a worksheet first. Fonts are the PDF base-14 family (never embedded), so
 * every glyph is measured against the AFM widths below; text is folded to
 * WinAnsi because the emitted string doubles as the Blob payload.
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
/** The ramp the cover gradient walks: near-black ember into the lit end. */
const BRAND_DEEP: Rgb = { r: 0.337, g: 0.149, b: 0.055 };
const BRAND_LIT: Rgb = { r: 0.886, g: 0.565, b: 0.255 };
const BRAND_PALE: Rgb = { r: 0.949, g: 0.878, b: 0.804 };
const BRAND_TINT: Rgb = { r: 0.988, g: 0.953, b: 0.910 };
const INK: Rgb = { r: 0.173, g: 0.161, b: 0.153 };
const MUTED: Rgb = { r: 0.42, g: 0.404, b: 0.384 };
/** The warm hairline every card and frame edge is drawn with. */
const SAND: Rgb = { r: 0.867, g: 0.804, b: 0.706 };
const WASH: Rgb = { r: 0.973, g: 0.957, b: 0.929 };
/** A card fill a shade off the page, so the border reads as a raised panel. */
const CARD: Rgb = { r: 0.996, g: 0.988, b: 0.980 };
const WHITE: Rgb = { r: 1, g: 1, b: 1 };

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
const FOOTER_BASELINE = 32;
const FOOTER_RULE = 47;
const BODY_TOP = PAGE_HEIGHT - 86;

/** The double-rule border: a brand line, then a warm hairline inside it. */
const FRAME_OUTER = 22;
const FRAME_INNER = 27.5;
/** Cover / band panels bleed closer to the edge than the text column does. */
const PANEL_X = 34;
const PANEL_WIDTH = PAGE_WIDTH - PANEL_X * 2;
const COVER_TOP = PAGE_HEIGHT - 34;
const COVER_HEIGHT = 142;
/** A card may not start below this line; it moves to the next page instead. */
const FLOOR = FOOTER_RULE + 34;

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
  /** Extra space after every glyph — the small-caps labels are tracked out. */
  tracking?: number;
}

function widthOf(text: string, style: TextStyle): number {
  const table =
    style.font === "Helvetica-Bold" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let total = 0;
  let glyphs = 0;
  for (const char of text) {
    total += table[char] ?? (style.font === "Helvetica-Bold" ? 600 : 556);
    glyphs += 1;
  }
  const tracking = style.tracking ?? 0;
  return (total / 1000) * style.size + tracking * Math.max(0, glyphs - 1);
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

/** One line, shortened with an ASCII ellipsis when it cannot fit. */
function fitLine(text: string, style: TextStyle, maxWidth: number): string {
  const normalized = toWinAnsi(text).replace(/\s+/gu, " ").trim();
  let line = normalized;
  while (line.length > 1 && widthOf(`${line}...`, style) > maxWidth) {
    line = line.slice(0, -1);
  }
  return line === normalized ? normalized : `${line.trimEnd()}...`;
}

function rgb(color: Rgb): string {
  const to = (v: number) => (Math.round(v * 255) / 255).toFixed(3);
  return `${to(color.r)} ${to(color.g)} ${to(color.b)}`;
}

function mixRgb(from: Rgb, to: Rgb, t: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
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

/** Control-point offset as a fraction of the corner radius (kappa). */
const KAPPA = 0.5523;

/** A closed rectangle path with corners of `radius`, in PDF path operators. */
function roundedPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const k = r * KAPPA;
  const right = x + width;
  const top = y + height;
  const n = (value: number) => value.toFixed(2);
  return [
    `${n(x)} ${n(y + r)} m`,
    `${n(x)} ${n(top - r)} l`,
    `${n(x)} ${n(top - r + k)} ${n(x + r - k)} ${n(top)} ${n(x + r)} ${n(top)} c`,
    `${n(right - r)} ${n(top)} l`,
    `${n(right - r + k)} ${n(top)} ${n(right)} ${n(top - r + k)} ${n(right)} ${n(top - r)} c`,
    `${n(right)} ${n(y + r)} l`,
    `${n(right)} ${n(y + r - k)} ${n(right - r + k)} ${n(y)} ${n(right - r)} ${n(y)} c`,
    `${n(x + r)} ${n(y)} l`,
    `${n(x + r - k)} ${n(y)} ${n(x)} ${n(y + r - k)} ${n(x)} ${n(y + r)} c`,
    "h",
  ].join(" ");
}

/** One absolutely positioned page under construction. */
class Page {
  readonly ops: string[] = [];

  rect(x: number, y: number, width: number, height: number, color: Rgb): void {
    this.ops.push(
      `${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`,
    );
  }

  /** Left-to-right colour ramp, painted as overlapping one-point strips. */
  gradient(
    x: number,
    y: number,
    width: number,
    height: number,
    from: Rgb,
    to: Rgb,
    steps = 64,
  ): void {
    const strip = width / steps;
    for (let index = 0; index < steps; index += 1) {
      const t = steps === 1 ? 0 : index / (steps - 1);
      this.ops.push(
        `${rgb(mixRgb(from, to, t))} rg ${(x + index * strip).toFixed(2)} ${y.toFixed(2)} ${(strip + 0.6).toFixed(2)} ${height.toFixed(2)} re f`,
      );
    }
  }

  shape(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    options: {
      fill?: Rgb;
      stroke?: Rgb;
      strokeWidth?: number;
      dash?: string;
    } = {},
  ): void {
    const body = roundedPath(x, y, width, height, radius);
    const state = `${options.dash ? `[${options.dash}]` : "[]"} 0 d`;
    if (options.fill) {
      this.ops.push(`${rgb(options.fill)} rg ${state} ${body} f`);
    }
    if (options.stroke) {
      this.ops.push(
        `${rgb(options.stroke)} RG ${(options.strokeWidth ?? 0.8).toFixed(2)} w ${state} ${body} S`,
      );
    }
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: Rgb,
    width = 0.75,
    dash?: string,
  ): void {
    this.ops.push(
      `${rgb(color)} RG ${width.toFixed(2)} w ${dash ? `[${dash}]` : "[]"} 0 d ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`,
    );
  }

  text(
    text: string,
    x: number,
    baselineY: number,
    style: TextStyle,
    align: "left" | "right" | "center" = "left",
  ): void {
    const content = toWinAnsi(text);
    if (!content) return;
    const measured = widthOf(content, style);
    const drawX =
      align === "right"
        ? x - measured
        : align === "center"
          ? x - measured / 2
          : x;
    this.ops.push(
      [
        "BT",
        `${rgb(style.color ?? INK)} rg`,
        `/${FONT_KEYS[style.font]} ${style.size} Tf`,
        `${(style.tracking ?? 0).toFixed(2)} Tc`,
        `1 0 0 1 ${drawX.toFixed(2)} ${baselineY.toFixed(2)} Tm`,
        `(${escapePdfText(content)}) Tj`,
        "ET",
      ].join("\n"),
    );
  }
}

interface Doc {
  pages: Page[];
  /** Names every page after the cover, in the running header and footer. */
  documentName: string;
}

/* --- the type sheet the whole document is drawn from ---------------------- */

const MICRO_LABEL: TextStyle = {
  font: "Helvetica-Bold",
  size: 7,
  tracking: 1.9,
  lineHeight: 9,
  color: BRAND_DARK,
};
const FOOTER_TEXT: TextStyle = {
  font: "Helvetica",
  size: 7,
  lineHeight: 9,
  color: MUTED,
};
const HEADER_LABEL: TextStyle = {
  font: "Helvetica-Bold",
  size: 8.5,
  tracking: 1.5,
  lineHeight: 11,
  color: BRAND_DARK,
};
const HEADER_RIGHT: TextStyle = {
  font: "Helvetica",
  size: 6.8,
  tracking: 1.6,
  lineHeight: 9,
  color: MUTED,
};
const SECTION_EYEBROW: TextStyle = {
  font: "Helvetica-Bold",
  size: 7.2,
  tracking: 2.6,
  lineHeight: 9,
  color: BRAND,
};
const SECTION_TITLE: TextStyle = {
  font: "Helvetica-Bold",
  size: 12.5,
  lineHeight: 15,
  color: INK,
};
const SECTION_META: TextStyle = {
  font: "Helvetica",
  size: 7.4,
  tracking: 0.8,
  lineHeight: 9,
  color: MUTED,
};
const CARD_TYPE: TextStyle = {
  font: "Helvetica-Bold",
  size: 6.8,
  tracking: 1.8,
  lineHeight: 9,
  color: BRAND_DARK,
};
const CARD_COUNT: TextStyle = {
  font: "Helvetica",
  size: 7.2,
  tracking: 0.5,
  lineHeight: 9,
  color: MUTED,
};
const CHIP_NUMBER: TextStyle = {
  font: "Helvetica-Bold",
  size: 10,
  lineHeight: 12,
  color: WHITE,
};
const PROMPT: TextStyle = {
  font: "Helvetica",
  size: 10.5,
  lineHeight: 15.5,
  color: INK,
};
const OPTION: TextStyle = {
  font: "Helvetica",
  size: 9.6,
  lineHeight: 14,
  color: INK,
};
const OPTION_LETTER: TextStyle = {
  font: "Helvetica-Bold",
  size: 7.6,
  lineHeight: 10,
  color: BRAND_DARK,
};
const CHOICE_PILL: TextStyle = {
  font: "Helvetica",
  size: 9.4,
  lineHeight: 12,
  color: INK,
};
const NOTE: TextStyle = {
  font: "Helvetica-Oblique",
  size: 8.6,
  lineHeight: 12,
  color: MUTED,
};
const KEY_ENTRY: TextStyle = {
  font: "Helvetica-Bold",
  size: 9,
  lineHeight: 12.5,
  color: INK,
};
const KEY_CHIP_TEXT: TextStyle = {
  font: "Helvetica-Bold",
  size: 7.6,
  lineHeight: 10,
  color: BRAND_DARK,
};
const KEY_EXPLAIN: TextStyle = {
  font: "Helvetica-Oblique",
  size: 8.2,
  lineHeight: 11.2,
  color: MUTED,
};
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Baseline that puts a line of `size` at the top of a band. */
function baselineIn(bandTop: number, size: number): number {
  return bandTop - size * 0.78;
}

/** Baseline that vertically centres a line of `size` inside a box. */
function baselineInBox(boxY: number, boxHeight: number, size: number): number {
  return boxY + (boxHeight - size * 0.72) / 2;
}

/** A fresh page with the frame, corner studs and footer already painted. */
function newPage(
  doc: Doc,
  options: { runningHeader?: string } = {},
): { page: Page; top: number } {
  const page = new Page();
  doc.pages.push(page);
  const pageNumber = doc.pages.length;

  page.shape(
    FRAME_OUTER,
    FRAME_OUTER,
    PAGE_WIDTH - FRAME_OUTER * 2,
    PAGE_HEIGHT - FRAME_OUTER * 2,
    5,
    { stroke: BRAND_LIT, strokeWidth: 1.1 },
  );
  page.shape(
    FRAME_INNER,
    FRAME_INNER,
    PAGE_WIDTH - FRAME_INNER * 2,
    PAGE_HEIGHT - FRAME_INNER * 2,
    2,
    { stroke: SAND, strokeWidth: 0.6 },
  );
  const stud = 7.4;
  const corners: Array<[number, number]> = [
    [FRAME_OUTER, FRAME_OUTER],
    [PAGE_WIDTH - FRAME_OUTER, FRAME_OUTER],
    [FRAME_OUTER, PAGE_HEIGHT - FRAME_OUTER],
    [PAGE_WIDTH - FRAME_OUTER, PAGE_HEIGHT - FRAME_OUTER],
  ];
  for (const [cornerX, cornerY] of corners) {
    page.rect(cornerX - stud / 2, cornerY - stud / 2, stud, stud, BRAND);
    page.rect(cornerX - 1.5, cornerY - 1.5, 3, 3, BRAND_PALE);
  }

  page.line(
    MARGIN,
    FOOTER_RULE,
    PAGE_WIDTH - MARGIN,
    FOOTER_RULE,
    SAND,
    0.6,
  );
  page.text("STUDYFORGE", MARGIN, FOOTER_BASELINE, MICRO_LABEL);
  page.text(
    fitLine(
      `${doc.documentName} - Page ${pageNumber}`,
      FOOTER_TEXT,
      CONTENT_WIDTH - 90,
    ),
    PAGE_WIDTH - MARGIN,
    FOOTER_BASELINE,
    FOOTER_TEXT,
    "right",
  );

  if (options.runningHeader === undefined) return { page, top: BODY_TOP };

  const headerBaseline = PAGE_HEIGHT - 56;
  page.text(
    fitLine(options.runningHeader, HEADER_LABEL, CONTENT_WIDTH - 140),
    MARGIN,
    headerBaseline,
    HEADER_LABEL,
  );
  page.text(
    "PRACTICE WORKSHEET",
    PAGE_WIDTH - MARGIN,
    headerBaseline,
    HEADER_RIGHT,
    "right",
  );
  page.line(
    MARGIN,
    headerBaseline - 9,
    PAGE_WIDTH - MARGIN,
    headerBaseline - 9,
    SAND,
    0.6,
  );
  page.rect(MARGIN, headerBaseline - 10.4, 52, 2.6, BRAND);
  return { page, top: headerBaseline - 30 };
}

/** The gradient cover panel on page 1, with the brand lockup and title. */
function drawCover(
  page: Page,
  title: string,
  subtitle: string,
  countLabel: string,
  dateLabel: string,
): number {
  const panelY = COVER_TOP - COVER_HEIGHT;
  page.gradient(
    PANEL_X,
    panelY,
    PANEL_WIDTH,
    COVER_HEIGHT,
    BRAND_DEEP,
    BRAND_LIT,
    72,
  );
  page.shape(PANEL_X, panelY, PANEL_WIDTH, COVER_HEIGHT, 6, {
    stroke: BRAND_DARK,
    strokeWidth: 0.9,
  });
  page.rect(PANEL_X + 0.5, panelY + 0.5, PANEL_WIDTH - 1, 3.4, BRAND_DARK);
  page.rect(PANEL_X + 0.5, panelY + 3.9, PANEL_WIDTH - 1, 1, BRAND_PALE);

  const insetX = PANEL_X + 22;
  const rightEdge = PAGE_WIDTH - PANEL_X - 22;

  const monogram = 30;
  const monogramY = COVER_TOP - 20 - monogram;
  page.shape(insetX, monogramY, monogram, monogram, 8, { fill: WHITE });
  page.text(
    "SF",
    insetX + monogram / 2,
    baselineInBox(monogramY, monogram, 12.5),
    { font: "Helvetica-Bold", size: 12.5, lineHeight: 15, color: BRAND_DARK },
    "center",
  );
  page.text("STUDYFORGE", insetX + monogram + 12, monogramY + monogram - 11, {
    font: "Helvetica-Bold",
    size: 9,
    tracking: 2.8,
    lineHeight: 11,
    color: WHITE,
  });
  page.text("QUESTION BANK EXPORT", insetX + monogram + 12, monogramY + 2, {
    font: "Helvetica",
    size: 6.6,
    tracking: 1.9,
    lineHeight: 9,
    color: BRAND_PALE,
  });
  page.text(countLabel, rightEdge, monogramY + monogram - 11, {
    font: "Helvetica-Bold",
    size: 9,
    lineHeight: 11,
    color: WHITE,
  });
  page.text(dateLabel, rightEdge, monogramY + 2, {
    font: "Helvetica",
    size: 7.4,
    lineHeight: 9,
    color: BRAND_PALE,
  });

  const titleStyle: TextStyle = {
    font: "Helvetica-Bold",
    size: 23,
    lineHeight: 27,
    color: WHITE,
  };
  const titleWidth = PANEL_WIDTH - 44;
  const titleLines = wrapText(title, titleStyle, titleWidth).slice(0, 2);
  let ty = monogramY - 24;
  for (const line of titleLines) {
    page.text(line, insetX, ty, titleStyle);
    ty -= titleStyle.lineHeight;
  }
  page.text(fitLine(subtitle, NOTE, titleWidth), insetX, ty - 1, {
    font: "Helvetica-Oblique",
    size: 9,
    lineHeight: 12,
    color: BRAND_PALE,
  });
  page.line(insetX, panelY + 16, insetX + 64, panelY + 16, BRAND_PALE, 1);

  return panelY - 24;
}

/** The name / date / score line a printed worksheet is filled in with. */
function drawCandidateStrip(page: Page, top: number): number {
  const height = 30;
  const y = top - height;
  page.shape(MARGIN, y, CONTENT_WIDTH, height, 7, {
    fill: BRAND_TINT,
    stroke: SAND,
    strokeWidth: 0.7,
  });
  const labelStyle: TextStyle = {
    font: "Helvetica-Bold",
    size: 7.2,
    tracking: 1.4,
    lineHeight: 9,
    color: BRAND_DARK,
  };
  const fields: Array<[string, number]> = [
    ["NAME", 0.42],
    ["DATE", 0.3],
    ["SCORE", 0.28],
  ];
  const innerLeft = MARGIN + 13;
  const innerRight = PAGE_WIDTH - MARGIN - 13;
  const trackWidth = innerRight - innerLeft;
  const baseline = y + 12;
  let cursor = innerLeft;
  fields.forEach(([label, share], index) => {
    const cellRight =
      index === fields.length - 1
        ? innerRight
        : cursor + trackWidth * share - 16;
    const labelWidth = widthOf(label, labelStyle);
    page.text(label, cursor, baseline, labelStyle);
    page.line(
      cursor + labelWidth + 6,
      baseline - 2.4,
      cellRight,
      baseline - 2.4,
      BRAND_PALE,
      0.8,
      "1 3",
    );
    cursor = cellRight + 16;
  });
  return y - 16;
}

interface Pen {
  doc: Doc;
  page: Page;
  y: number;
}

function startPage(pen: Pen, runningHeader: string): void {
  const next = newPage(pen.doc, { runningHeader });
  pen.page = next.page;
  pen.y = next.top;
}

function ensureRoom(pen: Pen, needed: number, runningHeader: string): void {
  if (pen.y - needed < FLOOR) startPage(pen, runningHeader);
}

/** `Section B - True / false` with its own rule, on a page that has room. */
function drawSectionHeading(
  pen: Pen,
  letter: string,
  label: string,
  meta: string,
  runningHeader: string,
): void {
  ensureRoom(pen, 96, runningHeader);
  const height = 46;
  const y = pen.y - height;
  pen.page.shape(MARGIN - 5, y, CONTENT_WIDTH + 10, height, 7, { fill: WASH });
  pen.page.rect(MARGIN - 5, y + 8, 3.4, height - 16, BRAND);
  pen.page.text(
    `SECTION ${letter}`,
    MARGIN + 10,
    pen.y - 10,
    SECTION_EYEBROW,
  );
  pen.page.text(
    label,
    MARGIN + 10,
    baselineIn(pen.y - 16, SECTION_TITLE.size),
    SECTION_TITLE,
  );
  pen.page.text(meta, PAGE_WIDTH - MARGIN + 5, pen.y - 12, SECTION_META, "right");
  pen.page.line(MARGIN + 10, y + 8, PAGE_WIDTH - MARGIN + 5, y + 8, SAND, 0.6);
  pen.y = y - 11;
}

/** One question: a bordered card, a numbered chip, and its answer space. */
function drawQuestionCard(
  pen: Pen,
  index: number,
  total: number,
  chipSide: number,
  row: ExportableQuestion,
  runningHeader: string,
): void {
  const padTop = 12;
  const gapAfterHeader = 9;
  const gapAfterPrompt = 7;
  const padBottom = 13;
  const innerX = MARGIN + 13 + chipSide + 12;
  const right = PAGE_WIDTH - MARGIN - 14;
  const optionTextX = innerX + 21;

  const promptLines = wrapText(row.prompt, PROMPT, right - innerX);
  const options =
    row.answer.__kind__ === "multipleChoice"
      ? row.answer.multipleChoice.options
      : [];
  const optionLines = options.map((option) =>
    wrapText(option.text, OPTION, right - optionTextX),
  );
  const ruledLines = row.questionType === "shortAnswer" ? 3 : 0;
  const answerHeight =
    optionLines.length > 0
      ? optionLines.reduce(
          (sum, lines) => sum + lines.length * OPTION.lineHeight,
          0,
        ) + 3
      : ruledLines > 0
        ? ruledLines * 18
        : 17;
  const height =
    padTop +
    chipSide +
    gapAfterHeader +
    promptLines.length * PROMPT.lineHeight +
    gapAfterPrompt +
    answerHeight +
    padBottom;

  ensureRoom(pen, height + 6, runningHeader);
  const page = pen.page;
  const top = pen.y;
  const cardY = top - height;

  page.shape(MARGIN, cardY, CONTENT_WIDTH, height, 9, {
    fill: CARD,
    stroke: SAND,
    strokeWidth: 0.8,
  });
  page.rect(MARGIN + 0.7, cardY + 10, 3.2, height - 20, BRAND);

  const chipX = MARGIN + 13;
  const chipY = top - padTop - chipSide;
  page.shape(chipX + 1.5, chipY - 1.5, chipSide, chipSide, 6, {
    fill: BRAND_PALE,
  });
  page.shape(chipX, chipY, chipSide, chipSide, 6, { fill: BRAND });
  page.text(
    String(index),
    chipX + chipSide / 2,
    baselineInBox(chipY, chipSide, CHIP_NUMBER.size),
    CHIP_NUMBER,
    "center",
  );
  const headerBaseline = baselineInBox(chipY, chipSide, CARD_TYPE.size);
  page.text(
    TYPE_LABEL[row.questionType].toUpperCase(),
    innerX,
    headerBaseline,
    CARD_TYPE,
  );
  page.text(
    `Question ${index} of ${total}`,
    right,
    baselineInBox(chipY, chipSide, CARD_COUNT.size),
    CARD_COUNT,
    "right",
  );

  let bandTop = chipY - gapAfterHeader;
  for (const line of promptLines) {
    page.text(line, innerX, baselineIn(bandTop, PROMPT.size), PROMPT);
    bandTop -= PROMPT.lineHeight;
  }

  const answerTop = bandTop - PROMPT.size * 0.22 - gapAfterPrompt;
  if (optionLines.length > 0) {
    let rowTop = answerTop;
    optionLines.forEach((lines, optionIndex) => {
      const firstBaseline = baselineIn(rowTop, OPTION.size);
      const box = 12.5;
      const boxY = firstBaseline - 3.75;
      page.shape(innerX, boxY, box, box, 3.6, {
        fill: WHITE,
        stroke: BRAND_LIT,
        strokeWidth: 0.8,
      });
      page.text(
        optionLetter(optionIndex),
        innerX + box / 2,
        baselineInBox(boxY, box, OPTION_LETTER.size),
        OPTION_LETTER,
        "center",
      );
      for (const line of lines) {
        page.text(line, optionTextX, baselineIn(rowTop, OPTION.size), OPTION);
        rowTop -= OPTION.lineHeight;
      }
    });
  } else if (ruledLines > 0) {
    let lineY = answerTop - 4;
    for (let line = 0; line < ruledLines; line += 1) {
      page.line(innerX, lineY, right, lineY, SAND, 0.7, "1 3.2");
      lineY -= 18;
    }
  } else {
    let pillX = innerX;
    const pillY = answerTop - 16;
    for (const choice of ["True", "False"]) {
      const pillWidth = widthOf(choice, CHOICE_PILL) + 26;
      page.shape(pillX, pillY, pillWidth, 16, 8, {
        fill: WHITE,
        stroke: BRAND_LIT,
        strokeWidth: 0.9,
      });
      page.text(
        choice,
        pillX + pillWidth / 2,
        baselineInBox(pillY, 16, CHOICE_PILL.size),
        CHOICE_PILL,
        "center",
      );
      pillX += pillWidth + 11;
    }
  }

  pen.y = cardY - 12;
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

/** The gradient band that opens the answer-key pages. */
function drawKeyBand(
  page: Page,
  subtitle: string,
  meta: string,
): number {
  const height = 74;
  const y = PAGE_HEIGHT - 34 - height;
  page.gradient(PANEL_X, y, PANEL_WIDTH, height, BRAND_DARK, BRAND, 56);
  page.shape(PANEL_X, y, PANEL_WIDTH, height, 6, {
    stroke: BRAND_DEEP,
    strokeWidth: 0.9,
  });
  page.rect(PANEL_X + 0.5, y + 0.5, PANEL_WIDTH - 1, 3, BRAND_LIT);
  const insetX = PANEL_X + 22;
  page.text("FOR THE MARKER", insetX, y + height - 20, {
    font: "Helvetica",
    size: 6.6,
    tracking: 2,
    lineHeight: 9,
    color: BRAND_PALE,
  });
  page.text("ANSWER KEY", insetX, baselineIn(y + height - 26, 18), {
    font: "Helvetica-Bold",
    size: 18,
    tracking: 2.6,
    lineHeight: 21,
    color: WHITE,
  });
  page.text(fitLine(subtitle, NOTE, PANEL_WIDTH - 200), insetX, y + 16, {
    font: "Helvetica-Oblique",
    size: 8.4,
    lineHeight: 11,
    color: BRAND_PALE,
  });
  page.text(meta, PAGE_WIDTH - PANEL_X - 22, y + height - 30, {
    font: "Helvetica-Bold",
    size: 8.6,
    lineHeight: 11,
    color: WHITE,
  });
  return y - 22;
}

interface KeyEntryMetrics {
  answerLines: string[];
  explanation: string[];
  /** Distance from the entry's band top to the next entry's band top. */
  height: number;
  /** Where the separating rule sits, relative to the band top. */
  rule: number;
}

const KEY_CHIP = 14;

/** Measure an answer-key entry so a page break can be decided before drawing. */
function measureKeyEntry(
  row: ExportableQuestion,
  width: number,
): KeyEntryMetrics {
  const entryWidth = width - KEY_CHIP - 7;
  const answerLines = wrapText(
    answerSummary(row.answer) || "-",
    KEY_ENTRY,
    entryWidth,
  );
  const explanation = row.explanation
    ? wrapText(row.explanation, KEY_EXPLAIN, entryWidth - 6)
    : [];
  const content =
    answerLines.length * KEY_ENTRY.lineHeight +
    (explanation.length > 0
      ? 1 + explanation.length * KEY_EXPLAIN.lineHeight
      : 0);
  const body = Math.max(content, KEY_CHIP);
  return { answerLines, explanation, height: body + 11, rule: -body - 3 };
}

/** One answer-key entry: numbered chip, the answer, then why. */
function drawKeyEntry(
  page: Page,
  top: number,
  index: number,
  x: number,
  width: number,
  metrics: KeyEntryMetrics,
): number {
  const textX = x + KEY_CHIP + 7;
  const chipY = top - KEY_CHIP;
  page.shape(x, chipY, KEY_CHIP, KEY_CHIP, 4, {
    fill: BRAND_TINT,
    stroke: SAND,
    strokeWidth: 0.6,
  });
  page.text(
    String(index),
    x + KEY_CHIP / 2,
    baselineInBox(chipY, KEY_CHIP, KEY_CHIP_TEXT.size),
    KEY_CHIP_TEXT,
    "center",
  );
  let bandTop = top;
  for (const line of metrics.answerLines) {
    page.text(line, textX, baselineIn(bandTop, KEY_ENTRY.size), KEY_ENTRY);
    bandTop -= KEY_ENTRY.lineHeight;
  }
  bandTop -= 1;
  for (const line of metrics.explanation) {
    page.text(line, textX + 6, baselineIn(bandTop, KEY_EXPLAIN.size), KEY_EXPLAIN);
    bandTop -= KEY_EXPLAIN.lineHeight;
  }
  const ruleY = top + metrics.rule;
  page.line(x, ruleY, x + width, ruleY, SAND, 0.45);
  return top - metrics.height;
}

function pdfFile(name: string, rows: ExportableQuestion[]): ExportFile {
  const doc: Doc = { pages: [], documentName: name };
  const objects: string[] = [];
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const plural = (count: number, word: string) =>
    `${count} ${count === 1 ? word : `${word}s`}`;
  const runningHeader = name;

  const cover = newPage(doc);
  const chipSide = Math.max(
    20,
    widthOf(String(rows.length), CHIP_NUMBER) + 11,
  );
  const afterCover = drawCover(
    cover.page,
    name,
    "Answer every question before you turn to the key at the back.",
    plural(rows.length, "question"),
    today,
  );
  const pen: Pen = { doc, page: cover.page, y: afterCover };
  pen.y = drawCandidateStrip(pen.page, pen.y);
  const introLines = wrapText(
    `This paper was built from your StudyForge bank on ${today}. Work through the sections in order, then mark it against the answer key at the back - every answer carries its explanation.`,
    NOTE,
    CONTENT_WIDTH,
  );
  for (const line of introLines) {
    pen.page.text(line, MARGIN, baselineIn(pen.y, NOTE.size), NOTE);
    pen.y -= NOTE.lineHeight;
  }
  pen.y -= 10;

  // Sections are runs of one question type, so numbering never has to restart.
  const runs: Array<{ type: QuestionType; from: number; to: number }> = [];
  rows.forEach((row, index) => {
    const last = runs[runs.length - 1];
    if (last && last.type === row.questionType) last.to = index + 1;
    else runs.push({ type: row.questionType, from: index + 1, to: index + 1 });
  });

  let runIndex = 0;
  rows.forEach((row, index) => {
    const run = runs[runIndex];
    if (run && index + 1 === run.from) {
      const range =
        run.to === run.from
          ? `Question ${run.from}`
          : `Questions ${run.from}-${run.to}`;
      drawSectionHeading(
        pen,
        LETTERS[runIndex] ?? LETTERS[0],
        TYPE_LABEL[run.type],
        `${range} - ${plural(run.to - run.from + 1, "question")}`,
        runningHeader,
      );
      runIndex += 1;
    }
    drawQuestionCard(pen, index + 1, rows.length, chipSide, row, runningHeader);
  });

  // Answer key: filled column by column, in question order, over as many
  // pages as the entries need.
  const columnWidth = (CONTENT_WIDTH - 26) / 2;
  const key = newPage(doc, { runningHeader: "Answer key" });
  let keyPage = key.page;
  let columnTop = drawKeyBand(
    keyPage,
    "Correct answers, each with the reasoning behind it.",
    plural(rows.length, "answer"),
  );
  let column = 0;
  let y = columnTop;
  rows.forEach((row, index) => {
    const metrics = measureKeyEntry(row, columnWidth);
    if (y - metrics.height < FLOOR) {
      if (column === 1) {
        const next = newPage(doc, { runningHeader: "Answer key" });
        keyPage = next.page;
        columnTop = next.top;
        column = 0;
      } else {
        column = 1;
      }
      y = columnTop;
    }
    y = drawKeyEntry(
      keyPage,
      y,
      index + 1,
      MARGIN + column * (columnWidth + 26),
      columnWidth,
      metrics,
    );
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
