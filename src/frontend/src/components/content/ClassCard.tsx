import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { ClassSummary } from "@/types";
import { Link } from "@tanstack/react-router";
import { Layers, Pencil, Trash2 } from "lucide-react";

interface ClassCardProps {
  classSummary: ClassSummary;
  index: number;
  onRename: (classSummary: ClassSummary) => void;
  onDelete: (classSummary: ClassSummary) => void;
}

export function ClassCard({
  classSummary,
  index,
  onRename,
  onDelete,
}: ClassCardProps) {
  return (
    <Card
      data-ocid={`classes.item.${index}`}
      className="group relative gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none transition-smooth hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className="bg-gradient-primary absolute inset-x-0 top-0 h-1"
      />
      <Link
        to="/classes/$classId"
        params={{ classId: classSummary.id.toString() }}
        data-ocid={`classes.link.${index}`}
        className="flex flex-1 flex-col gap-3 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg leading-snug font-semibold text-foreground">
            {classSummary.name}
          </h2>
          <span className="text-muted-foreground numeric shrink-0 text-xs">
            {formatCount(classSummary.subjectCount)}{" "}
            {classSummary.subjectCount === 1n ? "subject" : "subjects"}
          </span>
        </div>
        <p className="text-muted-foreground line-clamp-2 min-h-[2.5rem] text-sm">
          {classSummary.description?.trim() ||
            "No description yet — open to add subjects and chapters."}
        </p>
        <span className="text-accent inline-flex items-center gap-1.5 text-xs font-medium">
          <Layers className="size-3.5" aria-hidden="true" />
          Open class
        </span>
      </Link>
      <div className="border-border/60 flex items-center justify-end gap-1 border-t px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid={`classes.edit_button.${index}`}
          onClick={() => onRename(classSummary)}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          Rename
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid={`classes.delete_button.${index}`}
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(classSummary)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Delete
        </Button>
      </div>
    </Card>
  );
}
