import { PublicLayout } from "@/components/layout/AppLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDeleteLink,
  useLinkDetail,
  useScanStats,
  useSetLinkStatus,
  useUpdateLinkTarget,
} from "@/hooks/useQrLinks";
import { LinkStatus, type ManageLinkError } from "@/types";
import { useParams } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  EyeOff,
  Link2,
  Pause,
  Play,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Motoko `Time.now()` is a nanosecond bigint — convert before any Date use. */
function timestampToDate(timestamp: bigint): Date | null {
  const date = new Date(Number(timestamp / 1_000_000n));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimestamp(timestamp: bigint): string {
  const date = timestampToDate(timestamp);
  if (!date) return "—";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Client-side guard mirroring the backend's http/https-only rule. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function manageErrorText(error: ManageLinkError): string {
  switch (error.__kind__) {
    case "invalidUrl":
      return error.invalidUrl;
    case "notAuthorized":
      return "This edit link is no longer valid.";
    case "notFound":
      return "This link could not be found.";
    default:
      return "Something went wrong. Please try again.";
  }
}

const chartConfig = {
  count: {
    label: "Scans",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function ManageLink() {
  const { token } = useParams({ from: "/manage/$token" });
  const detailQuery = useLinkDetail(token);
  const statsQuery = useScanStats(token);

  const link = detailQuery.data ?? null;
  const stats = statsQuery.data ?? null;

  const updateTarget = useUpdateLinkTarget();
  const setStatus = useSetLinkStatus();
  const deleteLink = useDeleteLink();

  const [draftUrl, setDraftUrl] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [targetSaved, setTargetSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleted, setDeleted] = useState(false);

  // One-time initialization of the editable draft from the loaded link.
  // Never re-run on refetch, so an in-progress edit is never clobbered.
  const linkId = link?.id;
  const linkTarget = link?.targetUrl;
  useEffect(() => {
    if (linkId === undefined || linkTarget === undefined) return;
    setDraftUrl(linkTarget);
  }, [linkId, linkTarget]);

  const chartData = useMemo(
    () =>
      (stats?.perDay ?? []).map((entry) => ({
        day: entry.day,
        label: formatDay(entry.day),
        count: Number(entry.count),
      })),
    [stats],
  );

  const isDeleted = deleted || link?.status === LinkStatus.deleted;
  const isPaused = link?.status === LinkStatus.paused;

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.shortUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleSaveTarget = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = draftUrl.trim();
    if (!isHttpUrl(next)) {
      setDraftError(
        "Enter a full web address starting with http:// or https://",
      );
      return;
    }
    setDraftError(null);
    setTargetSaved(false);
    updateTarget.mutate(
      { editToken: token, targetUrl: next },
      {
        onSuccess: (result) => {
          // The backend resolves with `{ #ok, #err }` rather than throwing, so
          // a rejected target must be surfaced explicitly.
          if (result.__kind__ === "err") {
            setDraftError(manageErrorText(result.err));
            return;
          }
          setTargetSaved(true);
        },
        onError: (error) => {
          const message =
            error instanceof Error
              ? error.message
              : "Could not save the new destination.";
          setDraftError(message);
        },
      },
    );
  };

  const handleTogglePause = () => {
    if (!link) return;
    setStatus.mutate({ editToken: token, paused: !isPaused });
  };

  const handleDelete = () => {
    deleteLink.mutate(token, {
      onSuccess: () => setDeleted(true),
    });
  };

  /* --- Loading ---------------------------------------------------------- */

  if (detailQuery.isLoading) {
    return (
      <PublicLayout>
        <div
          className="mx-auto max-w-4xl space-y-6"
          data-ocid="manage.loading_state"
        >
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </PublicLayout>
    );
  }

  /* --- Not found / deleted --------------------------------------------- */

  if (isDeleted || (!detailQuery.isLoading && !link)) {
    return (
      <PublicLayout>
        <div
          className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center"
          data-ocid="manage.not_found_state"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Link2 className="size-6" aria-hidden="true" />
          </span>
          <h1 className="font-display text-2xl font-semibold">
            {isDeleted ? "Link deleted" : "Link not found"}
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            {isDeleted
              ? "This short link has been deleted and no longer redirects. Its scan history is no longer available."
              : "This manage link is invalid or has expired. Check that you copied the full secret edit link."}
          </p>
          <Button asChild variant="outline" className="mt-2">
            <a href="/qr" data-ocid="manage.create_link">
              Create a new short link
            </a>
          </Button>
        </div>
      </PublicLayout>
    );
  }

  if (!link) return null;

  return (
    <PublicLayout>
      <div className="mx-auto max-w-4xl space-y-8" data-ocid="manage.page">
        {/* Header ---------------------------------------------------------- */}
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Manage link
            </h1>
            <StatusBadge status={link.status} />
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            This page is reachable only through your secret edit link. Anyone
            with this URL can change or delete the link, so keep it private.
          </p>
        </header>

        {/* Paused banner --------------------------------------------------- */}
        {isPaused && (
          <div
            className="contrast-warning flex items-start gap-3 rounded-lg p-4"
            data-ocid="manage.paused_state"
          >
            <EyeOff className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">This link is paused</p>
              <p className="text-sm">
                Scans of the short code show a “link unavailable” page instead
                of redirecting to the destination. Resume the link to restore
                redirects.
              </p>
            </div>
          </div>
        )}

        {/* Link detail ----------------------------------------------------- */}
        <Card data-ocid="manage.detail_card">
          <CardHeader>
            <CardTitle className="text-lg">Link details</CardTitle>
            <CardDescription>
              The short code and destination currently served by this link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="short-url">Short URL</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="short-url"
                  readOnly
                  value={link.shortUrl}
                  className="font-mono text-sm"
                  data-ocid="manage.short_url_input"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopy}
                  data-ocid="manage.copy_button"
                >
                  {copied ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button asChild variant="ghost">
                  <a
                    href={link.shortUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-ocid="manage.open_link"
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                    Open
                  </a>
                </Button>
              </div>
            </div>

            <Separator />

            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Created
                </dt>
                <dd className="text-sm">{formatTimestamp(link.createdAt)}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Last updated
                </dt>
                <dd className="text-sm">{formatTimestamp(link.updatedAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Target editor --------------------------------------------------- */}
        <Card data-ocid="manage.target_card">
          <CardHeader>
            <CardTitle className="text-lg">Destination URL</CardTitle>
            <CardDescription>
              Change where this short link sends visitors. Only http and https
              addresses are accepted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveTarget} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="target-url">Target URL</Label>
                <Input
                  id="target-url"
                  type="url"
                  inputMode="url"
                  value={draftUrl}
                  onChange={(event) => {
                    setDraftUrl(event.target.value);
                    setTargetSaved(false);
                    if (draftError) setDraftError(null);
                  }}
                  placeholder="https://example.com/page"
                  aria-invalid={!!draftError}
                  aria-describedby={draftError ? "target-url-error" : undefined}
                  data-ocid="manage.target_input"
                />
                {draftError && (
                  <p
                    id="target-url-error"
                    role="alert"
                    className="text-sm text-destructive"
                    data-ocid="manage.target_error"
                  >
                    {draftError}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="submit"
                  disabled={updateTarget.isPending || draftUrl.trim() === ""}
                  data-ocid="manage.save_button"
                >
                  {updateTarget.isPending ? "Saving…" : "Save destination"}
                </Button>
                {targetSaved && !draftError && (
                  <span
                    className="inline-flex items-center gap-1.5 text-sm text-success"
                    data-ocid="manage.save_success"
                  >
                    <Check className="size-4" aria-hidden="true" />
                    Destination updated
                  </span>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Scan stats ------------------------------------------------------ */}
        <Card data-ocid="manage.stats_card">
          <CardHeader>
            <CardTitle className="text-lg">Scan activity</CardTitle>
            <CardDescription>
              Scans recorded for this short link, by day.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-baseline gap-3">
              <span
                className="numeric text-4xl font-semibold"
                data-ocid="manage.total_scans"
              >
                {stats ? Number(stats.totalScans).toLocaleString() : "—"}
              </span>
              <span className="text-sm text-muted-foreground">
                total{" "}
                {stats && Number(stats.totalScans) === 1 ? "scan" : "scans"}
              </span>
            </div>

            {statsQuery.isLoading ? (
              <Skeleton className="h-56 w-full rounded-lg" />
            ) : chartData.length === 0 ? (
              <div
                className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center"
                data-ocid="manage.stats_empty_state"
              >
                <BarChart3
                  className="size-6 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium">No scans yet</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Share the short link or QR code — scans will appear here as
                  they happen.
                </p>
              </div>
            ) : (
              <ChartContainer
                config={chartConfig}
                className="h-56 w-full"
                data-ocid="manage.scans_chart"
              >
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: 0 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="dot" />}
                  />
                  <Bar
                    dataKey="count"
                    fill="var(--color-count)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Privacy note ---------------------------------------------------- */}
        <div
          className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-4"
          data-ocid="manage.privacy_note"
        >
          <ShieldCheck
            className="mt-0.5 size-5 shrink-0 text-accent"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold">What we record</p>
            <p className="text-sm text-muted-foreground">
              Each scan stores only the time of the scan, the device type
              (mobile, tablet, desktop, or other), and the country. Raw IP
              addresses are never stored, and no other personal data is
              collected.
            </p>
          </div>
        </div>

        {/* Status controls ------------------------------------------------- */}
        <Card data-ocid="manage.status_card">
          <CardHeader>
            <CardTitle className="text-lg">Link status</CardTitle>
            <CardDescription>
              Pause the link to stop redirects without deleting it, or delete it
              permanently.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleTogglePause}
              disabled={setStatus.isPending}
              data-ocid="manage.pause_button"
            >
              {isPaused ? (
                <Play className="size-4" aria-hidden="true" />
              ) : (
                <Pause className="size-4" aria-hidden="true" />
              )}
              {isPaused ? "Resume link" : "Pause link"}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteLink.isPending}
                  data-ocid="manage.delete_button"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete link
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent data-ocid="manage.delete_dialog">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this short link?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The short code will stop redirecting and show a “link
                    unavailable” page. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-ocid="manage.cancel_button">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-ocid="manage.confirm_button"
                  >
                    Delete link
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {deleteLink.isError && (
              <p
                className="text-sm text-destructive"
                data-ocid="manage.delete_error"
              >
                Could not delete the link. Please try again.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Report abuse ---------------------------------------------------- */}
        <div className="flex items-center justify-center gap-2 pt-2 text-sm text-muted-foreground">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <span>Something wrong with this link?</span>
          <a
            href={`mailto:abuse@studyforge.app?subject=${encodeURIComponent(
              `Report short link ${link.code}`,
            )}`}
            className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 hover:underline"
            data-ocid="manage.report_abuse_link"
          >
            Report abuse
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </PublicLayout>
  );
}

/* -------------------------------------------------------------------------- */
/* Status badge                                                                */
/* -------------------------------------------------------------------------- */

function StatusBadge({ status }: { status: LinkStatus }) {
  if (status === LinkStatus.active) {
    return (
      <Badge
        variant="outline"
        className="border-success/40 bg-success/10 text-success"
        data-ocid="manage.status_badge"
      >
        Active
      </Badge>
    );
  }
  if (status === LinkStatus.paused) {
    return (
      <Badge
        variant="outline"
        className="border-warning/40 bg-warning/10 text-warning-foreground"
        data-ocid="manage.status_badge"
      >
        Paused
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-destructive/40 bg-destructive/10 text-destructive"
      data-ocid="manage.status_badge"
    >
      Deleted
    </Badge>
  );
}
