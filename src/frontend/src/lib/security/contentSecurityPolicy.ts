/**
 * The production Content-Security-Policy.
 *
 * Two things about this project decide its shape:
 *
 * - **The host serves files and nothing else.** `caffeine.toml` describes an
 *   asset build (`pnpm build` → `dist`), and there is no header configuration
 *   surface in it, so the policy the page itself declares can only travel as a
 *   `<meta>` tag. That is a real limitation, not a formality: `frame-ancestors`
 *   is ignored in a meta, and a meta cannot report violations. `securityHeaders()`
 *   below is the other half — the directives a host must send are generated from
 *   this same source rather than retyped, and `pnpm security:headers` writes them
 *   into `vercel.json`, the one place the deployed host actually reads.
 * - **The browser is the backend.** AI provider calls, the reminder email and
 *   the PDF engine all leave from this page, so the origin list is not a
 *   formality either: every one of them has to be named for the app to keep
 *   working, and anything not named is a data path that no longer exists.
 *
 * `VITE_SUPABASE_URL` is folded in as an exact origin when the build knows it,
 * because the policy is generated at build time anyway; without one, the
 * wildcard is the fallback that keeps a preview deployable.
 */

/** Origins this page has to be able to talk to, besides its own host. */
const OUTBOUND_ORIGINS = [
  // The IC boundary nodes a canister-mode frontend calls through. agent-js is
  // bundled, so no remote script — but its HTTP calls leave the page, and a
  // canister-mode deploy with `env.json` filled in is exactly the build this
  // origin is for; on Supabase-only deploys it simply stays unused.
  "https://icp0.io",
  // Gemini and OpenRouter are called straight from the browser (see
  // `lib/ai/providers.ts`); the canister's AI methods are not wired to anything.
  "https://generativelanguage.googleapis.com",
  "https://openrouter.ai",
  // pdf.js is loaded from a CDN rather than bundled, so the app boots without a
  // PDF engine it may never use. The script tag also pins an SRI digest.
  "https://cdnjs.cloudflare.com",
  // A local Ollama, which is the only offline model path the studio offers.
  // Deliberately in the shipped policy, not a dev-only addition: the browser on
  // the deployed page is what reaches the user's own Ollama, and a https page
  // may talk to `localhost` (it counts as a potentially trustworthy origin), so
  // dropping this line would remove a supported provider rather than close a
  // hole — a script already running on this origin could fetch the port
  // whatever the policy says.
  "http://localhost:11434",
  // The breach corpus `breachReason()` in `lib/passwordPolicy.ts` queries. The
  // request carries five hex characters of a SHA-1 digest, never the password,
  // so this origin learns nothing an attacker could turn into a credential.
  "https://api.pwnedpasswords.com",
  // Vercel Speed Insights collects performance metrics and sends vitals.
  "https://vitals.vercel-insights.com",
  // Vercel Web Analytics: the same host both serves the pageview script (it is in
  // `script-src` too) and receives the events, so one origin covers both halves.
  "https://va.vercel-scripts.com",
];

/**
 * The project's own origin, when the build was given a URL worth trusting.
 *
 * `https://*.supabase.co` would cover every project on the platform, which is
 * one more tenant's host than this app needs reachable, so everything that names
 * the project — the policy's `connect-src` and the violation collector below —
 * goes through here and gets the exact origin or nothing.
 */
function projectOrigin(projectUrl?: string): string | null {
  if (!projectUrl) return null;
  try {
    const url = new URL(projectUrl);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.origin;
    }
  } catch {
    // A malformed value is not worth failing a build over: the wildcard still
    // lets the app run, and the config itself reports the problem.
  }
  return null;
}

function supabaseOrigin(projectUrl?: string): string {
  return projectOrigin(projectUrl) ?? "https://*.supabase.co";
}

export interface PolicyOptions {
  /** `VITE_SUPABASE_URL` as the build saw it. */
  supabaseUrl?: string;
}

/** The name both `report-to` spellings use for the collector. */
export const CSP_REPORT_ENDPOINT = "csp";

/**
 * Where a violation report is posted, or `null` when the build has no project.
 *
 * The collector is an Edge Function on the same Supabase origin the policy
 * already allows, so this adds no reachable host — it reuses the one entry that
 * is already there. Without a project URL there is nothing to name, and a policy
 * that reports to a group nobody declared is a console error on every page load
 * and no report at all, so the absence is the honest answer rather than a guess.
 */
function collectorEndpoint(projectUrl?: string): string | null {
  const origin = projectOrigin(projectUrl);
  return origin === null ? null : `${origin}/functions/v1/csp-collector`;
}

/**
 * The policy as one header-shaped string.
 *
 * Notes on the directives that are *not* obvious:
 *
 * - `script-src` carries no `'unsafe-inline'`, which is why the theme bootstrap
 *   in `index.html` is a `<script src>` file rather than a block.
 * - `style-src` does need it: inline `style` attributes are all over the layout
 *   (`env(safe-area-inset-*)`, recharts' injected `<style>`, the theme's
 *   `colorScheme`), and `style-src` inline cannot execute script.
 * - `img-src` needs `data:` and `blob:` for the QR preview and the PDF/export
 *   previews, both of which are generated in this page.
 * - `frame-src` exists for one frame: Cloudflare's Turnstile challenge
 *   (`lib/turnstile.ts`), which solves inside an iframe it injects. `default-src
 *   'self'` alone would refuse it, and the widget would render as an empty box
 *   with the form shut behind it. Listing the host unconditionally is the
 *   cheaper mistake — a project that never switched captcha on fetches nothing
 *   from it, while a policy that omits it breaks sign-in the moment the switch
 *   is thrown without a redeploy of the policy.
 * - `object-src 'none'` and `base-uri 'none'` close two old XSS helpers that
 *   nothing in the app uses; `form-action 'none'` is safe because every form in
 *   the app is submitted by `onSubmit` with the default prevented.
 */
