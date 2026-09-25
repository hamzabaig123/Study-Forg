import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { SubjectSummary } from "@/types";
import { Link } from "@tanstack/react-router";
import { BookOpen, Pencil, Trash2 } from "lucide-react";

interface SubjectCardProps {
  subject: SubjectSummary;
  index: number;
  onRename: (subject: SubjectSummary) => void;
  onDelete: (subject: SubjectSummary) => void;
}

export function SubjectCard({
  subject,
  index,
  onRename,
  onDelete,
}: SubjectCardProps) {
  return (
    <Card
      data-ocid={`subjects.item.${index}`}
      className="group relative gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none transition-smooth hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className="bg-gradient-primary absolute inset-x-0 top-0 h-1"
      />
      <Link
        to="/subjects/$subjectId"
        params={{ subjectId: subject.id.toString() }}
        data-ocid={`subjects.link.${index}`}
        className="flex flex-1 flex-col gap-3 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg leading-snug font-semibold text-foreground">
            {subject.name}
          </h3>
          <span className="text-muted-foreground numeric shrink-0 text-xs">
            {formatCount(subject.chapterCount)}{" "}
            {subject.chapterCount === 1n ? "chapter" : "chapters"}
          </span>
        </div>
        <p className="text-muted-foreground line-clamp-2 min-h-[2.5rem] text-sm">
          {subject.description?.trim() ||
            "No description yet — open to add chapters and topics."}
        </p>
        <span className="text-accent inline-flex items-center gap-1.5 text-xs font-medium">
          <BookOpen className="size-3.5" aria-hidden="true" />
          Open subject
        </span>
      </Link>
      <div className="border-border/60 flex items-center justify-end gap-1 border-t px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid={`subjects.edit_button.${index}`}
          onClick={() => onRename(subject)}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          Rename
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid={`subjects.delete_button.${index}`}
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(subject)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Delete
        </Button>
      </div>
    </Card>
  );
}
