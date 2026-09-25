/**
 * The provider catalogue: which models are offered, which one a run uses, and
 * what the request looks like. Network calls are stubbed — these assert the
 * shape of each provider's API contract, not the providers themselves.
 */

import {
  type ActiveProvider,
  OLLAMA_ORIGIN,
  PROVIDERS,
  activeProvider,
  callProvider,
  findProvider,
  listModels,
  offlineChosen,
  removeKey,
  saveKey,
  savedModel,
  setPreferredChoice,
  setSavedModel,
  storedKeys,
  withCurrent,
} from "@/lib/ai/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OFFLINE_REPLY = {
  ok: true,
  json: async () => ({
    choices: [{ message: { content: '{"items":[]}' } }],
  }),
  text: async () => "",
};

const GEMINI_REPLY = {
  ok: true,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: '{"items":[]}' }] } }],
  }),
  text: async () => "",
};

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the provider catalogue", () => {
  it("is Gemini, OpenRouter and a local Ollama", () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual([
      "gemini",
      "openRouter",
      "ollama",
    ]);
    expect(PROVIDERS.map((provider) => provider.name)).toEqual([
      "Google Gemini",
      "OpenRouter",
      "Ollama",
    ]);
    // OpenAI is gone, so no storage key of its name remains in the catalogue.
    expect(Object.keys(storedKeys())).toEqual([
      "gemini",
      "openRouter",
      "ollama",
    ]);
  });

  it("defaults to Google's newest Flash model", () => {
    const gemini = findProvider("gemini");
    expect(gemini?.defaultModel).toBe("gemini-3.8-flash");
    expect(gemini?.models[0].id).toBe("gemini-3.8-flash");
    expect(
      gemini?.models.every((model) => model.id.startsWith("gemini-")),
    ).toBe(true);
  });

  it("points OpenRouter at its free tier and Ollama at no key", () => {
    const openRouter = findProvider("openRouter");
    expect(openRouter?.defaultModel.endsWith(":free")).toBe(true);
    expect(openRouter?.liveModels).toBe(true);

    const ollama = findProvider("ollama");
    expect(ollama?.requiresKey).toBe(false);
    expect(ollama?.storageKey).toBeNull();
    expect(ollama?.liveModels).toBe(true);
  });
});

describe("choosing what runs", () => {
  it("uses a provider only once it has a key, and Ollama only when asked", () => {
    expect(activeProvider()).toBeNull();

    saveKey("openRouter", "sk-or-v1-test");
    expect(activeProvider()?.provider.id).toBe("openRouter");
    expect(activeProvider()?.key).toBe("sk-or-v1-test");

    // Ollama holds no key, so it must not become the fallback for a bare setup.
    removeKey("openRouter");
    expect(activeProvider()).toBeNull();
    setPreferredChoice("ollama");
    expect(activeProvider()?.provider.id).toBe("ollama");
    expect(activeProvider()?.key).toBe("");
  });

  it("prefers the saved choice over the fallback and honours offline", () => {
    saveKey("gemini", "AIza-gemini");
    saveKey("openRouter", "sk-or-v1-openrouter");
    setPreferredChoice("openRouter");
    expect(activeProvider()?.provider.id).toBe("openRouter");

    setPreferredChoice("offline");
    expect(offlineChosen()).toBe(true);
    expect(activeProvider()).toBeNull();
  });

  it("carries the chosen model into the active provider", () => {
    saveKey("gemini", "AIza-gemini");
    expect(savedModel("gemini")).toBe("gemini-3.8-flash");
    expect(activeProvider()?.model).toBe("gemini-3.8-flash");

    setSavedModel("gemini", "gemini-3.5-flash-lite");
    expect(savedModel("gemini")).toBe("gemini-3.5-flash-lite");
    expect(activeProvider()?.model).toBe("gemini-3.5-flash-lite");
    // A provider nobody picked keeps its own default.
    expect(savedModel("ollama")).toBe("qwen2.5vl:7b");
  });

  it("ignores a damaged model record and an empty choice", () => {
    window.localStorage.setItem("studyforge.ai.model", "not json");
    expect(savedModel("gemini")).toBe("gemini-3.8-flash");
    setSavedModel("gemini", "   ");
    expect(savedModel("gemini")).toBe("gemini-3.8-flash");
  });
});

