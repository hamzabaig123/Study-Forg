import { Button } from "@/components/ui/button";
import {
  captchaConfigured,
  loadTurnstile,
  turnstileSiteKey,
} from "@/lib/turnstile";
import { useEffect, useRef, useState } from "react";

/**
 * The Turnstile checkbox, mounted into a form.
 *
 * Renders nothing when the build carries no site key, which is what keeps the
 * sign-in and sign-up screens identical on a project that has not switched
 * captcha on.
 *
 * A token is single-use, and a form that is refused for any other reason has
 * therefore spent it. The caller signals that by bumping `resetKey`: the widget
 * is taken down and rendered again, so the visitor solves one fresh check rather
 * than staring at a box that says it is already done.
 *
 * Deliberately fail-closed. When the script cannot be fetched the form stays
 * shut with a retry, because the alternative — let the submission through
 * without a token — is the exact hole the check exists to close.
 */
export function CaptchaField({
  onToken,
  resetKey = 0,
}: {
  onToken: (token: string | null) => void;
  resetKey?: number;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const report = useRef(onToken);
  report.current = onToken;
  const [problem, setProblem] = useState("");
  const [attempt, setAttempt] = useState(0);

  // The two dependencies are the re-run itself: neither value is read inside,
  // because the effect's whole job is to tear the old widget down and ask for a
  // fresh one when the form says its token is spent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed re-mount, see above
  useEffect(() => {
    const siteKey = turnstileSiteKey();
    const container = host.current;
    if (!siteKey || !container) {
      return;
    }
    let cancelled = false;
    let widgetId: string | null = null;
    let turnstile: { remove(id: string): void } | null = null;

    loadTurnstile().then(
      (api) => {
        if (cancelled || !host.current) {
          return;
        }
        turnstile = api;
        widgetId = api.render(host.current, {
          sitekey: siteKey,
          theme: "auto",
          callback: (token) => report.current(token),
          "expired-callback": () => report.current(null),
          "error-callback": () => {
            report.current(null);
            setProblem("The check could not verify you. Try it again.");
          },
          "timeout-callback": () => {
            report.current(null);
            setProblem("The check took too long. Try it again.");
          },
        });
      },
      () => {
        if (!cancelled) {
          report.current(null);
          setProblem(
            "This browser could not reach the human check. Check your connection and try again.",
          );
        }
      },
    );

    return () => {
      cancelled = true;
      if (widgetId) {
        turnstile?.remove(widgetId);
      }
    };
  }, [resetKey, attempt]);

  if (!captchaConfigured()) {
    return null;
  }

  return (
    <div className="space-y-2" data-ocid="auth.captcha.field">
      <div ref={host} className="min-h-[65px]" />
      {problem ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setProblem("");
              report.current(null);
              setAttempt((current) => current + 1);
            }}
            data-ocid="auth.captcha.retry_button"
          >
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
