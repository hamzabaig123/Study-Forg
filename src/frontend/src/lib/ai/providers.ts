/**
 * Model providers for AI Studio.
 *
 * Extraction runs in the browser against a key the user pastes — there is no
 * server-side AI in this fork, so a key is what makes image and scanned-PDF
 * reading possible. Without one the studio falls back to the offline parser.
 * The storage keys are the ones `clearDeviceCache()` already erases, so "Clear
 * local data" removes them too.
 *
 * Each provider offers several models: a fixed list for Gemini, and live lists
 * for OpenRouter (its free tier) and Ollama (what is installed locally), both
 * of which change without warning.
 */

import type { DocumentImage } from "@/lib/ai/document";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/localStore";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_CONFIGURED,
  SUPABASE_URL,
  selectDataBackend,
} from "@/lib/supabase/env";

export type ProviderId = "gemini" | "openRouter" | "ollama" | "serverProxy";

export interface ModelOption {
  /** The id sent in the request. */
  id: string;
  label: string;
  /** Reads images as well as text. A text-only model cannot see a scan. */
  vision: boolean;
}

export interface Provider {
  id: ProviderId;
  name: string;
  /** Used until the reviewer picks another model. */
  defaultModel: string;
  /** Offered in the picker, and kept as the fallback when a live list fails. */
  models: ModelOption[];
  /** True when `listModels()` reads the catalogue from the provider itself. */
  liveModels: boolean;
  /** False for Ollama: a local server needs no key. */
  requiresKey: boolean;
  keyPlaceholder: string;
  keyPage: string;
  /** Where the key is kept, or null for a provider that takes none. */
  storageKey: string | null;
}

/**
 * Ordered by what actually answers, not by release date: 3.8 is newest but has
 * been returning "high demand" for weeks, so it sits last rather than being
 * the first thing a run walks through.
 */
const GEMINI_MODELS: ModelOption[] = [
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", vision: true },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", vision: true },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", vision: true },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    vision: true,
  },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", vision: true },
];

/**
 * Only the models that were free and multimodal when this was written. The
 * picker replaces it with OpenRouter's live free list; this survives a failure.
 */
const OPENROUTER_MODELS: ModelOption[] = [
  {
    id: "qwen/qwen3.8-27b:free",
    label: "Qwen: Qwen3.8 27B (free)",
    vision: true,
  },
  {
    id: "google/gemma-4-31b-it:free",
    label: "Google: Gemma 4 31B (free)",
    vision: true,
  },
  {
    id: "dots-studio/dots-3-note-preview:free",
    label: "Dots Studio: Dots3-Note Preview (free)",
    vision: true,
  },
  {
    id: "thinkingmachines/inkling:free",
    label: "Thinking Machines: Inkling (free)",
    vision: true,
  },
];

const OLLAMA_MODELS: ModelOption[] = [
  { id: "qwen2.5vl:7b", label: "qwen2.5vl:7b", vision: true },
  { id: "llama3.2-vision:11b", label: "llama3.2-vision:11b", vision: true },
];

export const OLLAMA_ORIGIN = "http://localhost:11434";

export const PROVIDERS: Provider[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    // 3.8 is newest but answers 503 "high demand" for long stretches, which
    // would cost the first page of every run a retry and a step-over.
    defaultModel: "gemini-3.7-flash",
    models: GEMINI_MODELS,
    liveModels: false,
    requiresKey: true,
    keyPlaceholder: "AIza…",
    keyPage: "https://aistudio.google.com/app/apikey",
    storageKey: "studyforge.ai.gemini_key",
  },
  {
    id: "openRouter",
    name: "OpenRouter",
    defaultModel: "qwen/qwen3.8-27b:free",
    models: OPENROUTER_MODELS,
    liveModels: true,
    requiresKey: true,
    keyPlaceholder: "sk-or-v1-…",
    keyPage: "https://openrouter.ai/keys",
    storageKey: "studyforge.ai.openrouter_key",
  },
  {
    id: "ollama",
    name: "Ollama",
    defaultModel: "qwen2.5vl:7b",
    models: OLLAMA_MODELS,
    liveModels: true,
    requiresKey: false,
    keyPlaceholder: "",
    keyPage: "https://ollama.com/download",
    storageKey: null,
  },
];

