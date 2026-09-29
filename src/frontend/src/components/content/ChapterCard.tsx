import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { ChapterSummary } from "@/types";
import { Link } from "@tanstack/react-router";
import { FileText, Pencil, Trash2 } from "lucide-react";

interface ChapterCardProps {
  chapter: ChapterSummary;
  index: number;
  onRename: (chapter: ChapterSummary) => void;
  onDelete: (chapter: ChapterSummary) => void;
}

export function ChapterCard({
  chapter,
  index,
  onRename,
  onDelete,
}: ChapterCardProps) {
  return (
    <Card
      data-ocid={`chapters.item.${index}`}
      className="group relative gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none transition-smooth hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className="bg-gradient-primary absolute inset-x-0 top-0 h-1"
      />
      <Link
        to="/chapters/$chapterId"
        params={{ chapterId: chapter.id.toString() }}
        data-ocid={`chapters.link.${index}`}
        className="flex flex-1 flex-col gap-3 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg leading-snug font-semibold text-foreground">
            {chapter.name}
          </h2>
          <span className="text-muted-foreground numeric shrink-0 text-xs">
            {formatCount(chapter.topicCount)}{" "}
            {chapter.topicCount === 1n ? "topic" : "topics"}
          </span>
        </div>
        <p className="text-muted-foreground line-clamp-2 min-h-[2.5rem] text-sm">
          {chapter.description?.trim() ||
            "No description yet — open to add topics and questions."}
        </p>
        <span className="text-accent inline-flex items-center gap-1.5 text-xs font-medium">
          <FileText className="size-3.5" aria-hidden="true" />
          Open chapter
        </span>
      </Link>
      <div className="border-border/60 flex items-center justify-end gap-1 border-t px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid={`chapters.edit_button.${index}`}
          onClick={() => onRename(chapter)}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          Rename
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid={`chapters.delete_button.${index}`}
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(chapter)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Delete
        </Button>
      </div>
    </Card>
  );
}
