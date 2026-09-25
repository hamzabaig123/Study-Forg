import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { type Id, SessionMode, type SessionScope } from "@/types";
import { Clock, ListChecks, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface SessionSetupResult {
  scope: SessionScope;
  mode: SessionMode;
  questionCount?: bigint;
  durationSeconds?: bigint;
}

interface ScopeOption {
  /** Stable key, e.g. `topic:12`. */
  key: string;
  label: string;
  /** Secondary line, e.g. the parent chapter name. */
  hint?: string;
  scope: SessionScope;
}

interface SessionSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Topics and chapters the learner can start a session on. */
  options: ScopeOption[];
  /** Pre-selected scope key. */
  initialScopeKey?: string;
  /** Pre-selected mode. */
  initialMode?: SessionMode;
  pending?: boolean;
  errorMessage?: string | null;
  onStart: (result: SessionSetupResult) => void;
  /** Deterministic-test marker prefix, e.g. `session_setup`. */
  marker: string;
}

const COUNT_PRESETS = [5, 10, 15, 20];
const DURATION_PRESETS = [5, 10, 15, 30];

/**
 * Dialog to start a session on a topic or chapter, choosing practice or timed
 * test, and — for timed tests — the question count and duration.
 */
export function SessionSetupDialog({
  open,
  onOpenChange,
  options,
  initialScopeKey,
  initialMode = SessionMode.practice,
  pending = false,
  errorMessage,
  onStart,
  marker,
}: SessionSetupDialogProps) {
  const [scopeKey, setScopeKey] = useState<string>("");
  const [mode, setMode] = useState<SessionMode>(initialMode);
  const [questionCount, setQuestionCount] = useState(10);
  const [durationMinutes, setDurationMinutes] = useState(10);

  useEffect(() => {
    if (!open) return;
    setScopeKey(initialScopeKey ?? options[0]?.key ?? "");
    setMode(initialMode);
    setQuestionCount(10);
    setDurationMinutes(10);
  }, [open, initialScopeKey, initialMode, options]);

  const selected = useMemo(
    () => options.find((option) => option.key === scopeKey) ?? null,
    [options, scopeKey],
  );

  const isTimed = mode === SessionMode.timedTest;
  const canStart = !!selected && !pending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || pending) return;
    onStart({
      scope: selected.scope,
      mode,
      questionCount: isTimed ? BigInt(questionCount) : undefined,
      durationSeconds: isTimed ? BigInt(durationMinutes * 60) : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-ocid={`${marker}.dialog`}
        className="surface-glass sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Start a session
          </DialogTitle>
          <DialogDescription>
            Pick what to study, then choose a relaxed practice run or a timed
            test.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor={`${marker}-scope`}>Topic or chapter</Label>
            {options.length === 0 ? (
              <p
                data-ocid={`${marker}.empty_state`}
                className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-sm"
              >
                No topics with questions yet. Add questions to a topic first.
              </p>
            ) : (
              <Select value={scopeKey} onValueChange={setScopeKey}>
                <SelectTrigger
                  id={`${marker}-scope`}
                  data-ocid={`${marker}.select`}
                  className="w-full"
                >
                  <SelectValue placeholder="Choose a topic or chapter" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                      {option.hint ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {option.hint}
                        </span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Mode</legend>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <ModeCard
                selected={mode === SessionMode.practice}
                onSelect={() => setMode(SessionMode.practice)}
                icon={<Sparkles className="size-4" />}
                title="Practice"
                description="Instant feedback and explanations after every question."
                marker={`${marker}.mode.practice`}
              />
              <ModeCard
                selected={mode === SessionMode.timedTest}
                onSelect={() => setMode(SessionMode.timedTest)}
                icon={<Clock className="size-4" />}
                title="Timed test"
                description="A countdown runs and the test submits automatically."
                marker={`${marker}.mode.timed`}
              />
            </div>
          </fieldset>

          {isTimed ? (
            <div className="animate-fade-in grid gap-5 rounded-lg border bg-muted/40 p-4">
              <div className="grid gap-2">
                <Label htmlFor={`${marker}-count`}>
                  <ListChecks className="size-3.5" /> Questions
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  {COUNT_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={questionCount === preset ? "default" : "outline"}
                      data-ocid={`${marker}.count.${preset}`}
                      onClick={() => setQuestionCount(preset)}
                    >
                      {preset}
                    </Button>
                  ))}
                  <Input
                    id={`${marker}-count`}
                    data-ocid={`${marker}.count_input`}
                    type="number"
                    min={1}
                    max={50}
                    value={questionCount}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setQuestionCount(
                        Number.isFinite(next)
                          ? Math.min(50, Math.max(1, Math.round(next)))
                          : 1,
                      );
                    }}
                    className="numeric h-8 w-20"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`${marker}-duration`}>
                  <Clock className="size-3.5" /> Duration (minutes)
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  {DURATION_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={
                        durationMinutes === preset ? "default" : "outline"
                      }
                      data-ocid={`${marker}.duration.${preset}`}
                      onClick={() => setDurationMinutes(preset)}
                    >
                      {preset}m
                    </Button>
                  ))}
                  <Input
                    id={`${marker}-duration`}
                    data-ocid={`${marker}.duration_input`}
                    type="number"
                    min={1}
                    max={120}
                    value={durationMinutes}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setDurationMinutes(
                        Number.isFinite(next)
                          ? Math.min(120, Math.max(1, Math.round(next)))
                          : 1,
                      );
                    }}
                    className="numeric h-8 w-20"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <p
              data-ocid={`${marker}.error_state`}
              className="text-destructive text-sm"
            >
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-ocid={`${marker}.cancel_button`}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-ocid={`${marker}.submit_button`}
              disabled={!canStart}
              className="bg-gradient-primary text-primary-foreground hover:opacity-90"
            >
              {pending
                ? "Preparing…"
                : isTimed
                  ? "Start timed test"
                  : "Start practice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ModeCardProps {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  marker: string;
}

function ModeCard({
  selected,
  onSelect,
  icon,
  title,
  description,
  marker,
}: ModeCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-ocid={marker}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-smooth",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected
          ? "border-primary bg-primary/10 shadow-subtle"
          : "border-border bg-card hover:border-primary/50",
      )}
    >
      <span
        className={cn(
          "flex items-center gap-2 text-sm font-semibold",
          selected ? "text-primary" : "text-foreground",
        )}
      >
        {icon}
        {title}
      </span>
      <span className="text-muted-foreground text-xs leading-relaxed">
        {description}
      </span>
    </button>
  );
}

export type { ScopeOption };