const PREFERENCE_KEY = "studyforge.ai.provider";

/**
 * The Supabase Edge Function `supabase/functions/ai-proxy` reads pages with
 * the project's own stored keys, so a reviewer needs no key of their own. It
 * only exists when a configured Supabase project actually serves the app —
 * on the mock or the canister there is no function to call.
 */
export const SERVER_PROXY_AVAILABLE =
  SUPABASE_CONFIGURED && selectDataBackend() === "supabase";

const SERVER_PROXY: Provider = {
  id: "serverProxy",
  name: "Server proxy",
  defaultModel: "gemini-3.7-flash",
  models: [...GEMINI_MODELS, ...OPENROUTER_MODELS],
  liveModels: false,
  requiresKey: false,
  keyPlaceholder: "",
  keyPage: "",
  storageKey: null,
};

/** The providers the engine dialog offers: the three local ones, plus the proxy when the project has one. */
export function visibleProviders(): Provider[] {
  return SERVER_PROXY_AVAILABLE ? [...PROVIDERS, SERVER_PROXY] : PROVIDERS;
}

/** Per-provider model choice, stored as one JSON record. */
const MODEL_KEY = "studyforge.ai.model";

/** Chosen when the reviewer wants the rule-based parser even though a key exists. */
export const OFFLINE_CHOICE = "offline";

export type ProviderChoice = ProviderId | typeof OFFLINE_CHOICE;

export function findProvider(
  id: ProviderId | null | undefined,
): Provider | null {
  if (!id) return null;
  if (id === "serverProxy") return SERVER_PROXY_AVAILABLE ? SERVER_PROXY : null;
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/**
 * Where a provider key is allowed to live, and why the default is the tab.
 *
 * A key in `localStorage` is plaintext, readable by every script on this
 * origin, and it survives the tab, the browser session and — on a shared or
 * borrowed machine — the person who typed it. Encrypting it fixes nothing: the
 * page has to be able to decrypt it without asking anybody, so any injected
 * script can too. The only control that is real is how long the value lives.
 *
 * So a key is kept in `sessionStorage` — dropped when the tab closes — unless
 * the reviewer ticks "keep on this device" per provider, which is the honest
 * name for accepting the trade. `readKey` checks the session store first, so a
 * session key always wins over an older device copy of the same provider.
 */
type KeyStore = "session" | "device";

/** Where a saved key actually ended up. `none` means it was cleared. */
export type KeyPersistence = "session" | "device" | "none";

/** False on an insecure origin, where a persisted key crosses a network too. */
function deviceStorageAllowed(): boolean {
  return globalThis.isSecureContext !== false;
}

function sessionRead(storageKey: string): string {
  try {
    return globalThis.sessionStorage?.getItem(storageKey)?.trim() ?? "";
  } catch {
    // A blocked or unavailable session store is not a reason to lose the write
    // to the device store the reviewer explicitly asked for.
    return "";
  }
}

function sessionWrite(storageKey: string, value: string): void {
  try {
    if (value) globalThis.sessionStorage?.setItem(storageKey, value);
    else globalThis.sessionStorage?.removeItem(storageKey);
  } catch {
    // Private-browsing Safari throws on setItem; the key stays in memory for
    // this run through the caller's own state.
  }
}

function readKey(storageKey: string): string {
  return sessionRead(storageKey) || (safeGetItem(storageKey)?.trim() ?? "");
}

export function storedKeys(): Record<ProviderId, string> {
  const keys = {} as Record<ProviderId, string>;
  for (const provider of PROVIDERS) {
    keys[provider.id] = provider.storageKey ? readKey(provider.storageKey) : "";
  }
  return keys;
}

export function preferredChoice(): ProviderChoice | null {
  const raw = safeGetItem(PREFERENCE_KEY);
  if (raw === OFFLINE_CHOICE) return OFFLINE_CHOICE;
  if (raw === "serverProxy")
    return SERVER_PROXY_AVAILABLE ? "serverProxy" : null;
  return PROVIDERS.some((provider) => provider.id === raw)
    ? (raw as ProviderId)
    : null;
}

export function setPreferredChoice(choice: ProviderChoice | null): void {
  if (choice) safeSetItem(PREFERENCE_KEY, choice);
  else safeRemoveItem(PREFERENCE_KEY);
}

function readModelChoices(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MODEL_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const choices: Record<string, string> = {};
    for (const [id, model] of Object.entries(parsed)) {
      if (typeof model === "string" && model.trim()) choices[id] = model.trim();
    }
    return choices;
  } catch {
    return {};
  }
}

