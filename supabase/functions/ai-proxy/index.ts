// StudyForge AI proxy — the server half of the AI Studio's "Server proxy".
//
// The browser sends one extraction unit here; this function forwards it to
// Google or OpenRouter using keys held as deploy-time secrets, so a reviewer
// never pastes a key and no key ever leaves the server. Success replies are
// normalised to { text }; failure replies pass the upstream status and body
// through unchanged, because the frontend classifies a busy model, a refused
// key and a rate limit from that pair.
//
// Deploy (needs the Supabase CLI, run from the repo root):
//   supabase functions deploy ai-proxy --project-ref <ref>
//   supabase secrets set GEMINI_API_KEY=... OPENROUTER_API_KEY=... --project-ref <ref>
//   optional: APP_ORIGINS=<comma-separated origins> — the browsers allowed to
//   call this function. Unset, the list below is used; add a preview deployment
//   to it rather than editing the default.
//   SUPABASE_SERVICE_ROLE_KEY is what makes the per-account cap durable, and the
//   runtime already injects it.
//
// The runtime injects SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY for every edge function; nothing else here is
// required configuration. The service key is used for exactly one call — the
// `enforce_rate_limit` RPC that counts requests per account — and never reaches
// a reply. No imports: remote module specifiers keep the deployed bundle from
// booting, and this function needs nothing but fetch.

/**
 * Browsers allowed to call this function.
 *
 * `APP_ORIGINS` is a comma-separated list of exact origins — scheme, host and
 * optional port, no path and no trailing slash — so a preview deployment can
 * admit itself without a code change. The default is the four origins this app
 * is actually served from, which keeps the function deployable with no new
 * secret. `http://localhost:5173` is one of them: `pnpm dev` on this machine
 * runs against the live project, and a dev server that cannot reach the proxy
 * is the reason the AI Studio once looked broken.
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
 * allowlisted, and absent otherwise. It used to be `*`, and a wildcard here was
 * not merely untidy: the session token rides in the `Authorization` header, so
 * no cookie and no `Allow-Credentials` is involved, which means any page on the
 * internet could have POSTed a signed-in visitor's own token to this endpoint
 * and spent the owner's Gemini and OpenRouter keys from behind a tab they never
 * opened. Echoing the exact origin is what makes the same request need a page
 * the owner deployed.
 *
 * A request with no `Origin` — the pg_cron-style server caller, a live probe —
 * gets no CORS headers at all. That is correct rather than an oversight: CORS is
 * a rule the browser enforces on the *response*, and with no browser there is
 * no one to refuse.
 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = (request.headers.get("origin") ?? "").trim();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    // The answer depends on the header that asked, so a shared cache must not
    // serve one origin's reply to another.
    Vary: "Origin",
  };
  if (origin !== "" && allowedOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/** A unit is one page's text or image plus the extraction prompt — bound it anyway. */
const MAX_BODY_BYTES = 8_000_000;

/**
 * Read the body as text without ever holding more than `MAX_BODY_BYTES`.
 *
 * `request.text()` — and `request.json()` before it — buffers the entire payload
 * and then reports its length, which made the cap below a measurement taken
 * after the memory was already spent. A request with no `Content-Length` could
 * therefore still make the isolate allocate as much as the caller liked. This
 * checks each chunk as it lands and cancels the stream the moment the cap is
 * crossed, so the rest is never read.
 */
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

/** One upstream at a time gets ~30s; 55s is under the platform's wall clock. */
const UPSTREAM_TIMEOUT_MS = 55_000;

/**
 * Per-account request cap, counted in Postgres.
 *
 * `enforce_rate_limit` (migrations 0002/0005/0011) keeps its window in the
 * `rate_limit` table, so the count survives a cold start and reads the same in
 * every region. The guard this replaces was a `Map` inside the isolate, which
 * was neither: Supabase spreads requests across isolates and cold-starts a fresh
 * one on a burst, so N isolates admitted N x the cap and any deploy reset every
 * counter — and this endpoint spends the *owner's* money per call, so a cap that
 * resets on restart is a cap that nobody has to respect for long.
 *
 * The account id rides in the bucket name, which is what makes the count
 * per-account. The table's other half, `ip`, is this function's own egress
 * address here — identical for every caller — so keying on it would have pooled
 * every account into one window and let one abuser throttle the rest.
 */
const RATE_LIMIT = 20;
const RATE_WINDOW_SECONDS = 60;

/**
 * Ask Postgres whether this account has room for one more request.
 *
 * PostgREST turns the helper's `raise exception 'RATE_LIMITED: …'` into a
 * non-2xx whose body names it, so the marker is the only refusal this reads as
 * "wait". Everything else — no service key, no project URL, a timeout, a 404
 * because the limiter is not installed on this project — is a broken counter,
 * not a full window, and the request goes through. The AI Studio is the feature;
 * a Postgres hiccup must not turn it off.
 */
