import { cn } from "@/lib/utils";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

/** Error-correction levels supported by the QR spec, weakest to strongest. */
export type QrErrorLevel = "L" | "M" | "Q" | "H";

export interface QrRenderOptions {
  /** Module colour. Must stay dark for the code to scan. */
  foreground: string;
  /** Background colour. Must stay light for the code to scan. */
  background: string;
  /** Rendered edge length in pixels. */
  size: number;
  /** Error-correction level. The product default is `Q`. */
  errorLevel: QrErrorLevel;
  /** Quiet-zone width in modules. The product default is 4. */
  margin: number;
}

export const DEFAULT_QR_OPTIONS: QrRenderOptions = {
  foreground: "#1b1a2e",
  background: "#ffffff",
  size: 320,
  errorLevel: "Q",
  margin: 4,
};

/**
 * Render a QR code to an SVG string. The SVG is self-contained (no external
 * fonts or images), so it prints and downloads cleanly.
 */
export async function renderQrSvg(
  value: string,
  options: QrRenderOptions,
): Promise<string> {
  return QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: options.errorLevel,
    margin: options.margin,
    width: options.size,
    color: {
      dark: options.foreground,
      light: options.background,
    },
  });
}

/** Render a QR code to a PNG data URL at the requested pixel size. */
export async function renderQrPngDataUrl(
  value: string,
  options: QrRenderOptions,
): Promise<string> {
  return QRCode.toDataURL(value, {
    type: "image/png",
    errorCorrectionLevel: options.errorLevel,
    margin: options.margin,
    width: options.size,
    color: {
      dark: options.foreground,
      light: options.background,
    },
  });
}

/** Trigger a browser download for a data URL or blob URL. */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

interface QrCodeProps {
  /** The value to encode — the app's own short URL, never the target. */
  value: string;
  options?: Partial<QrRenderOptions>;
  className?: string;
  /** Accessible description of what the code points to. */
  label?: string;
}

/**
 * Shared QR renderer. Draws the code as an inline SVG so it stays crisp at any
 * size and can be printed directly. The surrounding well supplies the quiet
 * zone visually; `margin` also bakes it into the encoded matrix.
 */
export function QrCode({
  value,
  options,
  className,
  label = "QR code",
}: QrCodeProps) {
  const merged = useMemo<QrRenderOptions>(
    () => ({ ...DEFAULT_QR_OPTIONS, ...options }),
    [options],
  );
  const [svg, setSvg] = useState<string>("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setSvg("");
      setFailed(false);
      return;
    }
    renderQrSvg(value, merged)
      .then((markup) => {
        if (cancelled) return;
        setSvg(markup);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSvg("");
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value, merged]);

  if (!value) {
    return (
      <div
        className={cn(
          "flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-border bg-muted/40 p-6 text-center text-xs text-muted-foreground",
          className,
        )}
        data-ocid="qr.preview_empty_state"
      >
        Enter a destination URL to generate a code.
      </div>
    );
  }

  if (failed) {
    return (
      <div
        className={cn(
          "flex aspect-square w-full items-center justify-center rounded-md border border-destructive/30 bg-destructive/5 p-6 text-center text-xs text-destructive",
          className,
        )}
        data-ocid="qr.preview_error_state"
      >
        This value is too long to encode. Try a shorter URL.
      </div>
    );
  }

  return (
    <div
      className={cn("w-full [&>svg]:h-auto [&>svg]:w-full", className)}
      aria-label={label}
      data-ocid="qr.preview"
      // The markup comes from the `qrcode` encoder, not from user input.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: encoder output
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
