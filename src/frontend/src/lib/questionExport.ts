/**
 * Question exports, shared by the localStorage mock and the Supabase adapter.
 *
 * Both backends end every `exportContent` call through the same two writers, so
 * the CSV/PDF byte output is a property of the app rather than of whichever
 * store answered. A cutover must not change what a downloaded file looks like,
 * which is why these functions are exported rather than duplicated per backend.
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
  return `"${value.replace(/\r?\n/gu, " ").replace(/"/gu, '""')}"`;
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

const PDF_LINE_LIMIT = 92;
const PDF_PAGE_HEIGHT = 46;

function pdfText(value: string): string {
  const ascii = value
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, "-")
    .replace(/\u2022/gu, "-")
    .replace(/[^\x20-\x7E]/gu, "");
  return ascii
    .replace(/\\/gu, "\\\\")
    .replace(/\(/gu, "\\(")
    .replace(/\)/gu, "\\)");
}

function wrapForPdf(text: string, limit: number): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > limit) {
      if (current.length > 0) {
        lines.push(current);
      }
      current = word.length > limit ? `${word.slice(0, limit - 1)}~` : word;
      continue;
    }
    current = candidate;
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function pdfFile(name: string, rows: ExportableQuestion[]): ExportFile {
  const lines: string[] = [name, ""];
  rows.forEach((row, index) => {
    lines.push(`${index + 1}. [${row.questionType}] ${row.prompt}`);
    if (row.answer.__kind__ === "multipleChoice") {
      row.answer.multipleChoice.options.forEach((option, optionIndex) => {
        lines.push(`     ${optionLetter(optionIndex)}) ${option.text}`);
      });
    }
    lines.push(`     Answer: ${answerSummary(row.answer)}`);
    if (row.explanation) {
      lines.push(`     Why: ${row.explanation}`);
    }
    lines.push("");
  });

  const body = lines.flatMap((line) => wrapForPdf(line, PDF_LINE_LIMIT));
  const pages: string[][] = [];
  for (
    let offset = 0;
    offset < Math.max(body.length, 1);
    offset += PDF_PAGE_HEIGHT
  ) {
    pages.push(body.slice(offset, offset + PDF_PAGE_HEIGHT));
  }

  const objects: string[] = [];
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Count ${String(pages.length)} /Kids [${pageObjectNumbers.map((num) => `${String(num)} 0 R`).join(" ")}] >>`,
  );
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  );
  pages.forEach((pageLines, index) => {
    const contentNumber = pageObjectNumbers[index] + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentNumber)} 0 R >>`,
    );
    const stream = [
      "BT",
      "/F1 9 Tf",
      "12 TL",
      "1 0 0 1 40 800 Tm",
      ...pageLines.map((line) => `(${pdfText(line)}) Tj T*`),
      "ET",
    ].join("\n");
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

  return {
    content: pdf,
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
