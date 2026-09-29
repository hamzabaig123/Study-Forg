import { PublicLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useReportAbuse, useResolveCode } from "@/hooks/useQrLinks";
import { DeviceType, UnavailableReason } from "@/types";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { safeRedirectUrl } from "@/lib/security/externalUrl";

import {
  type AlertTriangle,
  Ban,
  Clock,
  Flag,
  Link2Off,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Scan context                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Coarse device class for the scan record. The backend stores only this
 * bucket — never a raw user agent or IP address.
 */
function detectDevice(): DeviceType {
  if (typeof navigator === "undefined") return DeviceType.other;
  const ua = navigator.userAgent;
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return DeviceType.tablet;
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return DeviceType.mobile;
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return DeviceType.desktop;
  return DeviceType.other;
}

/**
 * Best-effort country hint from the browser locale, e.g. "en-GB" -> "GB".
 *
 * `link_scan.country` only stores exactly two letters, and until migration
 * 0004 a value that failed the column CHECK aborted the whole `resolve_link`
 * call — which this page then rendered as "This link doesn't exist". Chrome's
 * locale for Latin American Spanish is "es-419" and Simplified Chinese
 * arrives as "zh-Hans-CN", so the region is verified here rather than
 * trusted: a locale that names no country contributes nothing to the scan.
 */
function detectCountry(): string | null {
  if (typeof navigator === "undefined") return null;
  const region = navigator.language?.split("-")[1];
  return region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : null;
}

/* -------------------------------------------------------------------------- */
/* Unavailable reasons                                                         */
/* -------------------------------------------------------------------------- */

interface UnavailableCopy {
  headline: string;
  body: string;
  icon: typeof AlertTriangle;
  /** Rate limiting is transient, so the page offers a retry instead of a report. */
  transient: boolean;
}

const UNAVAILABLE_COPY: Record<UnavailableReason, UnavailableCopy> = {
  [UnavailableReason.notFound]: {
    headline: "This link doesn't exist",
    body: "The code you scanned isn't one we recognise. It may have been mistyped, or the QR code may belong to a different service.",
    icon: Link2Off,
    transient: false,
  },
  [UnavailableReason.paused]: {
    headline: "This link is paused",
    body: "The owner has temporarily paused this link, so it isn't redirecting right now. Try again later, or contact whoever shared the code with you.",
    icon: Clock,
    transient: false,
  },
  [UnavailableReason.deleted]: {
    headline: "This link was removed",
    body: "The owner deleted this link, so it no longer points anywhere. Ask whoever shared the code for an up-to-date one.",
    icon: Trash2,
    transient: false,
  },
  [UnavailableReason.rateLimited]: {
    headline: "Too many requests",
    body: "We're seeing a lot of scans from your network right now. Wait a moment and try again.",
    icon: Ban,
    transient: true,
  },
};

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

function ScanLoading() {
  return (
    <div
      data-ocid="scan.loading_state"
      className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-2xl">Resolving your link…</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Checking the code and finding where it points.
      </p>
      <div className="mt-8 w-full max-w-sm">
        <Skeleton className="h-4 w-2/3 mx-auto" />
        <Skeleton className="mt-3 h-4 w-1/2 mx-auto" />
      </div>
      <span className="sr-only">Resolving short link</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Unavailable                                                                 */
/* -------------------------------------------------------------------------- */

function ReportAbuseForm({ code }: { code: string }) {
  const [reason, setReason] = useState("");
  const [reported, setReported] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const reportAbuse = useReportAbuse();

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 3 && !reportAbuse.isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const submitted = trimmed;
    setReason("");
    setSubmitFailed(false);
    reportAbuse.mutate(
      { code, reason: submitted },
      {
        onSuccess: (result) => {
          // The backend resolves with `{ #ok, #err }` rather than throwing, so
          // a rejected report must not show the success confirmation.
          if (result.__kind__ === "err") {
            setSubmitFailed(true);
            setReason((current) => (current === "" ? submitted : current));
            return;
          }
          setReported(true);
        },
        onError: () => {
          setSubmitFailed(true);
          setReason((current) => (current === "" ? submitted : current));
        },
      },
    );
  }

  if (reported) {
    return (
      <div
        data-ocid="scan.report.success_state"
        className="flex items-start gap-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-left"
      >
        <ShieldAlert
          className="mt-0.5 size-4 shrink-0 text-success"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">
          Thanks — your report has been recorded. We review abuse reports
          regularly.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 text-left"
      data-ocid="scan.report.form"
    >
      <label
        htmlFor="scan-report-reason"
        className="text-sm font-medium text-foreground"
      >
        Report this link
      </label>
      <textarea
        id="scan-report-reason"
        data-ocid="scan.report.textarea"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        maxLength={500}
        placeholder="Tell us briefly what's wrong — for example, spam, phishing, or harmful content."
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-smooth placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {submitFailed && (
        <p
          data-ocid="scan.report.error_state"
          role="alert"
          className="text-sm text-destructive"
        >
          We couldn't submit your report. Please try again.
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {trimmed.length}/500
        </span>
        <Button
          type="submit"
          variant="outline"
          disabled={!canSubmit}
          data-ocid="scan.report.submit_button"
          className="rounded-full"
        >
          <Flag className="size-4" aria-hidden="true" />
          {reportAbuse.isPending ? "Sending…" : "Submit report"}
        </Button>
      </div>
    </form>
  );
}

function ScanUnavailable({
  code,
  reason,
  onRetry,
}: {
  code: string;
  reason: UnavailableReason;
  onRetry: () => void;
}) {
  const copy = UNAVAILABLE_COPY[reason];
  const Icon = copy.icon;

  return (
    <div
      data-ocid="scan.unavailable_state"
      className="mx-auto max-w-xl px-6 py-20 animate-fade-up"
    >
      <div className="flex flex-col items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Icon className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-balance text-3xl">{copy.headline}</h1>
        <p className="mt-4 text-pretty text-muted-foreground">{copy.body}</p>
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          Code: {code}
        </p>
        {copy.transient && (
          <Button
            type="button"
            onClick={onRetry}
            data-ocid="scan.retry_button"
            className="mt-8 rounded-full bg-gradient-primary text-primary-foreground shadow-sm transition-smooth hover:opacity-90"
          >
            Try again
          </Button>
        )}
      </div>

      {/* A report can only name a link the service actually issued: every
          backend refuses unknown codes, so offering the form on the not-found
          page would offer a submission that cannot succeed. */}
      {!copy.transient && reason !== UnavailableReason.notFound && (
        <Card className="mt-10 rounded-lg border-border shadow-none">
          <CardContent className="pt-6">
            <ReportAbuseForm code={code} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function ScanRedirect() {
  const { code } = useParams({ strict: false }) as { code: string };
  const device = useMemo(() => detectDevice(), []);
  const country = useMemo(() => detectCountry(), []);

  const { data, isLoading, isError, refetch } = useResolveCode(
    code,
    device,
    country,
  );

  const storedUrl =
    data && data.__kind__ === "redirect" ? data.redirect.targetUrl : null;
  /**
   * Re-checked here rather than trusted. The rule set this page shares with the
   * minting side is the *write's* rule set for whichever backend answered: a
   * restored archive, the canister or hand-run SQL can each leave a different
   * string in `target_url`. `window.location.replace("javascript:…")` executes
   * in this origin — the one holding the session — and the "continue to the
   * destination" anchor below is the same sink wearing a link.
   */
  const targetUrl = useMemo(() => safeRedirectUrl(storedUrl), [storedUrl]);

  useEffect(() => {
    if (!targetUrl) return;
    // Replace rather than push so the short link never traps the back button.
    window.location.replace(targetUrl);
  }, [targetUrl]);

  if (storedUrl !== null && targetUrl === null) {
    return (
      <PublicLayout>
        <div
          data-ocid="scan.refused_state"
          className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center"
          role="alert"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="size-6" aria-hidden="true" />
          </span>
          <h1 className="mt-6 text-2xl">This link was refused</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The address behind that code is not one StudyForge will send you to.
            If you were expecting a page here, tell the person who shared the
            link.
          </p>
        </div>
      </PublicLayout>
    );
  }

  if (targetUrl) {
    return (
      <PublicLayout>
        <div
          data-ocid="scan.redirect_state"
          className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center"
          aria-live="polite"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </span>
          <h1 className="mt-6 text-2xl">Taking you there…</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            If nothing happens,{" "}
            <a
              href={targetUrl}
              className="font-medium text-accent underline-offset-4 hover:underline"
              data-ocid="scan.continue_link"
            >
              continue to the destination
            </a>
            .
          </p>
        </div>
      </PublicLayout>
    );
  }

  if (isLoading) {
    return (
      <PublicLayout>
        <ScanLoading />
      </PublicLayout>
    );
  }

  const reason =
    data && data.__kind__ === "unavailable"
      ? data.unavailable
      : UnavailableReason.notFound;

  return (
    <PublicLayout>
      <ScanUnavailable
        code={code}
        reason={isError ? UnavailableReason.notFound : reason}
        onRetry={() => void refetch()}
      />
    </PublicLayout>
  );
}