/** The model a provider run will use: the reviewer's choice, else the default. */
export function savedModel(id: ProviderId): string {
  return readModelChoices()[id] ?? findProvider(id)?.defaultModel ?? "";
}

export function setSavedModel(id: ProviderId, model: string): void {
  const trimmed = model.trim();
  if (!trimmed) return;
  const choices = readModelChoices();
  choices[id] = trimmed;
  safeSetItem(MODEL_KEY, JSON.stringify(choices));
}

/**
 * Store a provider key, or clear it when `key` is empty.
 *
 * `persist` asks for the device store; the return value is where the value
 * actually landed, so the dialog can report that instead of assuming an
 * insecure origin honoured the tick. Whichever store takes the key, the other
 * is cleared: one provider has one key, and a stale second copy reading as the
 * live one is how a "removed" key comes back.
 */
export function saveKey(
  id: ProviderId,
  key: string,
  persist = false,
): KeyPersistence {
  const provider = findProvider(id);
  if (!provider?.storageKey) return "none";
  const trimmed = key.trim();
  if (!trimmed) {
    sessionWrite(provider.storageKey, "");
    safeRemoveItem(provider.storageKey);
    return "none";
  }
  const store: KeyStore =
    persist && deviceStorageAllowed() ? "device" : "session";
  if (store === "device") {
    safeSetItem(provider.storageKey, trimmed);
    sessionWrite(provider.storageKey, "");
  } else {
    sessionWrite(provider.storageKey, trimmed);
    safeRemoveItem(provider.storageKey);
  }
  return store;
}

/** Where the key this provider will actually use is being kept right now. */
export function keyPersistence(id: ProviderId): KeyPersistence {
  const provider = findProvider(id);
  if (!provider?.storageKey) return "none";
  if (sessionRead(provider.storageKey)) return "session";
  return safeGetItem(provider.storageKey)?.trim() ? "device" : "none";
}

export function removeKey(id: ProviderId): void {
  saveKey(id, "");
}

export interface ActiveProvider {
  provider: Provider;
  key: string;
  model: string;
}

/** True when the reviewer explicitly asked for rule-based parsing. */
export function offlineChosen(): boolean {
  return preferredChoice() === OFFLINE_CHOICE;
}

/**
 * The provider extraction will use: the saved preference when it can run (a
 * keyless provider always can), otherwise the first provider holding a key.
 * Null means offline parsing.
 *
 * Ollama is deliberately absent from the fallback: with nothing configured the
 * studio should parse offline rather than reach for a local server that may not
 * be running.
 */
