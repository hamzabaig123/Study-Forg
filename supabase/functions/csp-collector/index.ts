// StudyForge CSP collector — where the page's own policy says what it blocked.
//
// The Content-Security-Policy this app ships is generated from
// `src/frontend/src/lib/security/contentSecurityPolicy.ts` and names seven origins
// the browser talks to on the user's behalf. A policy that refuses one of them
// fails silently: the AI Studio stops answering, or a PDF stops parsing, and the
// only trace is a console line in a stranger's tab. `report-to` in the header
// policy points at this function, so the refusal arrives as a row in
// `csp_violation` that the owner can read in the SQL editor.
//
// Deploy (needs the Supabase CLI, run from the repo root):
//   supabase functions deploy csp-collector --project-ref <ref> --no-verify-jwt
//   `--no-verify-jwt` is not a shortcut here: the browser's report POST carries no
//   Authorization header at all — the Reporting API sends a CORS-safelisted
//   request with no credentials — so with the platform's JWT check left on, the
//   gateway answers 401 before this handler runs and every real violation is lost
//   while the table still reads as "nothing is blocked". The other two functions
//   are deployed the same way and verify the caller themselves; this one has no
//   caller to verify, which is why its bounds live in migration 0015 instead.
//   migration 0015_csp_violation_reports.sql must be applied first — without it
//   the RPC below 404s and every report is dropped, which looks identical to a
//   policy that blocks nothing.
//   optional: APP_ORIGINS=<comma-separated origins> — the browsers allowed to
//   post here. Unset, the list below is used.
//
// Deliberately **not** authenticated: a violation is reported by whoever meets
// it, including a signed-out visitor on `/r/:code`, and a collector that requires
// a session cannot see the pages where an anonymous page breaks. The reports it
// accepts are therefore untrusted input, and the design assumes a caller who
// forges them: no visitor-identifying field is forwarded, the body is capped while
// it streams, the array is truncated, and migration 0015 bounds both the batch and
// the table. `SUPABASE_SERVICE_ROLE_KEY` is injected by the runtime and used for
// exactly one call — the `record_csp_violations` RPC — and never reaches a reply.
// No imports: remote module specifiers keep the deployed bundle from booting.

/**
 * Browsers allowed to post reports here.
 *
 * `APP_ORIGINS` is a comma-separated list of exact origins — scheme, host and
 * optional port, no path and no trailing slash — so a preview deployment can
 * admit itself without a code change. The default is the four origins this app
 * is actually served from. `http://localhost:5173` is one of them because `pnpm
 * dev` runs against the live project and a dev server is exactly where a CSP
 * regression shows up first.
 *
 * This is the same list the other two functions carry, copied rather than shared:
 * each function deploys alone and imports nothing, and one module holding the
 * allowlist would have to be published to every deploy.
 */
const DEFAULT_ORIGINS = [
  "https://study-forg-frontend-100.vercel.app",
  "https://study-forg.app",
  "https://www.study-forg.app",
  "http://localhost:5173",
];

