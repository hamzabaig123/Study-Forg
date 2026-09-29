/**
 * Cloudflare Turnstile — the check in front of the open endpoints.
 *
 * GoTrue's `security_captcha_enabled` is one dashboard switch that gates
 * sign-up, sign-in, the reset link and the re-send. With it on, every one of
 * those calls must carry a token from a widget the visitor solved, or the
 * project answers 403 — so the whole app's front door depends on this module
 * being wired, not just the register screen.
 *
 * It is configured by build environment alone: `VITE_TURNSTILE_SITE_KEY` unset
 * means no widget is fetched, no token is asked for, and every form behaves the
 * way it did before captcha existed on the project. That is why the flag is read
 * through a function rather than frozen into a module constant — the suite, and a
 * preview deploy with no key, must see the unconfigured shape.
 *
 * The script is Cloudflare's, so the CSP names `challenges.cloudflare.com` in
 * `script-src` (the widget's own script) and `frame-src` (the iframe it solves
 * in). Both are load-bearing: without the frame entry the widget renders as an
 * empty box and the form can never be submitted.
 */

const SCRIPT_HOST = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** Global the loader registers so the script can call it on load. */
const LOAD_CALLBACK = "studyForgeTurnstileLoaded";

interface TurnstileWidgetOptions {
  sitekey: string;
  theme?: "auto" | "light" | "dark";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  "timeout-callback"?: () => void;
}

interface Turnstile {
  render(container: HTMLElement, options: TurnstileWidgetOptions): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/** The site key this build was given, or `""` when captcha is off. */
export function turnstileSiteKey(): string {
  const raw = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  return raw?.trim() ?? "";
}

/** Whether any captcha surface should exist at all. */
export function captchaConfigured(): boolean {
  return turnstileSiteKey() !== "";
}

let loading: Promise<Turnstile> | null = null;

/**
 * Fetch the widget script once, and hand back the API it installs.
 *
 * `render=explicit` because the forms mount their widget after the page, which
 * is the one case Cloudflare's automatic rendering does not cover.
 */
export function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const host = window as unknown as Record<string, unknown>;
    host[LOAD_CALLBACK] = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      }
    };
    const script = document.createElement("script");
    script.src = `${SCRIPT_HOST}?onload=${LOAD_CALLBACK}&render=explicit`;
    script.async = true;
    script.defer = true;
    script.onerror = () =>
      reject(
        new Error("This browser could not reach the human check it needs."),
      );
    document.head.appendChild(script);
  });
  return loading;
}
