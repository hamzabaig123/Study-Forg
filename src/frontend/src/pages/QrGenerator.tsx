import { Header } from "@/components/layout/Header";
import {
  DEFAULT_QR_OPTIONS,
  QrCode,
  type QrErrorLevel,
  type QrRenderOptions,
  downloadDataUrl,
  renderQrPngDataUrl,
  renderQrSvg,
} from "@/components/qr/QrCode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateLink } from "@/hooks/useQrLinks";
import type { CreateLinkError, CreatedLink } from "@/types";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Download,
  FileCode2,
  ImageDown,
  Link2,
  Loader2,
  QrCode as QrCodeIcon,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Prepend `https://` when the user typed a bare host. */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** A URL is previewable once it has a scheme and a plausible host. */
function isPreviewable(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.includes(".")
    );
  } catch {
    return false;
  }
}

/** Relative luminance of a `#rrggbb` colour, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const channels = [0, 2, 4].map((i) => {
    const value = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The scannability verdict for a foreground/background pair. */
function assessContrast(foreground: string, background: string) {
  const ratio = contrastRatio(foreground, background);
  const darkOnLight =
    relativeLuminance(foreground) < relativeLuminance(background);
  const ok = darkOnLight && ratio >= 4.5;
  return { ratio, darkOnLight, ok };
}

/** Human-readable message for a backend create-link failure. */
function describeCreateError(error: CreateLinkError): string {
  switch (error.__kind__) {
    case "invalidUrl":
      return `That destination could not be accepted: ${error.invalidUrl}`;
    case "rateLimited":
      return "You have created several codes in a row. Wait a moment, then try again.";
    default:
      return "The link could not be created. Try again.";
  }
}

const ERROR_LEVELS: { value: QrErrorLevel; label: ReactNode }[] = [
  { value: "L", label: "L — Low (7%)" },
  { value: "M", label: "M — Medium (15%)" },
  {
    value: "Q",
    // The value node mirrors the chosen item into the trigger, which cannot
    // wrap, so the hint only shows where the column is wide enough for it.
    label: (
      <>
        Q — Quartile (25%)
        <span className="hidden sm:inline"> · recommended</span>
      </>
    ),
  },
  { value: "H", label: "H — High (30%)" },
];

const SIZE_PRESETS = [256, 320, 512, 768];

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Public dynamic QR generator. Works without signing in: the visitor types a
 * destination, tunes the code, and creates a short link whose URL is what the
 * QR actually encodes. The secret edit link is the only way back in.
 */