async function overRateLimit(user: string): Promise<boolean> {
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (baseUrl === "" || serviceKey === "") return false;
  try {
    const res = await fetch(`${baseUrl}/rest/v1/rpc/enforce_rate_limit`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_bucket: `ai_proxy:${user}`,
        p_max: RATE_LIMIT,
        p_window_seconds: RATE_WINDOW_SECONDS,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return false;
    const detail = await res.text().catch(() => "");
    return detail.includes("RATE_LIMITED");
  } catch {
    return false;
  }
}

/**
 * A reply that carries this request's own CORS answer.
 *
 * `cors` is a parameter rather than a module constant on purpose: the value
 * depends on who asked, and an isolate serves several of them at once.
 */
function json(
  cors: Readonly<Record<string, string>>,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const GEMINI_MODEL = /^gemini-[a-z0-9.]+$/;
/** OpenRouter ids look like "vendor/model[:free]". */
const OPENROUTER_MODEL = /^[a-z0-9._-]+\/[a-z0-9._+:-]+$/i;

interface ImagePart {
  mimeType?: unknown;
  base64?: unknown;
}

/** Rebuilds the same request shape the browser-side callers send upstream. */
async function callUpstream(
  model: string,
  text: string,
  images: ImagePart[],
): Promise<{ ok: true; text: string } | { ok: false; status: number; body: string }> {
  const inlineParts = images
    .filter(
      (image) =>
        typeof image?.mimeType === "string" &&
        typeof image?.base64 === "string" &&
        image.base64.length < 6_000_000,
    )
    .map((image) => ({
      inlineData: { mimeType: image.mimeType, data: image.base64 },
    }));

  let response: Response;
  if (GEMINI_MODEL.test(model)) {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return fail("GEMINI_API_KEY is not set on this project.");
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [
            { parts: [...inlineParts, { text }] },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
      },
    );
    const body = await response.text();
    if (!response.ok) return { ok: false, status: response.status, body };
    try {
      const parsed = JSON.parse(body) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const reply = parsed.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();
      return { ok: true, text: reply ?? "" };
    } catch {
      return fail("Gemini replied with something that is not JSON.");
    }
  }

  if (OPENROUTER_MODEL.test(model)) {
    const key = Deno.env.get("OPENROUTER_API_KEY");
    if (!key) return fail("OPENROUTER_API_KEY is not set on this project.");
    response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                ...inlineParts.map((part) => ({
                  type: "image_url",
                  image_url: {
                    url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                    detail: "high",
                  },
                })),
                { type: "text", text },
              ],
            },
          ],
          temperature: 0,
        }),
      },
    );
    const body = await response.text();
    if (!response.ok) return { ok: false, status: response.status, body };
    try {
      const parsed = JSON.parse(body) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return { ok: true, text: parsed.choices?.[0]?.message?.content?.trim() ?? "" };
    } catch {
      return fail("OpenRouter replied with something that is not JSON.");
    }
  }

  return fail(`Unsupported model: ${model}`);
}

function fail(message: string): { ok: false; status: number; body: string } {
  return {
    ok: false,
    status: 502,
    body: JSON.stringify({ error: { message } }),
  };
}

/** Resolve one bearer token to its account via GoTrue, or null when dead. */
async function getAuthUser(bearer: string): Promise<{ id: string } | null> {
  try {
    const res = await fetch(
      `${Deno.env.get("SUPABASE_URL") ?? ""}/auth/v1/user`,
      {
        headers: {
          apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          Authorization: `Bearer ${bearer}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as { id?: string } | null;
    return payload && typeof payload.id === "string" ? { id: payload.id } : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  const origin = (request.headers.get("origin") ?? "").trim();
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  // A browser that sends an Origin this app does not serve gets refused before
  // its body is read. CORS already stops that page from *reading* the reply;
  // this stops it from making the upstream call at all, which is the half that
  // costs the key owner money. A caller with no Origin (a script, a live probe)
  // is not a cross-site request and is unaffected.
  if (origin !== "" && !allowedOrigins().has(origin)) {
    return json(
      cors,
      { error: { message: "This origin may not call the proxy." } },
      403,
    );
  }
  if (request.method !== "POST") {
    return json(cors, { error: { message: "Use POST." } }, 405);
  }

  // Supabase's gateway has already checked the JWT signature; a live /auth/v1/user
  // lookup makes that this is a real session and gives the id the rate limit
  // counts by. Plain fetch, no client library: remote imports keep the bundle
  // from booting, and one GET needs no SDK.
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const user = bearer ? await getAuthUser(bearer) : null;
  if (!user) {
    return json(
      cors,
      { error: { message: "Sign in to use the server proxy." } },
      401,
    );
  }
  if (await overRateLimit(user.id)) {
    return json(
      cors,
      { error: { message: "Too many requests — wait a minute." } },
      429,
    );
  }

  const read = await readCappedText(request);
  if (read.tooLarge) {
    return json(cors, { error: { message: "Request body is too large." } }, 413);
  }
  let payload: { model?: unknown; text?: unknown; images?: unknown };
  try {
    payload = JSON.parse(read.text);
  } catch {
    return json(cors, { error: { message: "Body is not JSON." } }, 400);
  }
  const model = typeof payload.model === "string" ? payload.model : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  const images = Array.isArray(payload.images)
    ? (payload.images as ImagePart[])
    : [];
  if (!model || !text) {
    return json(
      cors,
      { error: { message: "model and text are required." } },
      400,
    );
  }

  let upstream: Awaited<ReturnType<typeof callUpstream>>;
  try {
    upstream = await callUpstream(model, text, images);
  } catch (cause) {
    // A timeout or a dead connection is worth repeating — the client's own
    // busy-model walk treats it exactly that way.
    return json(
      cors,
      {
        error: {
          message: `Could not reach the model: ${cause instanceof Error ? cause.message : String(cause)}`,
        },
      },
      504,
    );
  }
  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  return json(cors, { text: upstream.text });
});