export function activeProvider(): ActiveProvider | null {
  const choice = preferredChoice();
  if (choice === OFFLINE_CHOICE) return null;

  const keys = storedKeys();
  const use = (provider: Provider) => ({
    provider,
    key: keys[provider.id],
    model: savedModel(provider.id),
  });

  const preferred = findProvider(choice);
  if (preferred && (!preferred.requiresKey || keys[preferred.id])) {
    return use(preferred);
  }
  const fallback = PROVIDERS.find(
    (provider) => provider.requiresKey && keys[provider.id],
  );
  return fallback ? use(fallback) : null;
}

/** Enough to recognise a key without showing it: `AIza…abc1`. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

interface OpenRouterModelDto {
  id?: unknown;
  name?: unknown;
  architecture?: { input_modalities?: unknown };
}

interface OllamaTagsDto {
  models?: Array<{ name?: unknown }>;
}

/** Vision-capable models first: an exam page is usually an image. */
function byVisionThenLabel(models: ModelOption[]): ModelOption[] {
  return [...models].sort((a, b) =>
    a.vision === b.vision ? a.label.localeCompare(b.label) : a.vision ? -1 : 1,
  );
}

async function getJson(url: string, unreachable: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    // A bare "Failed to fetch" says nothing about what to start or fix.
    throw new Error(unreachable);
  }
  if (!response.ok) throw new Error(`${unreachable} (HTTP ${response.status})`);
  return response.json();
}

/** Every model OpenRouter serves for free, which is the point of using it. */
async function openRouterModels(): Promise<ModelOption[]> {
  const payload = (await getJson(
    "https://openrouter.ai/api/v1/models",
    "Could not load OpenRouter's model list.",
  )) as {
    data?: OpenRouterModelDto[];
  };
  const models = (payload.data ?? [])
    .filter(
      (entry) => typeof entry.id === "string" && entry.id.endsWith(":free"),
    )
    .map((entry) => {
      const modalities = Array.isArray(entry.architecture?.input_modalities)
        ? (entry.architecture?.input_modalities as unknown[])
        : [];
      return {
        id: entry.id as string,
        label:
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : (entry.id as string),
        vision: modalities.includes("image"),
      };
    });
  return byVisionThenLabel(models);
}

/** The models pulled into the local Ollama server. */
async function ollamaModels(): Promise<ModelOption[]> {
  const payload = (await getJson(
    `${OLLAMA_ORIGIN}/api/tags`,
    `Could not reach Ollama at ${OLLAMA_ORIGIN}. Start it with "ollama serve".`,
  )) as OllamaTagsDto;
  return byVisionThenLabel(
    (payload.models ?? [])
      .filter((entry) => typeof entry.name === "string" && entry.name)
      .map((entry) => ({
        id: entry.name as string,
        label: entry.name as string,
        vision: true,
      })),
  );
}

const LIST_TTL = 10 * 60 * 1000;

const listCache = new Map<ProviderId, { at: number; models: ModelOption[] }>();

/**
 * The models to offer for a provider. Live lists are cached for a short while
 * so re-opening the dialog is instant; `force` is the manual refresh.
 */
export async function listModels(
  id: ProviderId,
  force = false,
): Promise<ModelOption[]> {
  const provider = findProvider(id);
  if (!provider) return [];
  if (!provider.liveModels) return provider.models;

  const cached = listCache.get(id);
  if (!force && cached && Date.now() - cached.at < LIST_TTL)
    return cached.models;

  const models =
    id === "openRouter" ? await openRouterModels() : await ollamaModels();
  if (models.length > 0) listCache.set(id, { at: Date.now(), models });
  return models.length > 0 ? models : provider.models;
}

/** Keeps a chosen model that the live list no longer carries visible. */
export function withCurrent(
  models: ModelOption[],
  current: string,
): ModelOption[] {
  if (!current || models.some((model) => model.id === current)) return models;
  return [{ id: current, label: current, vision: true }, ...models];
}

