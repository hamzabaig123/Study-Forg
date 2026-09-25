import { QuestionRenderer } from "@/components/session/QuestionRenderer";
import { SessionSetupDialog } from "@/components/session/SessionSetupDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  useChapters,
  useClasses,
  useSubjects,
  useTopics,
} from "@/hooks/useContent";
import {
  useCompleteSession,
  useSession,
  useStartSession,
  useSubmitAnswer,
} from "@/hooks/useSessions";
import { cn } from "@/lib/utils";
import {
  type AnswerFeedback,
  type Id,
  type QuestionType,
  SessionMode,
  type SessionScope,
  type SubmittedAnswer,
} from "@/types";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowRight, Check, Lightbulb, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const MARKER = "practice";

/** Parse a route param into a bigint id. */
function parseId(value: unknown): Id | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/**
 * Practice flow: questions one at a time with immediate feedback per question
 * (correct/incorrect, the correct answer, and the explanation) and a
 * next-question action. Finishes by handing off to the results summary.
 */
export default function PracticeSession() {
  const params = useParams({ strict: false }) as { sessionId?: string };
  const navigate = useNavigate();

  const sessionId = parseId(params.sessionId);

  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<SubmittedAnswer | null>(null);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const sessionQuery = useSession(sessionId);
  const startSession = useStartSession();
  const submitAnswer = useSubmitAnswer();
  const completeSession = useCompleteSession();

  const session = sessionQuery.data ?? null;
  const questions = session?.questions ?? [];
  const current = questions[index] ?? null;
  const isLast = index >= questions.length - 1;

  /* Scope options for the setup dialog. */
  const classesQuery = useClasses();
  const firstClassId = classesQuery.data?.[0]?.id ?? null;
  const subjectsQuery = useSubjects(firstClassId);
  const firstSubjectId = subjectsQuery.data?.[0]?.id ?? null;
  const chaptersQuery = useChapters(firstSubjectId);
  const firstChapterId = chaptersQuery.data?.[0]?.id ?? null;
  const topicsQuery = useTopics(firstChapterId);

  const scopeOptions = useMemo(() => {
    const options: Array<{
      key: string;
      label: string;
      hint?: string;
      scope: SessionScope;
    }> = [];
    for (const topic of topicsQuery.data ?? []) {
      options.push({
        key: `topic:${topic.id.toString()}`,
        label: topic.name,
        hint: `${topic.questionCount.toString()} questions`,
        scope: { __kind__: "topic", topic: topic.id },
      });
    }
    for (const chapter of chaptersQuery.data ?? []) {
      options.push({
        key: `chapter:${chapter.id.toString()}`,
        label: chapter.name,
        hint: "Chapter",
        scope: { __kind__: "chapter", chapter: chapter.id },
      });
    }
    return options;
  }, [topicsQuery.data, chaptersQuery.data]);

  /* Open the setup dialog when no session is in flight. */
  useEffect(() => {
    if (!sessionId) setSetupOpen(true);
  }, [sessionId]);

  const handleStart = useCallback(
    (result: {
      scope: SessionScope;
      mode: SessionMode;
      questionCount?: bigint;
      durationSeconds?: bigint;
    }) => {
      setSetupError(null);
      startSession.mutate(
        {
          scope: result.scope,
          mode: SessionMode.practice,
          questionCount: result.questionCount,
        },
        {
          onSuccess: (response) => {
            if (response.__kind__ === "ok") {
              setIndex(0);
              setDraft(null);
              setFeedback(null);
              setSetupOpen(false);
              void navigate({
                to: "/practice/$sessionId",
                params: { sessionId: response.ok.id.toString() },
              });
            } else {
              setSetupError(
                response.err.__kind__ === "noQuestions"
                  ? "That topic has no questions yet. Add a few first."
                  : "Could not start the session. Please try again.",
              );
            }
          },
          onError: () => {
            setSetupError("Could not start the session. Please try again.");
          },
        },
      );
    },
    [navigate, startSession],
  );

  const handleSubmitAnswer = useCallback(() => {
    if (!session || !current || !draft) return;
    submitAnswer.mutate(
      { sessionId: session.id, questionId: current.id, answer: draft },
      {
        onSuccess: (response) => {
          if (response.__kind__ === "ok") setFeedback(response.ok);
        },
      },
    );
  }, [current, draft, session, submitAnswer]);

  const handleNext = useCallback(() => {
    if (!session) return;
    if (isLast) {
      completeSession.mutate(session.id, {
        onSuccess: (response) => {
          if (response.__kind__ === "ok") {
            void navigate({
              to: "/results/$sessionId",
              params: { sessionId: session.id.toString() },
            });
          }
        },
      });
      return;
    }
    setIndex((current) => current + 1);
    setDraft(null);
    setFeedback(null);
  }, [completeSession, isLast, navigate, session]);

  /* ---------------------------------------------------------------------- */
  /* Loading / error / empty states                                          */
  /* ---------------------------------------------------------------------- */

  if (sessionId && sessionQuery.isLoading) {
    return (
      <div
        data-ocid={`${MARKER}.loading_state`}
        className="mx-auto w-full max-w-3xl px-4 py-10"
      >
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (sessionId && !sessionQuery.isLoading && !session) {
    return (
      <div
        data-ocid={`${MARKER}.error_state`}
        className="mx-auto w-full max-w-3xl px-4 py-16 text-center"
      >
        <h1 className="font-display text-2xl font-semibold">
          This session is no longer available
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          It may have been completed already. Start a fresh practice run.
        </p>
        <Button
          type="button"
          className="mt-6"
          data-ocid={`${MARKER}.retry_button`}
          onClick={() => setSetupOpen(true)}
        >
          <RotateCcw className="size-4" /> Start a new session
        </Button>
        <SessionSetupDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          options={scopeOptions}
          initialMode={SessionMode.practice}
          pending={startSession.isPending}
          errorMessage={setupError}
          onStart={handleStart}
          marker="session_setup"
        />
      </div>
    );
  }

  if (!session || !current) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-semibold">
          Ready to practice?
        </h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
          Choose a topic or chapter and work through questions with instant
          feedback and explanations.
        </p>
        <Button
          type="button"
          className="mt-6 bg-gradient-primary text-primary-foreground hover:opacity-90"
          data-ocid={`${MARKER}.open_modal_button`}
          onClick={() => setSetupOpen(true)}
        >
          Start practice
        </Button>
        <SessionSetupDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          options={scopeOptions}
          initialMode={SessionMode.practice}
          pending={startSession.isPending}
          errorMessage={setupError}
          onStart={handleStart}
          marker="session_setup"
        />
      </div>
    );
  }

  const answered = feedback !== null;
  const canSubmit = draft !== null && !submitAnswer.isPending;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            Practice
          </p>
          <h1 className="font-display truncate text-xl font-semibold">
            {session.scopeLabel}
          </h1>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-ocid={`${MARKER}.secondary_button`}
          onClick={() => setSetupOpen(true)}
        >
          New session
        </Button>
      </header>

      <Card className="surface-glass shadow-elevated">
        <CardContent className="pt-6">
          <QuestionRenderer
            prompt={current.prompt}
            questionType={current.questionType}
            options={current.options}
            index={index + 1}
            total={questions.length}
            value={draft}
            onChange={setDraft}
            disabled={answered}
            marker={MARKER}
          />

          {answered && feedback ? (
            <div
              data-ocid={`${MARKER}.feedback`}
              className={cn(
                "animate-fade-up mt-6 rounded-lg border p-4",
                feedback.correct
                  ? "border-success/40 bg-success/10"
                  : "border-destructive/40 bg-destructive/10",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full",
                    feedback.correct
                      ? "bg-success/20 text-success"
                      : "bg-destructive/20 text-destructive",
                  )}
                  aria-hidden="true"
                >
                  {feedback.correct ? (
                    <Check className="size-3.5" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                </span>
                <p
                  data-ocid={`${MARKER}.feedback_result`}
                  className={cn(
                    "text-sm font-semibold",
                    feedback.correct ? "text-success" : "text-destructive",
                  )}
                >
                  {feedback.correct ? "Correct" : "Not quite"}
                </p>
              </div>

              {!feedback.correct ? (
                <p className="mt-3 text-sm">
                  <span className="text-muted-foreground font-medium">
                    Correct answer:{" "}
                  </span>
                  <span className="font-medium">
                    {describeCorrectAnswer(feedback)}
                  </span>
                </p>
              ) : null}

              {feedback.explanation ? (
                <div className="mt-3 flex gap-2 border-t border-border/60 pt-3">
                  <Lightbulb
                    className="text-primary mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <p className="text-sm leading-relaxed break-words">
                    {feedback.explanation}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-3">
            {!answered ? (
              <Button
                type="button"
                data-ocid={`${MARKER}.submit_button`}
                disabled={!canSubmit}
                onClick={handleSubmitAnswer}
                className="bg-gradient-primary text-primary-foreground hover:opacity-90"
              >
                {submitAnswer.isPending ? "Checking…" : "Check answer"}
              </Button>
            ) : (
              <Button
                type="button"
                data-ocid={`${MARKER}.primary_button`}
                disabled={completeSession.isPending}
                onClick={handleNext}
              >
                {completeSession.isPending
                  ? "Finishing…"
                  : isLast
                    ? "See results"
                    : "Next question"}
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-4 text-center text-xs">
        Prefer a challenge?{" "}
        <Link
          to="/test/$sessionId"
          params={{ sessionId: session.id.toString() }}
          data-ocid={`${MARKER}.link`}
          className="text-accent underline-offset-4 hover:underline"
        >
          Take a timed test
        </Link>
      </p>

      <SessionSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        options={scopeOptions}
        initialMode={SessionMode.practice}
        pending={startSession.isPending}
        errorMessage={setupError}
        onStart={handleStart}
        marker="session_setup"
      />
    </div>
  );
}

/** Render the correct answer for the feedback panel. */
function describeCorrectAnswer(feedback: AnswerFeedback): string {
  const answer = feedback.correctAnswer;
  if (answer.__kind__ === "trueFalse") {
    return answer.trueFalse.correct ? "True" : "False";
  }
  if (answer.__kind__ === "shortAnswer") {
    return answer.shortAnswer.expected;
  }
  const correct = answer.multipleChoice.options.find(
    (option) => option.id === answer.multipleChoice.correctOptionId,
  );
  return correct?.text ?? "—";
}