describe("model lists", () => {
  it("keeps Gemini's own models without a request", async () => {
    const models = await listModels("gemini");
    expect(models.map((model) => model.id)).toContain("gemini-3.8-flash");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps only OpenRouter's free models, vision-capable ones first", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "poolside/laguna-xs-2.1:free",
            name: "Poolside: Laguna XS 2.1 (free)",
            architecture: { input_modalities: ["text"] },
          },
          {
            id: "paid/paid-model",
            name: "A paid model",
            architecture: { input_modalities: ["text", "image"] },
          },
          {
            id: "google/gemma-4-31b-it:free",
            name: "Google: Gemma 4 31B (free)",
            architecture: { input_modalities: ["image", "text"] },
          },
        ],
      }),
    });

    const models = await listModels("openRouter", true);
    expect(models.map((model) => model.id)).toEqual([
      "google/gemma-4-31b-it:free",
      "poolside/laguna-xs-2.1:free",
    ]);
    expect(chatUrl(0)).toBe("https://openrouter.ai/api/v1/models");
  });

  it("lists what the local Ollama server has pulled", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "llama3.1:8b" }, { name: "qwen2.5vl:7b" }],
      }),
    });

    const models = await listModels("ollama", true);
    expect(models.map((model) => model.id)).toEqual([
      "llama3.1:8b",
      "qwen2.5vl:7b",
    ]);
    expect(chatUrl(0)).toBe(`${OLLAMA_ORIGIN}/api/tags`);
  });

  it("reports an unreachable server, and keeps an off-list choice visible", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(listModels("ollama", true)).rejects.toThrow(
      /Could not reach Ollama/,
    );

    expect(withCurrent([{ id: "a", label: "a", vision: true }], "b")).toEqual([
      { id: "b", label: "b", vision: true },
      { id: "a", label: "a", vision: true },
    ]);
    expect(
      withCurrent([{ id: "a", label: "a", vision: true }], "a"),
    ).toHaveLength(1);
  });
});

describe("the request each provider gets", () => {
  function activeFor(id: "gemini" | "openRouter" | "ollama"): ActiveProvider {
    setPreferredChoice(id);
    const active = activeProvider();
    if (!active) throw new Error(`No active provider for ${id}`);
    return active;
  }

  it("sends a Gemini model in the URL with the key", async () => {
    fetchMock.mockResolvedValue(GEMINI_REPLY);
    saveKey("gemini", "AIza-test");
    setSavedModel("gemini", "gemini-3.7-flash");

    await callProvider(activeFor("gemini"), "page text", []);

    expect(chatUrl(0)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=AIza-test",
    );
    const init = chatInit(0);
    expect(bodyOf(init).generationConfig).toMatchObject({
      responseMimeType: "application/json",
    });
  });

  it("sends an OpenRouter model with its bearer key", async () => {
    fetchMock.mockResolvedValue(OFFLINE_REPLY);
    saveKey("openRouter", "sk-or-v1-test");
    setSavedModel("openRouter", "qwen/qwen3.8-27b:free");

    await callProvider(activeFor("openRouter"), "page text", []);

    expect(chatUrl(0)).toBe("https://openrouter.ai/api/v1/chat/completions");
    const init = chatInit(0);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-v1-test");
    expect(headers["X-Title"]).toBeTruthy();
    expect(bodyOf(init).model).toBe("qwen/qwen3.8-27b:free");
  });

  it("sends an Ollama model to the local server with no authorization", async () => {
    fetchMock.mockResolvedValue(OFFLINE_REPLY);

    await callProvider(activeFor("ollama"), "page text", []);

    expect(chatUrl(0)).toBe(`${OLLAMA_ORIGIN}/v1/chat/completions`);
    const headers = chatInit(0).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(bodyOf(chatInit(0)).model).toBe("qwen2.5vl:7b");
  });

  it("says which server to start when Ollama is not running", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      callProvider(activeFor("ollama"), "page text", []),
    ).rejects.toThrow(/Could not reach the local server/);
  });
});

function chatUrl(index: number): string {
  return (fetchMock.mock.calls[index] as [string])[0];
}

function chatInit(index: number): RequestInit {
  return (fetchMock.mock.calls[index] as [string, RequestInit])[1];
}
