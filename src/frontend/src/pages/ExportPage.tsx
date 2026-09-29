import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useChapters,
  useClasses,
  useSubjects,
  useTopics,
} from "@/hooks/useContent";
import { useExportContent } from "@/hooks/useSharing";
import { ExportFormat } from "@/types";
import type { Id } from "@/types";
import { Download, FileDown, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function ExportPage() {
  const classesQuery = useClasses();
  const exportContent = useExportContent();

  const [classId, setClassId] = useState<Id | null>(null);
  const [subjectId, setSubjectId] = useState<Id | null>(null);
  const [chapterId, setChapterId] = useState<Id | null>(null);
  const [topicId, setTopicId] = useState<Id | null>(null);
  const [format, setFormat] = useState<ExportFormat>(ExportFormat.csv);

  const subjectsQuery = useSubjects(classId);
  const chaptersQuery = useChapters(subjectId);
  const topicsQuery = useTopics(chapterId);

  const classes = classesQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const chapters = chaptersQuery.data ?? [];
  const topics = topicsQuery.data ?? [];

  const target = useMemo(() => {
    if (topicId !== null) return { __kind__: "topic" as const, topic: topicId };
    if (chapterId !== null)
      return { __kind__: "chapter" as const, chapter: chapterId };
    return null;
  }, [topicId, chapterId]);

  function handleExport() {
    if (!target) return;
    exportContent.mutate(
      { target, format },
      {
        onSuccess: (result) => {
          if (result.__kind__ === "err") {
            toast.error(
              result.err === "empty"
                ? "There are no questions to export in that selection."
                : "Couldn't export that selection.",
            );
            return;
          }
          const file = result.ok;
          const blob = new Blob([file.content], { type: file.mimeType });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = file.filename;
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          URL.revokeObjectURL(url);
          toast.success(`Downloaded ${file.filename}.`);
        },
        onError: () => toast.error("Couldn't export that selection."),
      },
    );
  }

  return (
    <div data-ocid="export.page" className="space-y-8">
      <PageHeader
        eyebrow="Export"
        title="Download your content"
        description="Export a chapter or a single topic as a file you can print, archive, or hand out."
      />

      <Card className="rounded-lg border-border/70 shadow-none">
        <CardHeader className="border-b border-border/60 px-5 py-4">
          <CardTitle className="font-display text-base font-semibold">
            Choose what to export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 space-y-1.5">
              {/* The combobox trigger cannot name itself from its placeholder, so
                  each Label here is paired to its trigger by id — see SharePage. */}
              <Label
                htmlFor="export-class"
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                Class
              </Label>
              <Select
                value={classId ? classId.toString() : undefined}
                onValueChange={(next) => {
                  setClassId(BigInt(next));
                  setSubjectId(null);
                  setChapterId(null);
                  setTopicId(null);
                }}
              >
                <SelectTrigger
                  id="export-class"
                  className="w-full rounded-lg"
                  data-ocid="export.class_select"
                >
                  <SelectValue placeholder="Select a class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((item) => (
                    <SelectItem
                      key={item.id.toString()}
                      value={item.id.toString()}
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label
                htmlFor="export-subject"
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                Subject
              </Label>
              <Select
                value={subjectId ? subjectId.toString() : undefined}
                disabled={classId === null}
                onValueChange={(next) => {
                  setSubjectId(BigInt(next));
                  setChapterId(null);
                  setTopicId(null);
                }}
              >
                <SelectTrigger
                  id="export-subject"
                  className="w-full rounded-lg"
                  data-ocid="export.subject_select"
                >
                  <SelectValue placeholder="Select a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((item) => (
                    <SelectItem
                      key={item.id.toString()}
                      value={item.id.toString()}
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label
                htmlFor="export-chapter"
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                Chapter
              </Label>
              <Select
                value={chapterId ? chapterId.toString() : undefined}
                disabled={subjectId === null}
                onValueChange={(next) => {
                  setChapterId(BigInt(next));
                  setTopicId(null);
                }}
              >
                <SelectTrigger
                  id="export-chapter"
                  className="w-full rounded-lg"
                  data-ocid="export.chapter_select"
                >
                  <SelectValue placeholder="Select a chapter" />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((item) => (
                    <SelectItem
                      key={item.id.toString()}
                      value={item.id.toString()}
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-1.5">
              <Label
                htmlFor="export-topic"
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                Topic (optional)
              </Label>
              <Select
                value={topicId ? topicId.toString() : undefined}
                disabled={chapterId === null}
                onValueChange={(next) => setTopicId(BigInt(next))}
              >
                <SelectTrigger
                  id="export-topic"
                  className="w-full rounded-lg"
                  data-ocid="export.topic_select"
                >
                  <SelectValue placeholder="Whole chapter" />
                </SelectTrigger>
                <SelectContent>
                  {topics.map((item) => (
                    <SelectItem
                      key={item.id.toString()}
                      value={item.id.toString()}
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label
                htmlFor="export-format"
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                Format
              </Label>
              <Select
                value={format}
                onValueChange={(next) => setFormat(next as ExportFormat)}
              >
                <SelectTrigger
                  id="export-format"
                  className="w-full rounded-lg"
                  data-ocid="export.format_select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ExportFormat.csv}>
                    CSV — spreadsheet
                  </SelectItem>
                  <SelectItem value={ExportFormat.pdf}>
                    PDF — printable
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                className="w-full rounded-full bg-gradient-primary text-primary-foreground sm:w-auto"
                onClick={handleExport}
                disabled={!target || exportContent.isPending}
                data-ocid="export.download_button"
              >
                <Download className="size-4" aria-hidden="true" />
                {exportContent.isPending ? "Preparing…" : "Download file"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {classes.length === 0 && !classesQuery.isLoading ? (
        <EmptyState
          icon={FileText}
          title="Nothing to export yet"
          description="Create a class, add a chapter, and author some questions — then come back to download them."
        />
      ) : (
        <Card className="rounded-lg border-border/70 bg-muted/30 shadow-none">
          <CardContent className="flex items-start gap-3 p-5">
            <FileDown
              className="mt-0.5 size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div>
              <p className="font-display text-base font-semibold text-foreground">
                What's included
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Every question in the selection, with its type, prompt, options,
                correct answer, and explanation. Choose a topic to narrow the
                export, or leave the topic blank to export the whole chapter.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
