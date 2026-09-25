import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type AnswerData,
  type DraftQuestion,
  type Id,
  QuestionType,
} from "@/types";
import { Check, FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type CandidateType = "MCQ" | "SHORT" | "LONG";
type CandidateStatus = "PENDING" | "APPROVED" | "REJECTED" | "IMPORTED";
interface Candidate {
  id: string;
  text: string;
  type: CandidateType;
  options: string[];
  correctIndex: number | null;
  confidence: number;
  sourcePage: number;
  status: CandidateStatus;
}

const optionLine = /^\s*(?:[A-Da-d]|\d+)\s*[.)]\s+(.+)/;
function classify(block: string): CandidateType {
  if (block.split("\n").filter((line) => optionLine.test(line)).length >= 2)
    return "MCQ";
  return /explain|describe|discuss|derive|prove|long question|in detail|\b[5-9]\s*marks?/i.test(
    block,
  )
    ? "LONG"
    : "SHORT";
}
function extract(text: string): Candidate[] {
  const blocks = text
    .replace(/\r/g, "")
    .split(/(?=^\s*(?:q(?:uestion)?\s*)?\d+\s*[.):-])/im)
    .map((item) => item.trim())
    .filter(Boolean);
  return blocks
    .map((block, index) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const options = lines
        .filter((line) => optionLine.test(line))
        .map((line) => line.replace(optionLine, "$1"));
      const stem = lines
        .filter(
          (line) =>
            !optionLine.test(line) &&
            !/^\s*(?:ans(?:wer)?|correct)\s*[:=-]/i.test(line),
        )
        .join(" ")
        .replace(/^(?:q(?:uestion)?\s*)?\d+\s*[.):-]\s*/i, "");
      const answer = block
        .match(/(?:ans(?:wer)?|correct)\s*[:=-]?\s*([A-D])/i)?.[1]
        ?.toUpperCase();
      const type = classify(block);
      return {
        id: `${Date.now()}-${index}`,
        text: stem,
        type,
        options,
        correctIndex: answer ? answer.charCodeAt(0) - 65 : null,
        confidence:
          type === "MCQ" || /define|state|list/i.test(stem) ? 0.92 : 0.68,
        sourcePage: 1,
        status: "PENDING" as CandidateStatus,
      };
    })
    .filter((candidate) => candidate.text.length > 2);
}

