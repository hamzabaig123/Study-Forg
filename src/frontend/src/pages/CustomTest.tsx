import { CountdownTimer } from "@/components/session/CountdownTimer";
import { QuestionRenderer } from "@/components/session/QuestionRenderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { syncCustomSession } from "@/lib/customSync";
import {
  completeLocalSession,
  getLocalSession,
  saveLocalAnswers,
  subscribeLocalSessions,
} from "@/lib/localSessions";
import { describeCorrectAnswer, isCorrectAnswer } from "@/lib/sessionEngine";
import { cn } from "@/lib/utils";
import { SessionMode, type SubmittedAnswer } from "@/types";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Flag,
  Lightbulb,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";

const MARKER = "custom";

/**
 * Runs a test assembled by the test builder. Practice mode grades locally and
 * explains each answer on the spot; timed mode counts down and submits itself.
 * Both record into the local custom-session store on this device.
 */
export default function CustomTest() {
  const params = useParams({ strict: false }) as { sessionId?: string };
  const navigate = useNavigate();
  const sessionId =
    typeof params.sessionId === "string" ? params.sessionId : null;

  const session = useSyncExternalStore(
    subscribeLocalSessions,
    () => getLocalSession(sessionId),
    () => getLocalSession(sessionId),
  );

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, SubmittedAnswer>>({});
  const [finishing, setFinishing] = useState(false);
  const hydratedRef = useRef(false);
  const finishedRef = useRef(false);

  // Rehydrate saved answers once the session is available (refresh-safe).
  useEffect(() => {
    if (!session || hydratedRef.current) return;
    hydratedRef.current = true;
    setAnswers(session.answers);
  }, [session]);

  const questions = session?.questions ?? [];
  const current = questions[index] ?? null;
  const isLast = index >= questions.length - 1;
  const isTimed = session?.mode === SessionMode.timedTest;
  const answeredCount = Object.keys(answers).length;

  const finish = useCallback(() => {
    if (!session || finishedRef.current) return;
    finishedRef.current = true;
    setFinishing(true);
    const results = session.questions.map((question) => {
      const submitted = answers[question.id.toString()] ?? null;
      return {
        questionId: question.id.toString(),
        prompt: question.prompt,
        questionType: question.questionType,
        submitted,
        correct: submitted
          ? isCorrectAnswer(question.correctAnswer, submitted)
          : false,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        labels: question.labels,
      };
    });
    const completed = completeLocalSession(session.id, results);
    // Mirror the finished run to the account when a server supports it, so the
    // streak and accuracy survive this browser. Fire-and-forget: the local
    // copy is already durable and the results page must not wait on it.
    if (completed) void syncCustomSession(completed);
    void navigate({
      to: "/custom-results/$sessionId",
      params: { sessionId: session.id },
    });
  }, [answers, navigate, session]);

  // A completed session should never render here — bounce to its results.
  useEffect(() => {
    if (session?.status === "completed") {
      void navigate({
        to: "/custom-results/$sessionId",
        params: { sessionId: session.id },
      });
    }
  }, [session, navigate]);

  // Rejoining an expired timed test finishes it rather than restarting the clock.
  const expiredOnLoad =
    session !== null &&
    isTimed &&
    session.durationSeconds !== null &&
    Date.now() - session.startedAtMs >= session.durationSeconds * 1000;
  useEffect(() => {
    if (expiredOnLoad) finish();
  }, [expiredOnLoad, finish]);

  const setAnswer = useCallback(
    (answer: SubmittedAnswer) => {
      if (!current) return;
      const key = current.id.toString();
      setAnswers((prev) => {
        const next = { ...prev, [key]: answer };
        if (sessionId) saveLocalAnswers(sessionId, next);
        return next;
      });
    },
    [current, sessionId],
  );

  const feedback = useMemo(() => {
    if (!current || isTimed) return null;
    const submitted = answers[current.id.toString()];
    if (!submitted) return null;
    return {
      correct: isCorrectAnswer(current.correctAnswer, submitted),
      answerText: describeCorrectAnswer(current.correctAnswer),
      explanation: current.explanation,
    };
  }, [answers, current, isTimed]);

  if (!session) {
    return (
      <div
        data-ocid={`${MARKER}.missing_state`}
        className="mx-auto w-full max-w-3xl px-4 py-16 text-center"
      >
        <h1 className="font-display text-2xl font-semibold">
          This test isn't available
        </h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
          It may have been finished on another tab, or its history was cleared
          from this browser.
        </p>
        <Button asChild type="button" className="mt-6 rounded-full">
          <Link to="/test-builder" data-ocid={`${MARKER}.rebuild_link`}>
            Build a new test
          </Link>
        </Button>
      </div>
    );
  }

  const answered = feedback !== null;
  const elapsedSeconds = session.durationSeconds
    ? Math.max(0, Math.floor((Date.now() - session.startedAtMs) / 1000))
    : 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {isTimed ? "Timed test" : "Practice"}
          </p>
          <h1 className="font-display truncate text-xl font-semibold">
            {session.scopeLabel}
          </h1>
          <p className="text-muted-foreground numeric mt-1 text-xs">
            {isTimed
              ? `${answeredCount} of ${questions.length} answered`
              : `Question ${Math.min(index + 1, questions.length)} of ${questions.length}`}
          </p>
        </div>
        {isTimed && session.durationSeconds !== null ? (
          <CountdownTimer
            durationSeconds={session.durationSeconds}
            initialElapsedSeconds={elapsedSeconds}
            onExpire={finish}
            paused={finishing}
            marker={MARKER}
          />
        ) : null}
      </header>

      {current ? (
        <>
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
                disabled={finishing || (!isTimed && answered)}
                marker={MARKER}
              />

              {!isTimed && feedback ? (
                <output
                  data-ocid={`${MARKER}.feedback`}
                  className={cn(
                    "animate-fade-up mt-6 block rounded-lg border p-4",
                    feedback.correct
                      ? "border-success/40 bg-success/10"
                      : "border-destructive/40 bg-destructive/10",
                  )}
                >
                  <p
                    className={cn(
                      "flex items-center gap-2 text-sm font-semibold",
                      feedback.correct ? "text-success" : "text-destructive",
                    )}
                  >
                    {feedback.correct ? (
                      <>
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        Correct
                      </>
                    ) : (
                      <>
                        <XCircle className="size-4" aria-hidden="true" />
                        Not quite
                      </>
                    )}
                  </p>
                  {!feedback.correct ? (
                    <p className="mt-2 text-sm">
                      <span className="text-muted-foreground">
                        Correct answer:{" "}
                      </span>
                      <span className="font-medium">{feedback.answerText}</span>
                    </p>
                  ) : null}
                  {feedback.explanation ? (
                    <p className="text-muted-foreground mt-2 flex gap-2 text-sm leading-relaxed">
                      <Lightbulb
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      {feedback.explanation}
                    </p>
                  ) : null}
                </output>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  data-ocid={`${MARKER}.secondary_button`}
                  disabled={index === 0 || finishing}
                  onClick={() => setIndex((value) => Math.max(0, value - 1))}
                >
                  <ArrowLeft className="size-4" aria-hidden="true" /> Previous
                </Button>

                <div className="flex flex-wrap items-center justify-end gap-3">
                  {!isLast ? (
                    <Button
                      type="button"
                      data-ocid={`${MARKER}.primary_button`}
                      disabled={finishing}
                      onClick={() =>
                        setIndex((value) =>
                          Math.min(questions.length - 1, value + 1),
                        )
                      }
                    >
                      Next <ArrowRight className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant={isLast || !isTimed ? "default" : "outline"}
                    data-ocid={`${MARKER}.submit_button`}
                    disabled={finishing}
                    onClick={finish}
                    className={cn(
                      (isLast || !isTimed) &&
                        "bg-gradient-primary text-primary-foreground hover:opacity-90",
                    )}
                  >
                    <Flag className="size-4" aria-hidden="true" />
                    {isTimed ? "Submit test" : "Finish & see results"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {!isTimed ? (
            <p className="text-muted-foreground mt-4 text-center text-xs">
              Want a countdown instead?{" "}
              <Link
                to="/test-builder"
                data-ocid={`${MARKER}.builder_link`}
                className="text-accent underline-offset-4 hover:underline"
              >
                Build a timed test
              </Link>
            </p>
          ) : null}
        </>
      ) : (
        <div
          data-ocid={`${MARKER}.empty_state`}
          className="rounded-lg border border-dashed px-6 py-16 text-center"
        >
          <p className="font-display text-lg font-semibold">
            This test has no questions
          </p>
          <Button asChild type="button" className="mt-4 rounded-full">
            <Link to="/test-builder">Build a new test</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
