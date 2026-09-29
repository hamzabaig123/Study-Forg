import { captchaConfigured } from "@/lib/turnstile";
import { useCallback, useState } from "react";

/**
 * One solved check, held for the form that submits it.
 *
 * A Turnstile token is single-use and short-lived, so the screens that ask for
 * one all need the same three things: the token itself, a way to say "that one
 * is spent" after any refused attempt, and a count that makes the widget render
 * again. Repeating that per form is how one of them forgets the expiry and leaves
 * a visitor with a ticked box that the project has already refused once.
 *
 * Everything collapses to the inert shape when the build carries no site key:
 * `token` stays empty, `required` is false, and `expire` does nothing visible —
 * so a form can pass `captcha.token` to the store and disable its button on
 * `captcha.required` without knowing whether captcha exists on this project.
 */
export interface CaptchaToken {
  /** The token to send with the next request, or `""` for none. */
  token: string;
  /** Whether the form must wait for a check before it can be submitted. */
  required: boolean;
  /** Change this to make `CaptchaField` mount a fresh widget. */
  resetKey: number;
  /** What `CaptchaField` reports back; `null` means expired or refused. */
  onChange: (token: string | null) => void;
  /** Drop the spent token and ask for a new one. */
  expire: () => void;
}

export function useCaptchaToken(): CaptchaToken {
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const onChange = useCallback((next: string | null) => {
    setToken(next ?? "");
  }, []);
  const expire = useCallback(() => {
    setToken("");
    setResetKey((current) => current + 1);
  }, []);
  return {
    token,
    required: captchaConfigured() && token === "",
    resetKey,
    onChange,
    expire,
  };
}
