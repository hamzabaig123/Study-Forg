import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { TopicSummary } from "@/types";
import { Link } from "@tanstack/react-router";
import { HelpCircle, Pencil, Trash2 } from "lucide-react";

interface TopicCardProps {
  topic: TopicSummary;
  index: number;
  onRename: (topic: TopicSummary) => void;
  onDelete: (topic: TopicSummary) => void;
}

export function TopicCard({
  topic,
  index,
  onRename,
  onDelete,
}: TopicCardProps) {
  return (
    <Card
      data-ocid={`topics.item.${index}`}
      className="group relative gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none transition-smooth hover:border-primary/40"
    >
      <span
        aria-hidden="true"
        className="bg-gradient-primary absolute inset-x-0 top-0 h-1"
      />
      <Link
        to="/topics/$topicId"
        params={{ topicId: topic.id.toString() }}
        data-ocid={`topics.link.${index}`}
        className="flex flex-1 flex-col gap-3 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg leading-snug font-semibold text-foreground">
            {topic.name}
          </h2>
          <span className="text-muted-foreground numeric shrink-0 text-xs">
            {formatCount(topic.questionCount)}{" "}
            {topic.questionCount === 1n ? "question" : "questions"}
          </span>
        </div>
        <p className="text-muted-foreground line-clamp-2 min-h-[2.5rem] text-sm">
          {topic.description?.trim() ||
            "No description yet — open to author questions."}
        </p>
        <span className="text-accent inline-flex items-center gap-1.5 text-xs font-medium">
          <HelpCircle className="size-3.5" aria-hidden="true" />
          Open topic
        </span>
      </Link>
      <div className="border-border/60 flex items-center justify-end gap-1 border-t px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid={`topics.edit_button.${index}`}
          onClick={() => onRename(topic)}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          Rename
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid={`topics.delete_button.${index}`}
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(topic)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Delete
        </Button>
      </div>
    </Card>
  );
}
