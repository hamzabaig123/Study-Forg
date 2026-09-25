import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAiExtractionStore } from "@/hooks/useAiExtractionStore";
import {
  extractAndStructureQuestions,
  getStoredAiConfig,
} from "@/lib/ai/aiClient";
import {
  type DocumentExtractionResult,
  extractQuestionsHeuristically,
  processUploadedFile,
} from "@/lib/ai/documentExtractor";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileCode,
  FileImage,
  FileText,
  FileUp,
  Loader2,
  RefreshCw,
  Sparkles,
  UploadCloud,
  Wand2,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

interface ExtractionUploaderProps {
  onExtractionComplete?: () => void;
  canisterFallback?: (text: string) => Promise<string>;
}

export function ExtractionUploader({
  onExtractionComplete,
  canisterFallback,
}: ExtractionUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [activeTab, setActiveTab] = useState<"file" | "paste">("file");
  const [pastedText, setPastedText] = useState("");

  const {
    fileName,
    fileSize,
    fileType,
    rawText,
    imageDataUrl,
    imageMimeType,
    status,
    errorMessage,
    setFileDetails,
    setRawText,
    setImageData,
    setStatus,
    setItems,
    defaultClassId,
    defaultSubjectId,
    defaultChapterId,
    defaultTopicId,
  } = useAiExtractionStore();

  const isBusy = status === "reading" || status === "extracting";

  const handleFile = async (file: File) => {
    setStatus("reading");
    try {
      setFileDetails({
        name: file.name,
        size: file.size,
        type:
          file.type ||
          (file.name.endsWith(".pdf") ? "application/pdf" : "text/plain"),
      });

      const result: DocumentExtractionResult = await processUploadedFile(file);
      setRawText(result.rawText);
      setImageData(result.imageDataUrl, result.imageMimeType);
      setStatus("ready");
      toast.success(`Loaded "${file.name}" successfully.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to read file.";
      setStatus("error", msg);
      toast.error(msg);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleRunAiExtraction = async () => {
    const textToProcess =
      activeTab === "paste" ? pastedText.trim() : rawText.trim();

    if (!textToProcess && !imageDataUrl) {
      toast.error("Please upload a PDF/image or paste document text first.");
      return;
    }

    setStatus("extracting");
    try {
      const config = getStoredAiConfig();
      const extracted = await extractAndStructureQuestions(
        {
          rawText: textToProcess,
          imageDataUrl,
          imageMimeType,
          canisterGenerateFallback: canisterFallback,
        },
        config,
      );

      if (extracted.length === 0) {
        toast.info(
          "No questions could be structured from this material. Try providing clearer question blocks.",
        );
        setStatus("ready");
        return;
      }

      // Populate items into the store with default hierarchy if configured
      const formattedItems = extracted.map((item) => ({
        ...item,
        status: "pending" as const,
        targetClassId: defaultClassId,
        targetSubjectId: defaultSubjectId,
        targetChapterId: defaultChapterId,
        targetTopicId: defaultTopicId,
      }));

      setItems(formattedItems);
      setStatus("ready");
      toast.success(
        `Extracted ${formattedItems.length} question${formattedItems.length === 1 ? "" : "s"}! Review them below.`,
      );
      onExtractionComplete?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI structuring failed.";
      setStatus("error", msg);
      toast.error(msg);
    }
  };

  const handleRunHeuristicFallback = () => {
    const textToProcess =
      activeTab === "paste" ? pastedText.trim() : rawText.trim();
    if (!textToProcess) {
      toast.error("No text available for rule-based extraction.");
      return;
    }

    const found = extractQuestionsHeuristically(textToProcess);
    if (found.length === 0) {
      toast.error(
        "No numbered question patterns found. Ensure questions start with 1., Q1, or Question 1.",
      );
      return;
    }

    const formatted = found.map((f) => ({
      ...f,
      status: "pending" as const,
      targetClassId: defaultClassId,
      targetSubjectId: defaultSubjectId,
      targetChapterId: defaultChapterId,
      targetTopicId: defaultTopicId,
    }));

    setItems(formatted);
    toast.success(
      `Extracted ${formatted.length} questions using offline heuristic parser.`,
    );
    onExtractionComplete?.();
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card className="rounded-xl border-border bg-card p-5 shadow-subtle md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary shadow-xs">
            <UploadCloud className="size-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold text-foreground sm:text-xl">
              Upload Document or Image
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              Upload test papers, worksheets, or textbook chapters in PDF or
              image format (PNG, JPG) to extract all MCQs and Q&A.
            </p>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as "file" | "paste")}
          className="w-auto shrink-0"
        >
          <TabsList className="h-9 rounded-lg border border-border bg-muted/40 p-1">
            <TabsTrigger value="file" className="rounded-md px-3 text-xs">
              <FileUp className="mr-1.5 size-3.5" />
              File Upload
            </TabsTrigger>
            <TabsTrigger value="paste" className="rounded-md px-3 text-xs">
              <FileCode className="mr-1.5 size-3.5" />
              Paste Text
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-5">
        {activeTab === "file" ? (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*,.txt,.md,.json,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />

            {!fileName ? (
              <>
                {/* biome-ignore lint/a11y/useSemanticElements: drop-zone div handles drag events which button elements don't support natively */}
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-muted/30"
                  }`}
                >
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FileUp className="size-6" />
                  </div>
                  <p className="mt-3 font-medium text-foreground text-sm">
                    Click to browse or drag and drop a file
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    PDF (text or scanned), PNG, JPG, WEBP, or TXT
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      PDF
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      Images
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      Exam Sheets
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      Handwritten Notes
                    </Badge>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {fileType?.includes("image") ? (
                        <FileImage className="size-5" />
                      ) : (
                        <FileText className="size-5" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground text-sm">
                        {fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(fileSize)} · {fileType || "Document"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowRawText(!showRawText)}
                      className="h-8 rounded-lg text-xs text-muted-foreground"
                    >
                      {showRawText ? (
                        <>
                          <ChevronUp className="mr-1 size-3.5" />
                          Hide Text
                        </>
                      ) : (
                        <>
                          <ChevronDown className="mr-1 size-3.5" />
                          Inspect Text
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-8 rounded-lg text-xs"
                    >
                      <RefreshCw className="mr-1 size-3.5" />
                      Replace
                    </Button>
                  </div>
                </div>

                {/* Optional Image thumbnail preview */}
                {imageDataUrl && (
                  <div className="mt-3 flex items-center gap-3 rounded-lg border border-border/60 bg-background/50 p-2">
                    <img
                      src={imageDataUrl}
                      alt="Uploaded preview"
                      className="size-16 rounded object-cover"
                    />
                    <div className="text-xs text-muted-foreground">
                      Image attached and optimized for vision extraction.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="paste-textarea" className="text-xs font-semibold">
              Paste Educational Text / Questions
            </Label>
            <Textarea
              id="paste-textarea"
              rows={7}
              placeholder="1. Which gas is absorbed by plants during photosynthesis?&#10;A) Oxygen&#10;B) Carbon Dioxide&#10;C) Nitrogen&#10;D) Hydrogen&#10;Answer: B&#10;&#10;2. Define Newton's First Law of Motion."
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
        )}

        {/* Collapsible raw text inspector */}
        {showRawText && (
          <div className="mt-4 space-y-2 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-muted-foreground">
                Raw Extracted OCR / Text (Editable)
              </Label>
              <span className="text-[11px] text-muted-foreground">
                {rawText.length} characters
              </span>
            </div>
            <Textarea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="font-mono text-xs"
              placeholder="Extracted document text will appear here..."
            />
          </div>
        )}

        {/* Error message banner */}
        {errorMessage && status === "error" && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">Extraction issue</p>
              <p className="mt-0.5 opacity-90">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="text-xs text-muted-foreground">
            {status === "extracting" ? (
              <span className="flex items-center gap-1.5 text-primary">
                <Loader2 className="size-3.5 animate-spin" />
                AI is structuring questions and validating options...
              </span>
            ) : status === "reading" ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                Processing PDF pages / encoding image...
              </span>
            ) : (
              <span>Ready to extract MCQs and Q&A items.</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy || (!rawText && !pastedText)}
              onClick={handleRunHeuristicFallback}
              className="rounded-lg text-xs"
              title="Fast offline rule-based extraction"
            >
              <Zap className="mr-1.5 size-3.5 text-amber-500" />
              Fast Heuristic Parser
            </Button>

            <Button
              type="button"
              disabled={isBusy || (!fileName && !pastedText.trim())}
              onClick={handleRunAiExtraction}
              className="rounded-lg bg-primary text-primary-foreground shadow-subtle hover:shadow-elevated"
            >
              {isBusy ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" />
                  Extract All MCQs & Q&A
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