function allowedOrigins(): ReadonlySet<string> {
  const configured = (Deno.env.get("APP_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter((value) => value !== "");
  return new Set(configured.length > 0 ? configured : DEFAULT_ORIGINS);
}

/**
 * The CORS headers for one request.
 *
 * `Access-Control-Allow-Origin` is the request's own origin when that origin is
 * allowlisted, and absent otherwise — never `*`, for the same reason the other
 * two functions stopped using it. Here it matters less than there: a CSP report
 * is sent by the browser as a CORS-safelisted `no-cors` POST, so the sender never
 * reads the reply whatever this says. The Origin check below is what does the
 * work, and it is a *browser* filter: a caller with no `Origin` at all (curl, a
 * script) is not making a cross-site request, is not gated here, and is stopped
 * by the table's bounds instead. Saying so out loud is the honest version of
 * "this endpoint is public".
 *
 * The value depends on the header that asked, and an isolate serves several
 * requests at once, so this is a function of the request rather than a constant.
 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = (request.headers.get("origin") ?? "").trim();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin !== "" && allowedOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/**
 * A report batch is a handful of small objects, so 32 KB is generous.
 *
 * `request.json()` buffers the whole body before anything looks at its length,
 * which makes a cap read afterwards a measurement taken after the memory is
 * already spent — and `originalPolicy`, a field this function discards, is
 * legitimately tens of KB per report. So the size is checked per chunk and the
 * stream is cancelled the moment the cap is crossed.
 */
const MAX_BODY_BYTES = 32 * 1024;

async function readCappedText(
  request: Request,
): Promise<{ tooLarge: true } | { tooLarge: false; text: string }> {
  const declared = Number(request.headers.get("content-length") ?? "");
  // A lie here only costs the per-chunk check; an honest header short-circuits it.
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { tooLarge: true };
  }
  const reader = request.body?.getReader();
  if (!reader) return { tooLarge: false, text: "" };
  const decoder = new TextDecoder();
  let text = "";
  let received = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    const value = next.value;
    if (!value) continue;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel();
      return { tooLarge: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  return { tooLarge: false, text: text + decoder.decode() };
}

/** Reports beyond this are dropped rather than forwarded. */
const MAX_REPORTS_PER_BATCH = 20;
/** Each forwarded string is clamped before it leaves the isolate. */
const MAX_FIELD_CHARS = 512;

/**
 * The fields worth recording, and nothing else.
 *
 * A CSP report also carries `user_agent` (a fingerprint), `originalPolicy` (a
 * copy of the policy, which this repository already has) and the full blocked and
 * document URLs (whose paths are somebody's study documents). Dropping them here
 * means a bug in the SQL's normalisation cannot turn this endpoint into a
 * visitor-log collector.
 */
function toForwarded(reports: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const item of reports.slice(0, MAX_REPORTS_PER_BATCH)) {
    if (item === null || typeof item !== "object") continue;
    const report = item as Record<string, unknown>;
    const kept: Record<string, string> = {};
    for (const field of [
      "effectiveDirective",
      "violatedDirective",
      "blockedURL",
      "originalURL",
      "url",
      "documentURL",
      "disposition",
    ]) {
      const value = report[field];
      if (typeof value === "string") {
        kept[field] = value.slice(0, MAX_FIELD_CHARS);
      }
    }
    if (Object.keys(kept).length > 0) out.push(kept);
  }
  return out;
}

/**
 * File the batch, and say nothing about how it went.
 *
 * The reply is `204` whether the RPC succeeded, 404ed because 0015 is not
 * applied, or threw. A caller who forges reports gains nothing from learning
 * which, and a browser cannot read a `no-cors` reply anyway. Failures are logged
 * without the payload: the payload is what a visitor's page URL is made of.
 */
async function forward(reports: unknown[]): Promise<void> {
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (baseUrl === "" || serviceKey === "" || reports.length === 0) return;
  try {
    const res = await fetch(`${baseUrl}/rest/v1/rpc/record_csp_violations`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_reports: reports }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`csp collector: the RPC answered ${res.status}`);
    }
  } catch (cause) {
    console.error(
      `csp collector: could not reach the database (${
        cause instanceof Error ? cause.message : String(cause)
      })`,
    );
  }
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  const origin = (request.headers.get("origin") ?? "").trim();
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: cors });
  }
  // A browser on a page this app does not serve is refused before its body is
  // read. It cannot make the app's own policy misreport, and it has no reason to
  // be posting here at all.
  if (origin !== "" && !allowedOrigins().has(origin)) {
    return new Response(null, { status: 403, headers: cors });
  }

  const read = await readCappedText(request);
  if (read.tooLarge) {
    return new Response(null, { status: 413, headers: cors });
  }
  let parsed: unknown;
  try {
    // No content-type check: the Reporting API posts a CORS-safelisted
    // `text/plain` body, so requiring JSON would reject every real report.
    parsed = JSON.parse(read.text);
  } catch {
    return new Response(null, { status: 400, headers: cors });
  }
  const reports = toForwarded(
    Array.isArray(parsed) ? parsed : [parsed],
  );
  await forward(reports);
  return new Response(null, { status: 204, headers: cors });
});