export function contentSecurityPolicy(options: PolicyOptions = {}): string {
  const connectSrc = [
    "'self'",
    supabaseOrigin(options.supabaseUrl),
    ...OUTBOUND_ORIGINS,
  ].join(" ");

  return [
    "default-src 'self'",
    "base-uri 'none'",
    `connect-src ${connectSrc}`,
    "font-src 'self'",
    "form-action 'none'",
    "frame-src 'self' https://challenges.cloudflare.com",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "script-src 'self' https://cdnjs.cloudflare.com https://challenges.cloudflare.com https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob: https://cdnjs.cloudflare.com",
  ].join("; ");
}

/**
 * The same policy with the directives a `<meta>` cannot carry.
 *
 * `frame-ancestors` is defined only for the HTTP version of CSP; a browser
 * reading it out of a meta tag ignores it. So the `<script>`-injection defence
 * ships in `index.html` either way, and this variant adds clickjacking
 * protection for whoever can send a real header.
 *
 * `report-to` joins it for the same reason and is **header-only on purpose**: the
 * endpoint it names is declared by a response header (`Reporting-Endpoints`
 * below), which a meta cannot send, so putting the directive in the tag would
 * leave every page reporting an unknown group and no report ever arriving. The
 * meta policy keeps saying nothing about violations, which is the accurate
 * description of what a meta can do.
 */
export function contentSecurityPolicyForHeaders(
  options: PolicyOptions = {},
): string {
  const parts = [contentSecurityPolicy(options), "frame-ancestors 'none'"];
  if (collectorEndpoint(options.supabaseUrl)) {
    parts.push(`report-to ${CSP_REPORT_ENDPOINT}`);
  }
  return parts.join("; ");
}

/**
 * Every response header this app wants and cannot set by itself.
 *
 * Two consumers, both generated from this function so they cannot drift:
 * `pnpm security:headers` copies the `/*` block into `vercel.json` (the file
 * Vercel actually reads), and `EMIT_HEADERS=1 pnpm build` also drops it beside
 * the bundle as `dist/_headers`, which is the name Cloudflare Pages and Netlify
 * read — and close enough to an nginx `add_header` block to copy from. It is
 * opt-in because Vercel serves every path under `dist`, and a file that host
 * cannot read is only ever a file the public can download.
 *
 * Each of these is inert until a host serves it, so shipping the file fixes
 * nothing on its own; it removes the step where whoever deploys has to invent
 * the values.
 *
 * The two reporting headers name the same URL under both spellings, because the
 * spellings cover different browser generations: `Reporting-Endpoints` is the
 * newer form (a single endpoint referenced by `report-to csp`) and `Report-To` is
 * the group form every browser that delivers CSP reports already reads. One
 * report goes to one destination; what `csp_violation.hits` counts is arriving
 * reports, not distinct violation events, and the table says so rather than
 * pretending to a precision it does not have.
 */
export function securityHeaders(options: PolicyOptions = {}): string {
  const csp = contentSecurityPolicyForHeaders(options);
  const endpoint = collectorEndpoint(options.supabaseUrl);
  const reporting = endpoint
    ? [
        `  Report-To: group="${CSP_REPORT_ENDPOINT}",max_age=10800,endpoints=[{"url":"${endpoint}","priority":1}]`,
        `  Reporting-Endpoints: ${CSP_REPORT_ENDPOINT}="${endpoint}"`,
      ].join("\n")
    : null;
  return `# Generated from src/lib/security/contentSecurityPolicy.ts by
# \`pnpm security:headers\` (\`EMIT_HEADERS=1 pnpm build\` also writes this file as
# dist/_headers).
# Edit that module, not this file. Cloudflare Pages and Netlify read this name
# verbatim; the same values belong in any other host's header config.
# Comments only appear above the rules — a host that does not document inline
# comments should still parse every line below as a path and a header.
#
# What each line is for:
#   Content-Security-Policy  the page policy, plus frame-ancestors and report-to,
#                            which a <meta> ignores (the reason for this file at
#                            all).
#   Report-To / Reporting-Endpoints  where a blocked request is reported: the
#                            csp-collector Edge Function on the project the policy
#                            already allows. Absent when the build named no
#                            project, because a report with nowhere to go is a
#                            console error instead of a signal.
#   Strict-Transport-Security  https-only from here on, for a year.
#   X-Frame-Options          the same framing refusal, for a client that reads
#                            it instead of CSP.
#   X-Content-Type-Options   no MIME sniffing on the assets this app serves.
#   Referrer-Policy          the header form of the meta tag in index.html.
#   Cross-Origin-Opener-Policy  isolates this window's document.
#   Permissions-Policy       only features the app never asks for. Camera,
#                            microphone, geolocation, payment, usb, bluetooth.
#                            Quiet on clipboard-write, notifications and
#                            display-capture on purpose: the share flow copies
#                            its link, the reminder scheduler raises
#                            notifications, and both would break.
#   Cache-Control            hashed filenames under /assets are immutable; the
#                            entry point and the service worker must be
#                            revalidated or a deploy never arrives.

/*
  Content-Security-Policy: ${csp}${reporting ? `\n${reporting}` : ""}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: no-cache

/sw.js
  Cache-Control: no-cache
`;
}
