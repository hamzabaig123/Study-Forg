/**
 * Model providers for AI Studio.
 *
 * Extraction runs in the browser against a key the user pastes — there is no
 * server-side AI in this fork, so a key is what makes image and scanned-PDF
 * reading possible. Without one the studio falls back to the offline parser.
 * The storage keys are the ones `clearDeviceCache()` already erases, so "Clear
 * local data" removes them too.
 */

import type { DocumentImage } from "@/lib/ai/document";

export type ProviderId = "gemini" | "openRouter" | "openAi";

export interface Provider {
  id: ProviderId;
  name: string;
  model: string;
  /** Model reads images as well as text — all three here do. */
  vision: boolean;
  keyPlaceholder: string;
  keyPage: string;
  storageKey: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    model: "gemini-2.0-flash",
    vision: true,
    keyPlaceholder: "AIza…",
    keyPage: "https://aistudio.google.com/app/apikey",
    storageKey: "studyforge.ai.gemini_key",
  },
  {
    id: "openRouter",
    name: "OpenRouter",
    model: "google/gemini-2.0-flash-001",
    vision: true,
    keyPlaceholder: "sk-or-v1-…",
    keyPage: "https://openrouter.ai/keys",
    storageKey: "studyforge.ai.openrouter_key",
  },
  {
    id: "openAi",
    name: "OpenAI",
    model: "gpt-4o-mini",
    vision: true,
    keyPlaceholder: "sk-…",
    keyPage: "https://platform.openai.com/api-keys",
    storageKey: "studyforge.ai.openai_key",
  },
];

const PREFERENCE_KEY = "studyforge.ai.provider";

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
    keys[provider.id] = localStorage.getItem(provider.storageKey)?.trim() ?? "";
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

export function saveKey(id: ProviderId, key: string): void {
  const provider = findProvider(id);
  if (!provider) return;
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
}

/** True when the reviewer explicitly asked for rule-based parsing. */
export function offlineChosen(): boolean {
  return preferredChoice() === OFFLINE_CHOICE;
}

/**
 * The provider extraction will use: the saved preference when it still has a
 * key, otherwise the first provider that has one. Null means offline parsing.
 */
export function activeProvider(): ActiveProvider | null {
  const choice = preferredChoice();
  if (choice === OFFLINE_CHOICE) return null;

  const keys = storedKeys();
  const preferred = findProvider(choice);
  if (preferred && keys[preferred.id]) {
    return { provider: preferred, key: keys[preferred.id] };
  }
  const fallback = PROVIDERS.find((provider) => keys[provider.id]);
  if (!fallback) return null;
  return { provider: fallback, key: keys[fallback.id] };
}

/** Enough to recognise a key without showing it: `AIza…abc1`. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
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
  text: string,
  images: DocumentImage[],
): Promise<string> {
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = images.map((image) => ({
    inlineData: { mimeType: image.mimeType, data: image.base64 },
  }));
  parts.push({ text: `${EXTRACTION_INSTRUCTIONS}\n\n${text}` });

  const model = findProvider("gemini")?.model ?? "gemini-2.0-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
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

async function callChatCompletions(
  endpoint: string,
  key: string,
  model: string,
  extraHeaders: Record<string, string>,
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

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
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
  if (active.provider.id === "gemini") {
    return callGemini(active.key, text, images);
  }
  if (active.provider.id === "openRouter") {
    return callChatCompletions(
      "https://openrouter.ai/api/v1/chat/completions",
      active.key,
      active.provider.model,
      {
        "HTTP-Referer": window.location.origin,
        "X-Title": "StudyForge AI Studio",
      },
      text,
      images,
    );
  }
  return callChatCompletions(
    "https://api.openai.com/v1/chat/completions",
    active.key,
    active.provider.model,
    {},
    text,
    images,
  );
}