export const EXTRACTION_INSTRUCTIONS = `You are an exam-paper parser.

From the supplied page, extract EVERY multiple-choice question and EVERY short/descriptive question-answer pair you can find. Do not summarise, do not skip, do not invent questions that are not on the page.

Reply with ONLY this JSON object:
{"items":[{"type":"mcq","question":"...","options":["...","...","...","..."],"correctAnswer":"B","explanation":"...","inferred":false,"sourcePage":1},{"type":"qa","question":"...","answer":"...","explanation":"...","inferred":false,"sourcePage":1}]}

Rules:
1. "mcq" needs at least 2 entries in "options"; "correctAnswer" is the option letter (A, B, C, D...).
2. "qa" carries no options; "answer" holds the model answer from the mark scheme or the text.
3. If the page does not mark the answer, work it out and set "inferred" to true; otherwise set it to false.
4. Keep formulas, notation, units and terminology exactly as printed.
5. Skip a question whose text is cut off rather than guessing it.
6. Return raw JSON only - no markdown fences and no commentary.`;

type ChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "high" } };

/**
 * A failure worth repeating: a busy model or a rate limit, not a bad key.
 * `retryAfterMs` is what the provider asked for, when it said anything at all.
 */
export class TransientProviderError extends Error {
  readonly retryAfterMs: number | null;

  constructor(message: string, retryAfterMs: number | null = null) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

const BUSY =
  /(high demand|overload|unavailable|temporar|rate.?limit|too many requests|busy)/i;

/** A 400 that is really a refused key, which is what Google answers with. */
const KEY_REFUSED =
  /(api key|key not valid|invalid authentication|permission)/i;

/** How many models one request may walk through, and how long it waits first. */
const MODEL_LIMIT = 4;
const BACKOFF = [500, 1500];

/** A free-tier rate limit needs a real pause, not another immediate hit. */
const RATE_LIMIT_WAIT = 6000;

/**
 * A request that hangs would otherwise stall the run forever, which is how a
 * 20-page extraction ends up taking twenty minutes.
 */
const REQUEST_TIMEOUT = 60_000;

/** Turns a dead connection or a hung request into one worth repeating. */
function networkError(cause: unknown, provider: Provider): Error {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new TransientProviderError(
      `${provider.name} did not answer within ${REQUEST_TIMEOUT / 1000} seconds.`,
    );
  }
  return new TransientProviderError(
    `Could not reach ${provider.name} over the network.`,
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function errorFor(
  response: Response,
  provider: Provider,
): Promise<Error> {
  const body = await response.text().catch(() => "");
  let detail = "";
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
    };
    detail =
      (typeof parsed.error === "string"
        ? parsed.error
        : parsed.error?.message) ??
      parsed.message ??
      "";
  } catch {
    detail = body.slice(0, 200).trim();
  }
  detail = detail.trim();

  // Google rejects a bad key with 400 "API key not valid", OpenRouter with
  // 401, so the status alone does not identify a key problem.
  const keyRefused =
    response.status === 401 ||
    response.status === 403 ||
    (response.status === 400 && KEY_REFUSED.test(detail));
  if (keyRefused) {
    return new Error(
      `${detail || "This key was refused"} — StudyForge cannot use this ${provider.name} key. Create a fresh one at ${provider.keyPage} and paste it into the engine dialog.`,
    );
  }
  if (response.status === 429 || response.status >= 500 || BUSY.test(detail)) {
    // A rate limit says how long to wait; without that number a second request
    // fired a second later just burns the same window.
    const asked = Number(response.headers?.get?.("retry-after") ?? "");
    const retryAfterMs =
      Number.isFinite(asked) && asked > 0
        ? Math.min(asked * 1000, 20_000)
        : response.status === 429
          ? RATE_LIMIT_WAIT
          : null;
    return new TransientProviderError(
      detail || `${provider.name} is busy (HTTP ${response.status}).`,
      retryAfterMs,
    );
  }
  return new Error(detail || `${provider.name} request failed.`);
}

