import { CountdownTimer } from "@/components/session/CountdownTimer";
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
  type Id,
  SessionMode,
  type SessionScope,
  type SubmittedAnswer,
} from "@/types";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Flag, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MARKER = "timed";

function parseId(value: unknown): Id | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/**
 * Timed test flow: the question, a visible countdown, and the answer controls.
 * The test auto-submits when the timer expires and then shows the results.
 */
export default function TimedTest() {
  const params = useParams({ strict: false }) as { sessionId?: string };
  const navigate = useNavigate();

  const sessionId = parseId(params.sessionId);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, SubmittedAnswer>>({});
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const sessionQuery = useSession(sessionId);
  const startSession = useStartSession();
  const submitAnswer = useSubmitAnswer();
  const completeSession = useCompleteSession();

  const session = sessionQuery.data ?? null;
  const questions = session?.questions ?? [];
  const current = questions[index] ?? null;
  const isLast = index >= questions.length - 1;

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
          mode: SessionMode.timedTest,
          questionCount: result.questionCount,
          durationSeconds: result.durationSeconds,
        },
        {
          onSuccess: (response) => {
            if (response.__kind__ === "ok") {
              setIndex(0);
              setAnswers({});
              setExpired(false);
              submittedRef.current = false;
              setSetupOpen(false);
              void navigate({
                to: "/test/$sessionId",
                params: { sessionId: response.ok.id.toString() },
              });
            } else {
              setSetupError(
                response.err.__kind__ === "noQuestions"
                  ? "That topic has no questions yet. Add a few first."
                  : "Could not start the test. Please try again.",
              );
            }
          },
          onError: () => {
            setSetupError("Could not start the test. Please try again.");
          },
        },
      );
    },
    [navigate, startSession],
  );

  /** Record every answer with the backend, then complete the session. */
  const finishTest = useCallback(
    async (finalAnswers: Record<string, SubmittedAnswer>) => {
      if (!session || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitError(null);

      let failed = 0;
      for (const question of session.questions) {
        const answer = finalAnswers[question.id.toString()];
        if (!answer) continue;
        try {
          const response = await submitAnswer.mutateAsync({
            sessionId: session.id,
            questionId: question.id,
            answer,
          });
          if (response.__kind__ === "err") failed += 1;
        } catch {
          failed += 1;
        }
      }

      if (failed > 0) {
        // Completing now would grade the session without the answers that
        // failed to record, producing a wrong score. Let the user retry.
        submittedRef.current = false;
        setSubmitError(
          failed === 1
            ? "One answer couldn't be saved. Check your connection and submit again."
            : `${failed} answers couldn't be saved. Check your connection and submit again.`,
        );
        return;
      }

      completeSession.mutate(session.id, {
        onSuccess: (response) => {
          if (response.__kind__ === "ok") {
            void navigate({
              to: "/results/$sessionId",
              params: { sessionId: session.id.toString() },
            });
          } else {
            submittedRef.current = false;
            setSubmitError("Couldn't finish the test. Please try again.");
          }
        },
        onError: () => {
          submittedRef.current = false;
          setSubmitError("Couldn't finish the test. Please try again.");
        },
      });
    },
    [completeSession, navigate, session, submitAnswer],
  );

  const handleExpire = useCallback(() => {
    setExpired(true);
    void finishTest(answers);
  }, [answers, finishTest]);

  const handleManualSubmit = useCallback(() => {
    void finishTest(answers);
  }, [answers, finishTest]);

  const setAnswer = useCallback(
    (answer: SubmittedAnswer) => {
      if (!current) return;
      setAnswers((prev) => ({ ...prev, [current.id.toString()]: answer }));
    },
    [current],
  );

  const answeredCount = Object.keys(answers).length;

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
          This test is no longer available
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          It may have been submitted already. Start a fresh timed test.
        </p>
        <Button
          type="button"
          className="mt-6"
          data-ocid={`${MARKER}.retry_button`}
          onClick={() => setSetupOpen(true)}
        >
          <RotateCcw className="size-4" /> Start a new test
        </Button>
        <SessionSetupDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          options={scopeOptions}
          initialMode={SessionMode.timedTest}
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
          Take a timed test
        </h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
          Set a question count and a duration. A countdown runs while you work,
          and the test submits itself when time runs out.
        </p>
        <Button
          type="button"
          className="mt-6 bg-gradient-primary text-primary-foreground hover:opacity-90"
          data-ocid={`${MARKER}.open_modal_button`}
          onClick={() => setSetupOpen(true)}
        >
          Configure test
        </Button>
        <SessionSetupDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          options={scopeOptions}
          initialMode={SessionMode.timedTest}
          pending={startSession.isPending}
          errorMessage={setupError}
          onStart={handleStart}
          marker="session_setup"
        />
      </div>
    );
  }

  const durationSeconds = Number(session.durationSeconds ?? 0n);
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - Number(session.startedAt / 1_000_000n)) / 1000),
  );
  const isSubmitting = completeSession.isPending || expired;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            Timed test
          </p>
          <h1 className="font-display truncate text-xl font-semibold">
            {session.scopeLabel}
          </h1>
          <p className="text-muted-foreground numeric mt-1 text-xs">
            {answeredCount} of {questions.length} answered
          </p>
        </div>
        {durationSeconds > 0 ? (
          <CountdownTimer
            durationSeconds={durationSeconds}
            initialElapsedSeconds={elapsedSeconds}
            onExpire={handleExpire}
            paused={isSubmitting}
            marker={MARKER}
          />
        ) : null}
      </header>

      {expired ? (
        <div
          data-ocid={`${MARKER}.expired_state`}
          className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
        >
          Time is up — submitting your answers now.
        </div>
      ) : null}

      {submitError ? (
        <div
          data-ocid={`${MARKER}.error_state`}
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <span>{submitError}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-ocid={`${MARKER}.retry_button`}
            disabled={isSubmitting}
            onClick={handleManualSubmit}
          >
            <RotateCcw className="size-4" /> Try again
          </Button>
        </div>
      ) : null}

      <Card className="surface-glass shadow-elevated">
        <CardContent className="pt-6">
          <QuestionRenderer
            prompt={current.prompt}
            questionType={current.questionType}
            options={current.options}
            index={index + 1}
            total={questions.length}
            value={answers[current.id.toString()] ?? null}
            onChange={setAnswer}
            disabled={isSubmitting}
            marker={MARKER}
          />

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              data-ocid={`${MARKER}.secondary_button`}
              disabled={index === 0 || isSubmitting}
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
            >
              <ArrowLeft className="size-4" /> Previous
            </Button>

            <div className="flex items-center gap-3">
              {!isLast ? (
                <Button
                  type="button"
                  data-ocid={`${MARKER}.primary_button`}
                  disabled={isSubmitting}
                  onClick={() =>
                    setIndex((current) =>
                      Math.min(questions.length - 1, current + 1),
                    )
                  }
                >
                  Next <ArrowRight className="size-4" />
                </Button>
              ) : null}
              <Button
                type="button"
                variant={isLast ? "default" : "outline"}
                data-ocid={`${MARKER}.submit_button`}
                disabled={isSubmitting}
                onClick={handleManualSubmit}
                className={cn(
                  isLast &&
                    "bg-gradient-primary text-primary-foreground hover:opacity-90",
                )}
              >
                <Flag className="size-4" />
                {completeSession.isPending ? "Submitting…" : "Submit test"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-4 text-center text-xs">
        Want instant feedback instead?{" "}
        <Link
          to="/practice/$sessionId"
          params={{ sessionId: session.id.toString() }}
          data-ocid={`${MARKER}.link`}
          className="text-accent underline-offset-4 hover:underline"
        >
          Switch to practice
        </Link>
      </p>

      <SessionSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        options={scopeOptions}
        initialMode={SessionMode.timedTest}
        pending={startSession.isPending}
        errorMessage={setupError}
        onStart={handleStart}
        marker="session_setup"
      />
    </div>
  );
}
