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
//
// The runtime injects SUPABASE_URL and SUPABASE_ANON_KEY for every edge
// function; nothing else here is required configuration. No imports: remote
// module specifiers keep the deployed bundle from booting, and this function
// needs nothing but fetch.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** A unit is one page's text or image plus the extraction prompt — bound it anyway. */
const MAX_BODY_BYTES = 8_000_000;

/** One upstream at a time gets ~30s; 55s is under the platform's wall clock. */
const UPSTREAM_TIMEOUT_MS = 55_000;

/** Per-account sliding window. Best effort: one value per edge-function isolate. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(user: string): boolean {
  const now = Date.now();
  const recent = (hits.get(user) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(user, recent);
    return true;
  }
  recent.push(now);
  hits.set(user, recent);
  // A visitor that stops never evicts their own entry.
  if (hits.size > 1000) hits.clear();
  return false;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
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
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (request.method !== "POST") {
    return json({ error: { message: "Use POST." } }, 405);
  }

  // Supabase's gateway has already checked the JWT signature; a live /auth/v1/user
  // lookup makes that this is a real session and gives the id the rate limit
  // counts by. Plain fetch, no client library: remote imports keep the bundle
  // from booting, and one GET needs no SDK.
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const user = bearer ? await getAuthUser(bearer) : null;
  if (!user) {
    return json({ error: { message: "Sign in to use the server proxy." } }, 401);
  }
  if (rateLimited(user.id)) {
    return json(
      { error: { message: "Too many requests — wait a minute." } },
      429,
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: { message: "Request body is too large." } }, 413);
  }
  let payload: { model?: unknown; text?: unknown; images?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: { message: "Body is not JSON." } }, 400);
  }
  const model = typeof payload.model === "string" ? payload.model : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  const images = Array.isArray(payload.images)
    ? (payload.images as ImagePart[])
    : [];
  if (!model || !text) {
    return json({ error: { message: "model and text are required." } }, 400);
  }

  let upstream: Awaited<ReturnType<typeof callUpstream>>;
  try {
    upstream = await callUpstream(model, text, images);
  } catch (cause) {
    // A timeout or a dead connection is worth repeating — the client's own
    // busy-model walk treats it exactly that way.
    return json(
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
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return json({ text: upstream.text });
});