/**
 * The models to try: the chosen one first, then what the provider offers, with
 * anything this run already watched fail pushed to the end. A model that is
 * rate limited stays in the list — later pages may be in a new window — but it
 * is no longer the first thing every page hits.
 */
function modelOrder(
  provider: Provider,
  chosen: string,
  busy?: Set<string>,
): string[] {
  const known = listCache.get(provider.id)?.models ?? provider.models;
  const ids = [chosen, ...known.map((model) => model.id)];
  const unique = [...new Set(ids.filter(Boolean))];
  if (!busy || busy.size === 0) return unique.slice(0, MODEL_LIMIT);
  const free = unique.filter((model) => !busy.has(model));
  const tried = unique.filter((model) => busy.has(model));
  return [...free, ...tried].slice(0, MODEL_LIMIT);
}

/**
 * Reads a success body without letting a malformed one escape as a parse error.
 * Gemini answers an overloaded model with HTTP 200 and no body at all, which
 * has to be retried like any other busy reply.
 */
async function readJson(
  response: Response,
  provider: Provider,
): Promise<unknown> {
  const body = await response.text();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new TransientProviderError(
      body.trim()
        ? `${provider.name} replied with something that is not JSON.`
        : `${provider.name} replied with an empty body.`,
    );
  }
}

async function callGemini(
  key: string,
  model: string,
  text: string,
  images: DocumentImage[],
  provider: Provider,
): Promise<string> {
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = images.map((image) => ({
    inlineData: { mimeType: image.mimeType, data: image.base64 },
  }));
  parts.push({ text: `${EXTRACTION_INSTRUCTIONS}\n\n${text}` });

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The key goes in a header, never in `?key=`: a URL is logged by
          // proxies, extensions and the provider's own access logs, a header
          // is not.
          "x-goog-api-key": key,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
      },
    );
  } catch (cause) {
    throw networkError(cause, provider);
  }
  if (!response.ok) throw await errorFor(response, provider);

  const payload = (await readJson(response, provider)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const candidate = payload.candidates?.[0]?.content?.parts;
  const reply = candidate
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  // A safety filter or an overloaded endpoint answers with no text at all.
  if (!reply) throw new TransientProviderError("Gemini returned no text.");
  return reply;
}

interface ChatRequest {
  endpoint: string;
  key: string;
  model: string;
  headers?: Record<string, string>;
  /**
   * OpenRouter's free models advertise `structured_outputs`, not
   * `response_format`, and reject a request that asks for it, so only Ollama
   * is told to answer in JSON: the prompt already demands raw JSON and
   * `parseModelResponse` repairs what comes back.
   */
  jsonMode?: boolean;
  /** Wraps a connection failure, e.g. an Ollama server that is not running. */
  offlineMessage?: string;
}