export default function QrGenerator() {
  const [rawUrl, setRawUrl] = useState("");
  const [foreground, setForeground] = useState(DEFAULT_QR_OPTIONS.foreground);
  const [background, setBackground] = useState(DEFAULT_QR_OPTIONS.background);
  const [size, setSize] = useState(DEFAULT_QR_OPTIONS.size);
  const [errorLevel, setErrorLevel] = useState<QrErrorLevel>(
    DEFAULT_QR_OPTIONS.errorLevel,
  );
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"short" | "manage" | null>(null);
  const [downloading, setDownloading] = useState<"png" | "svg" | null>(null);

  const createLink = useCreateLink();

  const normalized = normalizeUrl(rawUrl);
  const previewable = isPreviewable(normalized);
  const contrast = useMemo(
    () => assessContrast(foreground, background),
    [foreground, background],
  );

  const options = useMemo<QrRenderOptions>(
    () => ({
      foreground,
      background,
      size,
      errorLevel,
      margin: DEFAULT_QR_OPTIONS.margin,
    }),
    [foreground, background, size, errorLevel],
  );

  // The backend returns the short URL as a relative path (`/r/<code>`), which
  // is not scannable on its own — absolutize it against the app origin.
  const absoluteShortUrl = created
    ? new URL(created.shortUrl, window.location.origin).toString()
    : "";

  // Before creation the preview tracks the typed URL; after creation it tracks
  // the app's own short URL, which is what the printed code must encode.
  const encodedValue = created
    ? absoluteShortUrl
    : previewable
      ? normalized
      : "";
  const previewLabel = created
    ? `QR code linking to ${absoluteShortUrl}`
    : `QR code linking to ${normalized}`;

  const handleCreate = () => {
    setFormError(null);
    if (!previewable) {
      setFormError(
        "Enter a full web address, for example example.com/spring-open-day.",
      );
      return;
    }
    createLink.mutate(normalized, {
      onSuccess: (result) => {
        if (result.__kind__ === "ok") {
          setCreated(result.ok);
          toast.success("Short link created", {
            description: "Your QR code now points at the short URL.",
          });
        } else {
          setFormError(describeCreateError(result.err));
        }
      },
      onError: () => {
        setFormError("The link could not be created. Check your connection.");
      },
    });
  };

  const handleCopy = async (value: string, which: "short" | "manage") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("Copy failed", {
        description: "Select the text and copy it manually.",
      });
    }
  };

  const handleDownload = async (format: "png" | "svg") => {
    if (!encodedValue) return;
    setDownloading(format);
    try {
      const filename = `studyforge-qr-${created?.code ?? "preview"}`;
      if (format === "png") {
        const dataUrl = await renderQrPngDataUrl(encodedValue, options);
        downloadDataUrl(dataUrl, `${filename}.png`);
      } else {
        const svg = await renderQrSvg(encodedValue, options);
        const blobUrl = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml" }),
        );
        downloadDataUrl(blobUrl, `${filename}.svg`);
        // Revoke after the click has been processed, otherwise some browsers
        // cancel the in-flight download.
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch {
      toast.error("Download failed", {
        description: "Try a smaller size or a shorter URL.",
      });
    } finally {
      setDownloading(null);
    }
  };

  const resetForNewCode = () => {
    setCreated(null);
    setRawUrl("");
    setFormError(null);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main
        className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-12"
        data-ocid="public.main"
      >
        <div className="mx-auto w-full max-w-6xl">
          <div className="animate-fade-up">
            {/* ---------------------------------------------------------------- */}
            {/* Intro                                                            */}
            {/* ---------------------------------------------------------------- */}
            <header className="max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Sparkles
                  className="size-3.5 text-primary"
                  aria-hidden="true"
                />
                Dynamic QR studio
              </span>
              <h1 className="mt-4 text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
                Point a code anywhere.
                <span className="text-gradient-primary"> Change it later.</span>
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Build a scannable code in seconds — no account needed. We encode
                our own short URL, so you can retarget the destination any time
                from your private edit link.
              </p>
            </header>

            {/* ---------------------------------------------------------------- */}
            {/* Two-column workstation                                           */}
            {/* ---------------------------------------------------------------- */}
            <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
              {/* ---------------------------- Form ---------------------------- */}
              <div className="space-y-6">
                <section
                  className="rounded-lg border border-border bg-card p-6 shadow-subtle"
                  data-ocid="qr.form.panel"
                >
                  <div className="flex items-center gap-2">
                    <Link2 className="size-4 text-primary" aria-hidden="true" />
                    <h2 className="text-lg font-semibold">Destination</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Where should the code send people? We add{" "}
                    <span className="font-mono text-xs">https://</span> if you
                    leave it off.
                  </p>

                  <div className="mt-4 space-y-2">
                    <Label htmlFor="qr-target">Destination URL</Label>
                    <Input
                      id="qr-target"
                      type="text"
                      inputMode="url"
                      autoComplete="url"
                      placeholder="example.com/spring-open-day"
                      value={rawUrl}
                      onChange={(event) => {
                        setRawUrl(event.target.value);
                        setFormError(null);
                      }}
                      aria-invalid={formError ? true : undefined}
                      aria-describedby={
                        formError ? "qr-target-error" : undefined
                      }
                      data-ocid="qr.url_input"
                    />
                    {normalized && normalized !== rawUrl.trim() ? (
                      <p className="text-xs text-muted-foreground">
                        Will be saved as{" "}
                        <span className="font-mono text-foreground">
                          {normalized}
                        </span>
                      </p>
                    ) : null}
                    {formError ? (
                      <p
                        id="qr-target-error"
                        role="alert"
                        className="flex items-start gap-2 text-sm text-destructive"
                        data-ocid="qr.url_error_state"
                      >
                        <AlertTriangle
                          className="mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        {formError}
                      </p>
                    ) : null}
                  </div>
                </section>

                {/* ------------------------- Appearance ------------------------ */}
                <section
                  className="rounded-lg border border-border bg-card p-6 shadow-subtle"
                  data-ocid="qr.options.panel"
                >
                  <div className="flex items-center gap-2">
                    <QrCodeIcon
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                    <h2 className="text-lg font-semibold">Appearance</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Keep the modules darker than the background — scanners rely
                    on that contrast.
                  </p>

                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="qr-foreground">Foreground</Label>
                      <div className="flex items-center gap-3">
                        <input
                          id="qr-foreground"
                          type="color"
                          value={foreground}
                          onChange={(event) =>
                            setForeground(event.target.value)
                          }
                          className="size-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
                          data-ocid="qr.foreground_input"
                        />
                        <Input
                          value={foreground}
                          onChange={(event) =>
                            setForeground(event.target.value)
                          }
                          aria-label="Foreground hex colour"
                          className="font-mono text-xs uppercase"
                          data-ocid="qr.foreground_hex_input"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="qr-background">Background</Label>
                      <div className="flex items-center gap-3">
                        <input
                          id="qr-background"
                          type="color"
                          value={background}
                          onChange={(event) =>
                            setBackground(event.target.value)
                          }
                          className="size-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
                          data-ocid="qr.background_input"
                        />
                        <Input
                          value={background}
                          onChange={(event) =>
                            setBackground(event.target.value)
                          }
                          aria-label="Background hex colour"
                          className="font-mono text-xs uppercase"
                          data-ocid="qr.background_hex_input"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="qr-size">Export size</Label>
                      <Select
                        value={String(size)}
                        onValueChange={(value) => setSize(Number(value))}
                      >
                        <SelectTrigger
                          id="qr-size"
                          className="w-full"
                          data-ocid="qr.size_select"
                        >
                          <SelectValue placeholder="Choose a size" />
                        </SelectTrigger>
                        <SelectContent>
                          {SIZE_PRESETS.map((preset) => (
                            <SelectItem key={preset} value={String(preset)}>
                              {preset} × {preset} px
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="qr-error-level">Error correction</Label>
                      <Select
                        value={errorLevel}
                        onValueChange={(value) =>
                          setErrorLevel(value as QrErrorLevel)
                        }
                      >
                        <SelectTrigger
                          id="qr-error-level"
                          className="w-full"
                          data-ocid="qr.error_level_select"
                        >
                          <SelectValue placeholder="Choose a level" />
                        </SelectTrigger>
                        <SelectContent>
                          {ERROR_LEVELS.map((level) => (
                            <SelectItem key={level.value} value={level.value}>
                              {level.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Quiet zone is fixed by the product spec. */}
                  <div className="mt-5 flex items-start gap-3 rounded-md border border-border bg-muted/50 p-3">
                    <ShieldCheck
                      className="mt-0.5 size-4 shrink-0 text-accent"
                      aria-hidden="true"
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      A{" "}
                      <span className="font-medium text-foreground">
                        4-module quiet zone
                      </span>{" "}
                      is always preserved around the code, and error correction
                      is set to{" "}
                      <span className="font-medium text-foreground">
                        level {errorLevel}
                      </span>
                      . Both are required for reliable scanning.
                    </p>
                  </div>
                </section>

                {/* ---------------------- Contrast guardrail ------------------- */}
                <section
                  className={
                    contrast.ok
                      ? "contrast-ok rounded-lg p-4"
                      : "contrast-warning rounded-lg p-4"
                  }
                  data-ocid={
                    contrast.ok
                      ? "qr.contrast_ok_state"
                      : "qr.contrast_warning_state"
                  }
                >
                  <div className="flex items-start gap-3">
                    {contrast.ok ? (
                      <Check
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <div className="text-sm">
                      <p className="font-medium">
                        {contrast.ok
                          ? "Contrast looks scannable"
                          : "This colour pair may not scan"}
                      </p>
                      <p className="mt-1 leading-relaxed opacity-90">
                        {contrast.ok
                          ? `Dark-on-light with a ${contrast.ratio.toFixed(1)}:1 ratio — comfortably above the 4.5:1 minimum.`
                          : !contrast.darkOnLight
                            ? "Your foreground is lighter than the background. Invert them so the modules stay dark — the preview below keeps a scannable rendering."
                            : `The ratio is only ${contrast.ratio.toFixed(1)}:1. Darken the foreground or lighten the background to reach 4.5:1.`}
                      </p>
                    </div>
                  </div>
                </section>

                {/* ------------------------- Print size ------------------------ */}
                <section
                  className="rounded-lg border border-border bg-card p-5"
                  data-ocid="qr.print_guidance.panel"
                >
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Print guidance
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Print at least{" "}
                    <span className="font-medium text-foreground">
                      2 cm × 2 cm
                    </span>{" "}
                    (about 0.8 in) so phone cameras can lock on. For posters and
                    signage, scale up to{" "}
                    <span className="font-medium text-foreground">
                      5 cm × 5 cm
                    </span>{" "}
                    or larger and keep the surrounding quiet zone clear of text
                    and artwork.
                  </p>
                </section>
              </div>

              {/* --------------------------- Preview -------------------------- */}
              <aside className="lg:sticky lg:top-24">
                <div
                  className="rounded-lg border border-border bg-card p-6 shadow-subtle"
                  data-ocid="qr.preview.panel"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">Live preview</h2>
                    <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {created ? "Short URL" : "Draft"}
                    </span>
                  </div>

                  <div className="qr-well mt-4">
                    <QrCode
                      value={encodedValue}
                      options={options}
                      label={previewLabel}
                    />
                  </div>

                  <p className="mt-3 break-all text-center font-mono text-xs text-muted-foreground">
                    {encodedValue || "Waiting for a destination…"}
                  </p>

                  {created ? (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      This code now encodes your short URL, so you can retarget
                      it later without reprinting.
                    </p>
                  ) : null}

                  {/* Downloads */}
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleDownload("png")}
                      disabled={!encodedValue || downloading !== null}
                      data-ocid="qr.download_png_button"
                    >
                      {downloading === "png" ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <ImageDown aria-hidden="true" />
                      )}
                      PNG
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleDownload("svg")}
                      disabled={!encodedValue || downloading !== null}
                      data-ocid="qr.download_svg_button"
                    >
                      {downloading === "svg" ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <FileCode2 aria-hidden="true" />
                      )}
                      SVG
                    </Button>
                  </div>

                  {/* Create / result */}
                  {created ? (
                    <div
                      className="mt-5 space-y-4"
                      data-ocid="qr.success_state"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="qr-short-url">Short URL</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="qr-short-url"
                            readOnly
                            value={absoluteShortUrl}
                            className="font-mono text-xs"
                            data-ocid="qr.short_url_input"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Copy short URL"
                            onClick={() =>
                              void handleCopy(absoluteShortUrl, "short")
                            }
                            data-ocid="qr.copy_short_url_button"
                          >
                            {copied === "short" ? (
                              <Check aria-hidden="true" />
                            ) : (
                              <Copy aria-hidden="true" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="qr-manage-url">Secret edit link</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="qr-manage-url"
                            readOnly
                            value={created.manageUrl}
                            className="font-mono text-xs"
                            data-ocid="qr.manage_url_input"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Copy secret edit link"
                            onClick={() =>
                              void handleCopy(created.manageUrl, "manage")
                            }
                            data-ocid="qr.copy_manage_url_button"
                          >
                            {copied === "manage" ? (
                              <Check aria-hidden="true" />
                            ) : (
                              <Copy aria-hidden="true" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <div className="contrast-warning rounded-md p-3">
                        <p className="flex items-start gap-2 text-xs leading-relaxed">
                          <AlertTriangle
                            className="mt-0.5 size-4 shrink-0"
                            aria-hidden="true"
                          />
                          <span>
                            <span className="font-semibold">
                              Save this edit link now.
                            </span>{" "}
                            It is the only way to change or pause this code
                            later — there is no account and no way to recover
                            it.
                          </span>
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          onClick={resetForNewCode}
                          data-ocid="qr.create_another_button"
                        >
                          Create another
                        </Button>
                        <Button
                          type="button"
                          className="flex-1"
                          asChild
                          data-ocid="qr.manage_link"
                        >
                          <Link
                            to="/manage/$token"
                            params={{ token: created.editToken }}
                          >
                            Manage this code
                            <ArrowRight aria-hidden="true" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="lg"
                      className="mt-5 w-full"
                      onClick={handleCreate}
                      disabled={createLink.isPending || !previewable}
                      data-ocid="qr.create_link_button"
                    >
                      {createLink.isPending ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Download aria-hidden="true" />
                      )}
                      {createLink.isPending ? "Creating link…" : "Create link"}
                    </Button>
                  )}
                </div>
              </aside>
            </div>
          </div>
        </div>
      </main>
      <footer className="border-t border-border bg-card px-4 py-5 sm:px-6">
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} StudyForge
        </p>
      </footer>
    </div>
  );
}
