import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { SourceDocument } from "@/lib/ai/document";
import { MAX_TEXT_CHARACTERS } from "@/lib/ai/document";
import type { ExtractionProgress } from "@/lib/ai/extract";
import {
  AlertCircle,
  FileImage,
  FileText,
  Loader2,
  RefreshCw,
  ScanEye,
  Settings2,
  Sparkles,
  Type,
  UploadCloud,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";

interface SourcePanelProps {
  document: SourceDocument | null;
  summary: string | null;
  pasteText: string;
  onPasteText: (value: string) => void;
  onFile: (file: File) => void;
  onClearFile: () => void;
  phase: "idle" | "reading" | "extracting";
  progress: ExtractionProgress | null;
  error: string | null;
  onDismissError: () => void;
  engineLabel: string;
  engineIsModel: boolean;
  textAvailable: boolean;
  onRun: () => void;
  onRunOffline: () => void;
  onOpenSettings: () => void;
}

const ACCEPT = ".pdf,image/*,.txt,.md,.csv,.json,application/pdf,text/plain";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The one input the studio needs: a file, pasted text, or both. Everything
 * below it is driven by whether a model is connected — the offline parser can
 * only work on text, so an image without a key has to say so plainly.
 */
export function SourcePanel({
  document: source,
  summary,
  pasteText,
  onPasteText,
  onFile,
  onClearFile,
  phase,
  progress,
  error,
  onDismissError,
  engineLabel,
  engineIsModel,
  textAvailable,
  onRun,
  onRunOffline,
  onOpenSettings,
}: SourcePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<"file" | "paste">("file");

  const busy = phase !== "idle";
  const visionOnly = source?.needsVision === true;
  const blocked = visionOnly && !engineIsModel;
  const canRun = !busy && !blocked && (textAvailable || visionOnly);

  const take = (file: File | undefined) => {
    if (!file) return;
    setTab("file");
    onFile(file);
  };

  return (
    <Card
      data-ocid="ai_studio.source_panel"
      className="rounded-xl border-border bg-card p-5 shadow-subtle md:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <UploadCloud className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-card-foreground">
            Source document
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            A test paper, worksheet or chapter page — as a PDF, an image, or
            pasted text.
          </p>

          {/* The engine badge and its key button describe this card, so they
              sit under the heading they belong to rather than at the far edge
              of a full-width card, where they read as an unrelated row. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={
                engineIsModel
                  ? "rounded-full border-primary/30 bg-primary/10 text-primary"
                  : "rounded-full border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400"
              }
            >
              {engineIsModel ? (
                <Sparkles className="mr-1 size-3" aria-hidden="true" />
              ) : (
                <Zap className="mr-1 size-3" aria-hidden="true" />
              )}
              {engineLabel}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="action"
              onClick={onOpenSettings}
              data-ocid="ai_studio.settings_button"
            >
              <Settings2 className="size-3.5" aria-hidden="true" />
              Connect AI key
            </Button>
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "file" | "paste")}
        className="mt-5"
      >
        <TabsList className="h-9 rounded-lg border border-border bg-muted/40 p-1">
          <TabsTrigger value="file" className="rounded-md px-3 text-xs">
            <FileText className="mr-1.5 size-3.5" aria-hidden="true" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="paste" className="rounded-md px-3 text-xs">
            <Type className="mr-1.5 size-3.5" aria-hidden="true" />
            Paste text
          </TabsTrigger>
        </TabsList>

        <TabsContent value="file" className="mt-4">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            // The drop zone below is the control people see and tab to, so this
            // stays out of the tab order — but it still needs a name for the
            // file picker's own announcement when something clicks it.
            tabIndex={-1}
            aria-label="Choose a test paper, worksheet or photo of a page"
            onChange={(event) => take(event.target.files?.[0])}
          />

          {!source ? (
            // biome-ignore lint/a11y/useSemanticElements: a drop zone needs drag events, which a button cannot carry
            <div
              role="button"
              tabIndex={0}
              data-ocid="ai_studio.drop_zone"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                take(event.dataTransfer.files?.[0]);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-smooth ${
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/30"
              }`}
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UploadCloud className="size-6" aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-medium text-foreground">
                Drop a file here, or click to browse
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                PDF (text or scanned), PNG, JPG, WEBP, TXT or MD
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {source.kind === "image" ? (
                      <FileImage className="size-5" aria-hidden="true" />
                    ) : (
                      <FileText className="size-5" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {source.fileName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatSize(source.fileSize)}
                      {source.kind === "pdf"
                        ? ` · ${source.pageCount} page${
                            source.pageCount === 1 ? "" : "s"
                          }`
                        : ""}
                      {source.needsVision
                        ? ` · ${source.images.length} page image${
                            source.images.length === 1 ? "" : "s"
                          } to read`
                        : ` · ${source.text.length.toLocaleString()} characters read`}
                      {source.truncated ? " · text cut to fit one request" : ""}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="action"
                  onClick={() => inputRef.current?.click()}
                  data-ocid="ai_studio.replace_file_button"
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Replace
                </Button>
              </div>

              {source.images.length > 0 ? (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {source.images.map((image) => (
                    <img
                      key={image.page}
                      src={`data:${image.mimeType};base64,${image.base64}`}
                      alt={`Page ${image.page}`}
                      className="h-24 rounded-md border border-border object-contain"
                    />
                  ))}
                </div>
              ) : null}

              {source.needsVision && source.pagesSkipped > 0 ? (
                <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                  <ScanEye
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  Only the first {source.images.length} pages are read per run;
                  {` ${source.pagesSkipped} page${
                    source.pagesSkipped === 1 ? "" : "s"
                  } left over.`}
                </p>
              ) : null}
            </div>
          )}
        </TabsContent>

        <TabsContent value="paste" className="mt-4">
          <div className="space-y-2">
            <Label
              htmlFor="ai_studio_paste"
              className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Questions to extract
            </Label>
            <Textarea
              id="ai_studio_paste"
              data-ocid="ai_studio.paste_input"
              rows={8}
              value={pasteText}
              onChange={(event) => onPasteText(event.target.value)}
              placeholder={
                "1. Which gas do plants absorb?\nA) Oxygen\nB) Carbon dioxide\nC) Nitrogen\nD) Hydrogen\nAnswer: B\n\n2. State Newton's first law of motion.\nAnswer: An body stays at rest…"
              }
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {pasteText.length.toLocaleString()} /{" "}
              {MAX_TEXT_CHARACTERS.toLocaleString()} characters used
              {source ? " · combined with the uploaded file" : ""}
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {error ? (
        <div
          role="alert"
          data-ocid="ai_studio.error"
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Could not extract</p>
            <p className="mt-0.5 break-words opacity-90">{error}</p>
            {textAvailable ? (
              <Button
                type="button"
                variant="outline"
                size="action"
                onClick={onDismissError}
                className="mt-2"
              >
                Dismiss
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="action"
                onClick={onOpenSettings}
                className="mt-2"
                data-ocid="ai_studio.error_settings_button"
              >
                Connect AI key
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {progress ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2
              className="size-3.5 animate-spin text-primary"
              aria-hidden="true"
            />
            <span>{progress.message}</span>
          </div>
          <Progress
            value={Math.round(
              (progress.done / Math.max(1, progress.total)) * 100,
            )}
            className="h-1.5"
          />
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          {phase === "reading" ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Reading the file…
            </>
          ) : (
            (summary ?? "No source loaded yet.")
          )}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-xs text-muted-foreground">
          {blocked
            ? "This source is only readable as an image. Connect a vision key to extract from it."
            : engineIsModel
              ? "Everything on the page is extracted — MCQs and question-answer pairs — then reviewed here before anything reaches your question bank."
              : "Offline parsing reads numbered questions and options from the text. Images and scanned PDFs need a key."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {engineIsModel && textAvailable ? (
            <Button
              type="button"
              variant="quiet"
              size="action"
              disabled={busy}
              onClick={onRunOffline}
              data-ocid="ai_studio.offline_button"
            >
              <Zap className="size-3.5" aria-hidden="true" />
              Parse without AI
            </Button>
          ) : null}
          {/* The one large primary action on the card: everything else here is
              a way of getting ready for it. */}
          <Button
            type="button"
            variant="primary"
            size="lg"
            disabled={!canRun}
            onClick={onRun}
            className="w-full sm:w-auto"
            data-ocid="ai_studio.extract_button"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            {busy
              ? "Extracting…"
              : engineIsModel
                ? "Extract all MCQs and Q&A"
                : "Parse questions from text"}
          </Button>
          {source ? (
            <Button
              type="button"
              variant="quiet"
              size="action"
              onClick={onClearFile}
              className="hover:text-destructive"
              data-ocid="ai_studio.clear_file_button"
            >
              Remove file
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
