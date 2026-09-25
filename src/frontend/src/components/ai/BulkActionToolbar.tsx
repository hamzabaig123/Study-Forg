import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ExtractionItem,
  useAiExtractionStore,
} from "@/hooks/useAiExtractionStore";
import {
  useChapters,
  useClasses,
  useSubjects,
  useTopics,
} from "@/hooks/useContent";
import type { Id } from "@/types";
import {
  CheckCheck,
  FolderTree,
  Loader2,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface BulkActionToolbarProps {
  onImportAllApproved: () => Promise<void>;
  isImportingAll?: boolean;
}

export function BulkActionToolbar({
  onImportAllApproved,
  isImportingAll = false,
}: BulkActionToolbarProps) {
  const {
    items,
    bulkApprove,
    bulkReject,
    bulkAssign,
    clearQueue,
    defaultClassId,
    defaultSubjectId,
    defaultChapterId,
    defaultTopicId,
    setDefaultHierarchy,
  } = useAiExtractionStore();

  const [bulkClassId, setBulkClassId] = useState<string | null>(defaultClassId);
  const [bulkSubjectId, setBulkSubjectId] = useState<string | null>(
    defaultSubjectId,
  );
  const [bulkChapterId, setBulkChapterId] = useState<string | null>(
    defaultChapterId,
  );
  const [bulkTopicId, setBulkTopicId] = useState<string | null>(defaultTopicId);

  const classesQuery = useClasses();
  const selectedClassId = bulkClassId ? BigInt(bulkClassId) : null;
  const subjectsQuery = useSubjects(selectedClassId);
  const selectedSubjectId = bulkSubjectId ? BigInt(bulkSubjectId) : null;
  const chaptersQuery = useChapters(selectedSubjectId);
  const selectedChapterId = bulkChapterId ? BigInt(bulkChapterId) : null;
  const topicsQuery = useTopics(selectedChapterId);

  const classes = classesQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const chapters = chaptersQuery.data ?? [];
  const topics = topicsQuery.data ?? [];

  const counts = items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { pending: 0, approved: 0, rejected: 0, imported: 0 } as Record<
      ExtractionItem["status"],
      number
    >,
  );

  const handleApplyBulkAssignment = () => {
    if (!bulkTopicId) {
      toast.error(
        "Select at least a Class, Subject, Chapter, and Topic to assign to all.",
      );
      return;
    }
    bulkAssign({
      classId: bulkClassId,
      subjectId: bulkSubjectId,
      chapterId: bulkChapterId,
      topicId: bulkTopicId,
    });
    setDefaultHierarchy({
      classId: bulkClassId,
      subjectId: bulkSubjectId,
      chapterId: bulkChapterId,
      topicId: bulkTopicId,
    });
    toast.success("Assigned hierarchy to all questions in the queue.");
  };

  return (
    <Card className="space-y-4 rounded-xl border-border bg-card p-4 shadow-subtle sm:p-5">
      {/* Stat Bar & Quick Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="numeric rounded-full text-xs">
            {items.length} Total
          </Badge>
          <Badge
            variant="secondary"
            className="numeric rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs"
          >
            {counts.pending} Pending
          </Badge>
          <Badge
            variant="secondary"
            className="numeric rounded-full bg-primary/10 text-primary text-xs font-semibold"
          >
            {counts.approved} Approved
          </Badge>
          {counts.imported > 0 && (
            <Badge
              variant="secondary"
              className="numeric rounded-full bg-emerald-500/10 text-emerald-600 text-xs"
            >
              {counts.imported} Saved
            </Badge>
          )}
          {counts.rejected > 0 && (
            <Badge
              variant="secondary"
              className="numeric rounded-full bg-muted text-muted-foreground text-xs"
            >
              {counts.rejected} Rejected
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={bulkApprove}
            disabled={counts.pending === 0}
            className="h-8 rounded-lg text-xs"
          >
            <CheckCheck className="mr-1.5 size-3.5 text-primary" />
            Approve All Pending
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={bulkReject}
            disabled={counts.pending === 0}
            className="h-8 rounded-lg text-xs text-muted-foreground hover:text-destructive"
          >
            <XCircle className="mr-1.5 size-3.5" />
            Reject All Pending
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearQueue}
            className="h-8 rounded-lg text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Clear Queue
          </Button>
        </div>
      </div>

      {/* Bulk Assignment Bar */}
      <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <FolderTree className="size-3.5 text-primary" />
            Set target for all items:
          </span>

          {/* Class */}
          <Select
            value={bulkClassId || undefined}
            onValueChange={(val) => {
              setBulkClassId(val);
              setBulkSubjectId(null);
              setBulkChapterId(null);
              setBulkTopicId(null);
            }}
          >
            <SelectTrigger className="h-8 w-28 text-xs bg-background">
              <SelectValue placeholder="Class..." />
            </SelectTrigger>
            <SelectContent>
              {classes.map((cls) => (
                <SelectItem key={cls.id.toString()} value={cls.id.toString()}>
                  {cls.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Subject */}
          <Select
            value={bulkSubjectId || undefined}
            disabled={!selectedClassId}
            onValueChange={(val) => {
              setBulkSubjectId(val);
              setBulkChapterId(null);
              setBulkTopicId(null);
            }}
          >
            <SelectTrigger className="h-8 w-28 text-xs bg-background">
              <SelectValue placeholder="Subject..." />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((sub) => (
                <SelectItem key={sub.id.toString()} value={sub.id.toString()}>
                  {sub.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Chapter */}
          <Select
            value={bulkChapterId || undefined}
            disabled={!selectedSubjectId}
            onValueChange={(val) => {
              setBulkChapterId(val);
              setBulkTopicId(null);
            }}
          >
            <SelectTrigger className="h-8 w-28 text-xs bg-background">
              <SelectValue placeholder="Chapter..." />
            </SelectTrigger>
            <SelectContent>
              {chapters.map((ch) => (
                <SelectItem key={ch.id.toString()} value={ch.id.toString()}>
                  {ch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Topic */}
          <Select
            value={bulkTopicId || undefined}
            disabled={!selectedChapterId}
            onValueChange={(val) => setBulkTopicId(val)}
          >
            <SelectTrigger className="h-8 w-32 text-xs font-medium bg-background">
              <SelectValue placeholder="Topic..." />
            </SelectTrigger>
            <SelectContent>
              {topics.map((top) => (
                <SelectItem key={top.id.toString()} value={top.id.toString()}>
                  {top.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleApplyBulkAssignment}
            disabled={!bulkTopicId}
            className="h-8 rounded-lg text-xs"
          >
            Apply to All
          </Button>
        </div>

        {/* Primary CTA: Import All Approved */}
        <Button
          type="button"
          disabled={isImportingAll || counts.approved === 0}
          onClick={onImportAllApproved}
          className="h-9 shrink-0 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-subtle transition-smooth hover:shadow-elevated"
        >
          {isImportingAll ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Importing Questions...
            </>
          ) : (
            <>
              <Upload className="mr-2 size-4" />
              Save {counts.approved} Approved to Question Bank
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