async function callChatCompletions(
  request: ChatRequest,
  text: string,
  images: DocumentImage[],
  provider: Provider,
): Promise<string> {
  const content: ChatContent[] = images.map((image) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${image.mimeType};base64,${image.base64}`,
      detail: "high" as const,
    },
  }));
  content.push({ type: "text", text: `${EXTRACTION_INSTRUCTIONS}\n\n${text}` });

  let response: Response;
  try {
    response = await fetch(request.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(request.key
          ? { Authorization: `Bearer ${request.key}` }
          : undefined),
        ...request.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: "user", content }],
        temperature: 0,
        ...(request.jsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
    });
  } catch (cause) {
    if (request.offlineMessage) throw new Error(request.offlineMessage);
    throw networkError(cause, provider);
  }
  if (!response.ok) throw await errorFor(response, provider);

  const payload = (await readJson(response, provider)) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const reply = payload.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new TransientProviderError("The model returned no text.");
  return reply;
}

/**
 * Ask the project's own Edge Function to make the call.
 *
 * Only the session's access token is sent — never a provider key, because the
 * browser never holds one on this path. A failure replies with the upstream's
 * status and body, so `errorFor` classifies a busy model or a dead key exactly
 * as it does when the browser called the provider itself.
 *
 * `client.ts` is imported lazily: this module is loaded by the AI Studio in
 * every mode, and `@supabase/supabase-js` must stay out of the bundle the
 * mock and the canister ship.
 */
async function callServerProxy(
  model: string,
  text: string,
  images: DocumentImage[],
): Promise<string> {
  const { getSupabase } = await import("@/lib/supabase/client");
  const client = getSupabase();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error(
      "The server proxy reads pages as your signed-in account. Sign in and try again.",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/ai-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      body: JSON.stringify({ model, text, images }),
    });
  } catch (cause) {
    throw networkError(cause, SERVER_PROXY);
  }
  if (!response.ok) throw await errorFor(response, SERVER_PROXY);

  const payload = (await readJson(response, SERVER_PROXY)) as {
    text?: unknown;
  };
  const reply = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!reply)
    throw new TransientProviderError("The server proxy returned no text.");
  return reply;
}

function requestModel(
  active: ActiveProvider,
  model: string,
  text: string,
  images: DocumentImage[],
): Promise<string> {
  const { provider, key } = active;
  if (provider.id === "serverProxy") {
    return callServerProxy(model, text, images);
  }
  if (provider.id === "gemini") {
    return callGemini(key, model, text, images, provider);
  }
  if (provider.id === "openRouter") {
    return callChatCompletions(
      {
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        key,
        model,
        headers: {
          "HTTP-Referer": window.location.origin,
          "X-Title": "StudyForge AI Studio",
        },
      },
      text,
      images,
      provider,
    );
  }
  return callChatCompletions(
    {
      endpoint: `${OLLAMA_ORIGIN}/v1/chat/completions`,
      key: "",
      model,
      jsonMode: true,
      offlineMessage: `Could not reach the local server at ${OLLAMA_ORIGIN}. Start it with "ollama serve", or choose a hosted provider.`,
    },
    text,
    images,
    provider,
  );
}

export interface ProviderReply {
  text: string;
  /** The model that answered, which is not always the one asked. */
  model: string;
}

/**
 * Every model this run may use refused one unit: worth another page, worth
 * another run, and not a reason to throw away the pages that did answer.
 */
export class ProviderUnavailableError extends Error {}

/**
 * Ask the provider to structure one unit of the document.
 *
 * `text` is the instruction wrapper the model sees; for a text PDF it carries
 * the page text, for an image it is a short note that the page follows.
 *
 * Google's newest models answer 503 "high demand" for long stretches, and a
 * free-tier key answers 429 the moment several pages are asked at once, so a
 * busy model is asked twice with a wait between and then stepped over. Two
 * things are carried back to the caller because they only make sense for a
 * whole run: the model that got through, written onto `active` so later pages
 * reuse it, and the models that refused, recorded in `budget.busy` so later
 * pages start with something that is not already saturated.
 */
export async function callProvider(
  active: ActiveProvider,
  text: string,
  images: DocumentImage[],
  notify?: (message: string) => void,
  budget?: { busy: Set<string> },
): Promise<ProviderReply> {
  const order = modelOrder(active.provider, active.model, budget?.busy);
  let last: Error = new Error(`${active.provider.name} did not answer.`);

  for (const [index, model] of order.entries()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await wait(
          last instanceof TransientProviderError && last.retryAfterMs
            ? last.retryAfterMs
            : BACKOFF[attempt - 1],
        );
      }
      try {
        const reply = await requestModel(active, model, text, images);
        active.model = model;
        return { text: reply, model };
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error));
        if (!(error instanceof TransientProviderError)) throw last;
      }
    }
    budget?.busy.add(model);
    const next = order[index + 1];
    if (next) notify?.(`${model} is busy — trying ${next} instead.`);
  }

  throw new ProviderUnavailableError(
    `${active.provider.name}: ${last.message} Try again in a moment, choose another model, or parse the text offline.`,
  );
}
