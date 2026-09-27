import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
import type { TargetPath } from "@/lib/ai/studioStore";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

interface TargetPickerProps {
  target: TargetPath;
  onChange: (patch: Partial<TargetPath>) => void;
}

function toId(value: string | null): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

interface LevelProps {
  label: string;
  value: string | null;
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
  options: Array<{ id: string; name: string }>;
  onChange: (value: string) => void;
  ocid: string;
}

function Level({
  label,
  value,
  placeholder,
  disabled,
  loading,
  options,
  onChange,
  ocid,
}: LevelProps) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <Select
        // `undefined` puts Radix's Select in uncontrolled mode, so the first
        // pick switches it to controlled and React warns about the change. An
        // empty string is the same "nothing chosen" state, and still renders the
        // placeholder because no option carries that value.
        value={value ?? ""}
        disabled={disabled || loading}
        onValueChange={onChange}
      >
        <SelectTrigger
          className="h-9 w-full bg-background text-sm"
          data-ocid={ocid}
          aria-label={label}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loading ? (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Loading…
        </p>
      ) : null}
    </div>
  );
}

/**
 * Where the queue gets saved. Chosen once for the whole batch: the canister
 * stores a question under a topic, so a draft is only usable once a topic is
 * picked, and picking per card would mean walking this chain for every one.
 */
export function TargetPicker({ target, onChange }: TargetPickerProps) {
  const classesQuery = useClasses();
  const classId = toId(target.classId);
  const subjectsQuery = useSubjects(classId);
  const subjectId = toId(target.subjectId);
  const chaptersQuery = useChapters(subjectId);
  const chapterId = toId(target.chapterId);
  const topicsQuery = useTopics(chapterId);

  const classes = classesQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const chapters = chaptersQuery.data ?? [];
  const topics = topicsQuery.data ?? [];

  const complete = target.topicId !== null;

  return (
    <Card
      data-ocid="ai_studio.target_picker"
      className="rounded-xl border-border bg-card p-5 shadow-subtle"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* No icon in front of the heading: it pushed the text 24px right of the
            four selects below it, which read as a different indent level. */}
        <h2 className="font-display text-base font-semibold text-card-foreground">
          Save questions into
        </h2>
        {complete ? (
          <Badge className="rounded-full bg-success/12 text-success">
            Target ready
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="rounded-full text-amber-700 dark:text-amber-400"
          >
            Pick a topic
          </Badge>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Level
          label="Class"
          ocid="ai_studio.class_select"
          placeholder="Class"
          value={target.classId}
          loading={classesQuery.isFetching}
          options={classes.map((item) => ({
            id: item.id.toString(),
            name: item.name,
          }))}
          onChange={(value) =>
            onChange({
              classId: value,
              subjectId: null,
              chapterId: null,
              topicId: null,
            })
          }
        />
        <Level
          label="Subject"
          ocid="ai_studio.subject_select"
          placeholder="Subject"
          value={target.subjectId}
          disabled={target.classId === null}
          loading={subjectsQuery.isFetching}
          options={subjects.map((item) => ({
            id: item.id.toString(),
            name: item.name,
          }))}
          onChange={(value) =>
            onChange({
              subjectId: value,
              chapterId: null,
              topicId: null,
            })
          }
        />
        <Level
          label="Chapter"
          ocid="ai_studio.chapter_select"
          placeholder="Chapter"
          value={target.chapterId}
          disabled={target.subjectId === null}
          loading={chaptersQuery.isFetching}
          options={chapters.map((item) => ({
            id: item.id.toString(),
            name: item.name,
          }))}
          onChange={(value) => onChange({ chapterId: value, topicId: null })}
        />
        <Level
          label="Topic"
          ocid="ai_studio.topic_select"
          placeholder="Topic"
          value={target.topicId}
          disabled={target.chapterId === null}
          loading={topicsQuery.isFetching}
          options={topics.map((item) => ({
            id: item.id.toString(),
            name: item.name,
          }))}
          onChange={(value) => onChange({ topicId: value })}
        />
      </div>

      {classesQuery.isSuccess && classes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          There are no classes yet.{" "}
          <Link
            to="/classes"
            className="text-primary hover:underline"
            data-ocid="ai_studio.create_class_link"
          >
            Create a class
          </Link>{" "}
          with a subject, chapter and topic first — questions are stored under a
          topic.
        </p>
      ) : null}
    </Card>
  );
}
