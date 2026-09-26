import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useImportArchive } from "@/hooks/useArchive";
import type { ImportReport } from "@/lib/archiveImport";
import { USE_LOCAL_ACCOUNTS } from "@/lib/authMode";
import { archiveHeadline, readBrowserArchive } from "@/lib/browserArchive";
import { AlertTriangle, Inbox, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Bring an archive into the account, from a file or from this browser.
 *
 * Two entry points because there are two moments that need one. Before a server
 * exists, the only copy is the localStorage archive on this device, so the move
 * has to be offered by the app itself rather than written by whoever sets the
 * project up. After that, a downloaded file is the only way back in — for a
 * restore, for a device change, and for the day someone tells you the account
 * was opened in the wrong email address.
 *
 * An import only ever adds rows; it never deletes or overwrites, so the confirm
 * step is about effort rather than danger. The report is shown in full, including
 * the parts of an archive the importer refused to fake.
 */

interface PendingImport {
  text: string;
  /** What the dialog says the source holds. */
  summary: string;
}

function countLine(report: ImportReport): string {
  const { created, skipped } = report;
  const parts = [
    `${created.classes} classes`,
    `${created.subjects} subjects`,
    `${created.chapters} chapters`,
    `${created.topics} topics`,
    `${created.questions} questions`,
    `${created.notes} notes`,
    `${created.links} links`,
  ];
  if (created.settings > 0) parts.push("your profile");
  const skippedAny = Object.values(skipped).some((value) => value > 0);
  return skippedAny
    ? `${parts.join(", ")} added; what was already here was left alone.`
    : `${parts.join(", ")} added.`;
}

export function ArchiveImport() {
  const importArchive = useImportArchive();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const localArchive = useMemo(() => readBrowserArchive(), []);
  const running = importArchive.isPending;

  const run = (source: PendingImport) => {
    setPending(null);
    setReport(null);
    setProgress({ done: 0, total: 1 });
    importArchive.mutate(
      {
        text: source.text,
        onProgress: (done, total) => setProgress({ done, total }),
      },
      {
        onSuccess: (result) => {
          setProgress(null);
          setReport(result);
          if (result.failures.length > 0) {
            toast.warning(
              `${result.failures.length} row${
                result.failures.length === 1 ? "" : "s"
              } could not be imported.`,
            );
          } else {
            toast.success("Your data is in.");
          }
        },
        onError: (error) => {
          setProgress(null);
          toast.error(error.message);
        },
      },
    );
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPending({
        text: String(reader.result ?? ""),
        summary: `the file "${file.name}"`,
      });
    };
    reader.onerror = () => toast.error("That file could not be read.");
    reader.readAsText(file);
  };

  return (
    <div className="mt-4 space-y-4" data-ocid="settings.privacy.import">
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-display text-base text-card-foreground">
            Restore from a file
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Adds the classes, topics, questions and notes from a file you
            downloaded. Anything already in the account is kept.
          </p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            chooseFile(event.target.files?.[0]);
            event.target.value = "";
          }}
          data-ocid="settings.privacy.import_file_input"
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-2 rounded-full"
          disabled={running}
          onClick={() => fileInput.current?.click()}
          data-ocid="settings.privacy.import_button"
        >
          <Upload className="size-4" aria-hidden="true" />
          Choose a file
        </Button>
      </div>

      {localArchive && !USE_LOCAL_ACCOUNTS ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-display text-base text-card-foreground">
              Move data from this browser
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              This device still holds {archiveHeadline(localArchive.totals)}.
              They are not in your account yet.
            </p>
          </div>
          <Button
            type="button"
            className="shrink-0 gap-2 rounded-full"
            disabled={running}
            onClick={() =>
              setPending({
                text: localArchive.text,
                summary: archiveHeadline(localArchive.totals),
              })
            }
            data-ocid="settings.privacy.move_button"
          >
            <Inbox className="size-4" aria-hidden="true" />
            Move it in
          </Button>
        </div>
      ) : null}

      {progress && running ? (
        <div className="rounded-lg border border-border bg-background px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Importing…</span>
            <span className="font-medium text-foreground">
              {progress.done} of {progress.total}
            </span>
          </div>
          <Progress
            className="mt-2"
            value={
              progress.total > 0
                ? Math.round((progress.done / progress.total) * 100)
                : 0
            }
          />
        </div>
      ) : null}

      {report ? (
        <div className="rounded-lg border border-border bg-background px-4 py-3">
          <p className="text-sm font-medium text-foreground">
            {countLine(report)}
          </p>
          {report.notRestored.sessions + report.notRestored.results > 0 ? (
            <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-warning"
                aria-hidden="true"
              />
              <span>
                {report.notRestored.sessions} practice session
                {report.notRestored.sessions === 1 ? "" : "s"} and{" "}
                {report.notRestored.results} finished result
                {report.notRestored.results === 1 ? "" : "s"} were left out: the
                server dates an attempt when it is recorded, so replaying them
                would move your whole history to today.
                {report.notRestored.shares > 0
                  ? ` ${report.notRestored.shares} share link${
                      report.notRestored.shares === 1 ? "" : "s"
                    } were left out too — make new ones from the shared pages.`
                  : ""}
              </span>
            </p>
          ) : null}
          {report.created.links > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {report.created.links} QR link
              {report.created.links === 1 ? "" : "s"} came back with a new code
              — an exported file never carries the secret that manages the old
              one, so retire any stale code from the QR page.
            </p>
          ) : null}
          {report.failures.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {report.failures.slice(0, 8).map((failure) => (
                <li key={`${failure.entity}-${failure.label}`}>
                  {failure.label}: {failure.reason}
                </li>
              ))}
              {report.failures.length > 8 ? (
                <li>
                  …and {report.failures.length - 8} more. Download your data to
                  see the whole archive.
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title="Add this data to your account?"
        description={`Importing ${
          pending?.summary ?? "the archive"
        } will create rows in this account. Nothing already there is changed or removed.`}
        confirmLabel="Import"
        onConfirm={() => {
          if (pending) run(pending);
        }}
      />
    </div>
  );
}