export function ExtractionReview({
  topicId,
  onImport,
}: {
  topicId: Id | null;
  onImport: (draft: DraftQuestion) => Promise<unknown>;
}) {
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const counts = useMemo(() => {
    const tally: Record<CandidateStatus, number> = {
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
      IMPORTED: 0,
    };
    for (const candidate of candidates) tally[candidate.status] += 1;
    return tally;
  }, [candidates]);
  async function readFile(file: File) {
    if (
      !/^(text\/|application\/(json|csv))/.test(file.type) &&
      !/\.(txt|md|csv|json)$/i.test(file.name)
    ) {
      toast.error(
        "For this local build, upload a text, Markdown, CSV, or JSON file. PDF/image OCR needs a server OCR provider.",
      );
      return;
    }
    setFileName(file.name);
    setSource(await file.text());
  }
  function runExtraction() {
    const found = extract(source);
    if (!found.length) {
      toast.error(
        "No numbered questions were found. Paste questions beginning with 1., Q1, or Question 1.",
      );
      return;
    }
    setCandidates(found);
    toast.success(`${found.length} candidates ready for review.`);
  }
  function update(id: string, update: Partial<Candidate>) {
    setCandidates((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }
  async function importOne(candidate: Candidate) {
    if (!topicId) {
      toast.error("Choose a topic in the AI draft form before importing.");
      return;
    }
    if (
      candidate.type === "MCQ" &&
      (candidate.options.length < 2 || candidate.correctIndex === null)
    ) {
      toast.error(
        "Set at least two options and the correct answer before importing this MCQ.",
      );
      return;
    }
    setBusy(candidate.id);
    try {
      const options = candidate.options.map((text, index) => ({
        id: BigInt(index + 1),
        text,
      }));
      const answer: AnswerData =
        candidate.type === "MCQ"
          ? {
              __kind__: "multipleChoice",
              multipleChoice: {
                options,
                correctOptionId: BigInt((candidate.correctIndex ?? 0) + 1),
              },
            }
          : { __kind__: "shortAnswer", shortAnswer: { expected: "" } };
      await onImport({
        id: BigInt(Date.now()),
        topicId,
        prompt: candidate.text,
        questionType:
          candidate.type === "MCQ"
            ? QuestionType.multipleChoice
            : QuestionType.shortAnswer,
        answer,
      });
      update(candidate.id, { status: "IMPORTED" });
      toast.success("Added to the question bank.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card className="rounded-xl border-border bg-card p-5 shadow-subtle md:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <FileText className="size-5" />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold">
            AI Studio document review
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Extract every numbered question from pasted text or a text document.
            Nothing reaches the question bank until you approve and import it.
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="source-document">Source text</Label>
          <Textarea
            id="source-document"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            rows={7}
            placeholder="1. What is photosynthesis?\n2. Which gas do plants absorb?\nA) Oxygen\nB) Carbon dioxide\nC) Nitrogen\nD) Hydrogen\nAnswer: B"
          />
        </div>
        <div className="flex flex-col gap-2 lg:w-52">
          <Label htmlFor="source-file">Upload source</Label>
          <Input
            id="source-file"
            type="file"
            accept=".txt,.md,.csv,.json,text/*,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
          {fileName && (
            <p className="text-xs text-muted-foreground">{fileName}</p>
          )}
          <Button
            type="button"
            onClick={runExtraction}
            disabled={!source.trim()}
          >
            <Upload /> Extract questions
          </Button>
        </div>
      </div>
      {candidates.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {counts.PENDING} pending · {counts.APPROVED} approved ·{" "}
              {counts.IMPORTED} imported · {counts.REJECTED} rejected
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCandidates([])}
            >
              <Trash2 /> Clear review
            </Button>
          </div>
          {candidates.map((candidate, index) => (
            <div
              key={candidate.id}
              className="rounded-lg border border-border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                  {candidate.type}
                </span>
                <span
                  className={
                    candidate.confidence < 0.7
                      ? "text-xs text-amber-600"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {Math.round(candidate.confidence * 100)}% confidence
                  {candidate.confidence < 0.7 ? " — check type" : ""}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  Source page {candidate.sourcePage}
                </span>
              </div>
              <Textarea
                className="mt-3"
                value={candidate.text}
                onChange={(event) =>
                  update(candidate.id, { text: event.target.value })
                }
                rows={2}
                disabled={candidate.status === "IMPORTED"}
              />
              {candidate.type === "MCQ" && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {candidate.options.map((option, optionIndex) => (
                    <label
                      key={`${candidate.id}-${optionIndex}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name={`answer-${candidate.id}`}
                        checked={candidate.correctIndex === optionIndex}
                        onChange={() =>
                          update(candidate.id, { correctIndex: optionIndex })
                        }
                        disabled={candidate.status === "IMPORTED"}
                      />
                      <Input
                        value={option}
                        onChange={(event) =>
                          update(candidate.id, {
                            options: candidate.options.map((value, i) =>
                              i === optionIndex ? event.target.value : value,
                            ),
                          })
                        }
                        disabled={candidate.status === "IMPORTED"}
                      />
                    </label>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {candidate.status === "PENDING" && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        update(candidate.id, { status: "APPROVED" })
                      }
                    >
                      <Check /> Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        update(candidate.id, { status: "REJECTED" })
                      }
                    >
                      <X /> Reject
                    </Button>
                  </>
                )}
                {candidate.status === "REJECTED" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => update(candidate.id, { status: "PENDING" })}
                  >
                    Restore
                  </Button>
                )}
                {candidate.status === "APPROVED" && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void importOne(candidate)}
                    disabled={busy === candidate.id}
                  >
                    {busy === candidate.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Check />
                    )}{" "}
                    Import to question bank
                  </Button>
                )}
                {candidate.status === "IMPORTED" && (
                  <span className="text-sm text-success">Imported</span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Candidate {index + 1} · classification is rule-based and always
                editable.
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
