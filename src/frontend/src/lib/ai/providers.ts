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

export type ProviderId = "gemini" | "openRouter" | "ollama";

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

const GEMINI_MODELS: ModelOption[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", vision: true },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", vision: true },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", vision: true },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", vision: true },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    vision: true,
  },
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
    defaultModel: "gemini-3.8-flash",
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

/** Per-provider model choice, stored as one JSON record. */
const MODEL_KEY = "studyforge.ai.model";

/** Chosen when the reviewer wants the rule-based parser even though a key exists. */
export const OFFLINE_CHOICE = "offline";

export type ProviderChoice = ProviderId | typeof OFFLINE_CHOICE;

export function findProvider(
  id: ProviderId | null | undefined,
): Provider | null {
  if (!id) return null;
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function storedKeys(): Record<ProviderId, string> {
  const keys = {} as Record<ProviderId, string>;
  for (const provider of PROVIDERS) {
    keys[provider.id] = provider.storageKey
      ? (localStorage.getItem(provider.storageKey)?.trim() ?? "")
      : "";
  }
  return keys;
}

export function preferredChoice(): ProviderChoice | null {
  const raw = localStorage.getItem(PREFERENCE_KEY);
  if (raw === OFFLINE_CHOICE) return OFFLINE_CHOICE;
  return PROVIDERS.some((provider) => provider.id === raw)
    ? (raw as ProviderId)
    : null;
}

export function setPreferredChoice(choice: ProviderChoice | null): void {
  if (choice) localStorage.setItem(PREFERENCE_KEY, choice);
  else localStorage.removeItem(PREFERENCE_KEY);
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
  localStorage.setItem(MODEL_KEY, JSON.stringify(choices));
}

export function saveKey(id: ProviderId, key: string): void {
  const provider = findProvider(id);
  if (!provider?.storageKey) return;
  const trimmed = key.trim();
  if (trimmed) localStorage.setItem(provider.storageKey, trimmed);
  else localStorage.removeItem(provider.storageKey);
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
  if (!response.ok) throw new Error(await readError(response, unreachable));
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

async function readError(
  response: Response,
  fallback: string,
): Promise<string> {
  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string };
      message?: string;
    };
    return (
      parsed.error?.message ??
      parsed.message ??
      `${fallback} (${response.status})`
    );
  } catch {
    return `${fallback} (${response.status})`;
  }
}

async function callGemini(
  key: string,
  model: string,
  text: string,
  images: DocumentImage[],
): Promise<string> {
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = images.map((image) => ({
    inlineData: { mimeType: image.mimeType, data: image.base64 },
  }));
  parts.push({ text: `${EXTRACTION_INSTRUCTIONS}\n\n${text}` });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  if (!response.ok)
    throw new Error(await readError(response, "Gemini request failed"));

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const candidate = payload.candidates?.[0]?.content?.parts;
  const reply = candidate
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!reply) throw new Error("Gemini returned an empty reply.");
  return reply;
}

interface ChatRequest {
  endpoint: string;
  key: string;
  model: string;
  headers?: Record<string, string>;
  /** Wraps a connection failure, e.g. an Ollama server that is not running. */
  offlineMessage?: string;
}

async function callChatCompletions(
  request: ChatRequest,
  text: string,
  images: DocumentImage[],
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
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: "user", content }],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
  } catch {
    if (request.offlineMessage) throw new Error(request.offlineMessage);
    throw new Error(`Could not reach ${request.endpoint}.`);
  }
  if (!response.ok)
    throw new Error(await readError(response, "Request failed"));

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const reply = payload.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("The model returned an empty reply.");
  return reply;
}

/**
 * Ask the provider to structure one unit of the document.
 *
 * `text` is the instruction wrapper the model sees; for a text PDF it carries
 * the page text, for an image it is a short note that the page follows.
 */
export async function callProvider(
  active: ActiveProvider,
  text: string,
  images: DocumentImage[],
): Promise<string> {
  const { provider, key, model } = active;
  if (provider.id === "gemini") {
    return callGemini(key, model, text, images);
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
    );
  }
  return callChatCompletions(
    {
      endpoint: `${OLLAMA_ORIGIN}/v1/chat/completions`,
      key: "",
      model,
      offlineMessage: `Could not reach the local server at ${OLLAMA_ORIGIN}. Start it with "ollama serve", or choose a hosted provider.`,
    },
    text,
    images,
  );
}
