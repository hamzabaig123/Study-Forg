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

/**
 * Success bodies are read as text and parsed by StudyForge, so a mock answers
 * with the JSON string rather than an object.
 */
const CHAT_BODY = JSON.stringify({
  choices: [{ message: { content: '{"items":[]}' } }],
});

const GEMINI_BODY = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '{"items":[]}' }] } }],
});

const OFFLINE_REPLY = {
  ok: true,
  json: async () => JSON.parse(CHAT_BODY),
  text: async () => CHAT_BODY,
};

const GEMINI_REPLY = {
  ok: true,
  json: async () => JSON.parse(GEMINI_BODY),
  text: async () => GEMINI_BODY,
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

  it("defaults to the newest Flash model that answers", () => {
    const gemini = findProvider("gemini");
    // 3.8 is newer but sits at HTTP 503 "high demand" for long stretches, so
    // it is offered last instead of being what a run starts with.
    expect(gemini?.defaultModel).toBe("gemini-3.7-flash");
    expect(gemini?.models[0].id).toBe("gemini-3.7-flash");
    expect(gemini?.models.at(-1)?.id).toBe("gemini-3.8-flash");
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
    expect(savedModel("gemini")).toBe("gemini-3.7-flash");
    expect(activeProvider()?.model).toBe("gemini-3.7-flash");

    setSavedModel("gemini", "gemini-3.5-flash-lite");
    expect(savedModel("gemini")).toBe("gemini-3.5-flash-lite");
    expect(activeProvider()?.model).toBe("gemini-3.5-flash-lite");
    // A provider nobody picked keeps its own default.
    expect(savedModel("ollama")).toBe("qwen2.5vl:7b");
  });

  it("ignores a damaged model record and an empty choice", () => {
    window.localStorage.setItem("studyforge.ai.model", "not json");
    expect(savedModel("gemini")).toBe("gemini-3.7-flash");
    setSavedModel("gemini", "   ");
    expect(savedModel("gemini")).toBe("gemini-3.7-flash");
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
  it("sends a Gemini model in the URL and the key in a header", async () => {
    fetchMock.mockResolvedValue(GEMINI_REPLY);
    saveKey("gemini", "AIza-test");
    setSavedModel("gemini", "gemini-3.7-flash");

    await callProvider(activeFor("gemini"), "page text", []);

    const url = chatUrl(0);
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent",
    );
    // A key in the query string is recorded by proxies, extensions and the
    // provider's access logs, so the URL must never contain it.
    expect(url).not.toContain("AIza-test");
    const init = chatInit(0);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "AIza-test",
    );
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

function statusReply(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
    text: async () => JSON.stringify({ error: { message } }),
  };
}

describe("when a model is busy", () => {
  function geminiActive(): ActiveProvider {
    saveKey("gemini", "AIza-test");
    return activeFor("gemini");
  }

  it("asks a refused model twice, then steps to the next one", async () => {
    vi.useFakeTimers();
    const active = geminiActive();
    fetchMock
      .mockResolvedValueOnce(
        statusReply(503, "This model is currently experiencing high demand."),
      )
      .mockResolvedValueOnce(
        statusReply(503, "This model is currently experiencing high demand."),
      )
      .mockResolvedValue(GEMINI_REPLY);
    const notices: string[] = [];

    const running = callProvider(active, "page text", [], (message) =>
      notices.push(message),
    );
    await vi.runAllTimersAsync();
    const reply = await running;
    vi.useRealTimers();

    // Two attempts on the default, then the next model answers.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(chatUrl(0)).toContain("models/gemini-3.7-flash:");
    expect(chatUrl(1)).toContain("models/gemini-3.7-flash:");
    expect(chatUrl(2)).toContain("models/gemini-3.6-flash:");
    expect(reply.model).toBe("gemini-3.6-flash");
    expect(notices).toEqual([
      "gemini-3.7-flash is busy — trying gemini-3.6-flash instead.",
    ]);
    // The model that got through is kept for the rest of the run's pages.
    expect(active.model).toBe("gemini-3.6-flash");
  });

  it("gives up with advice when every model stays busy", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(
      statusReply(429, "Rate limit exceeded for this model."),
    );

    const running = callProvider(geminiActive(), "page text", []);
    const settled = running.catch((cause: unknown) => cause);
    await vi.runAllTimersAsync();
    const error = (await settled) as Error;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(8); // 4 models x 2 attempts
    expect(error.message).toMatch(/Google Gemini:[\s\S]*Try again in a moment/);
  });

  it("counts a 200 that carries no text as a busy model", async () => {
    // Gemini answers an overloaded request with an empty candidates list and
    // HTTP 200, so an empty reply is retried rather than parsed as "no items".
    const silent = {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [] } }] }),
      text: async () => "",
    };
    vi.useFakeTimers();
    const active = geminiActive();
    fetchMock.mockResolvedValueOnce(silent).mockResolvedValue(GEMINI_REPLY);

    const running = callProvider(active, "page text", []);
    await vi.runAllTimersAsync();
    const reply = await running;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reply.model).toBe("gemini-3.7-flash");
  });

  it("counts a request that hangs as a busy model", async () => {
    // Without a deadline one stalled page would hold the whole run open.
    const stalled = Object.assign(new Error("signal timed out"), {
      name: "TimeoutError",
    });
    vi.useFakeTimers();
    const active = geminiActive();
    fetchMock.mockRejectedValueOnce(stalled).mockResolvedValue(GEMINI_REPLY);

    const running = callProvider(active, "page text", []);
    await vi.runAllTimersAsync();
    const reply = await running;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chatInit(0).signal).toBeTruthy();
    expect(reply.model).toBe("gemini-3.7-flash");
  });

  it("refuses a dead key once, without retrying or switching model", async () => {
    // Google answers an invalid key with 400, not 401.
    fetchMock.mockResolvedValue(
      statusReply(400, "API key not valid. Please pass a valid API key."),
    );

    await expect(callProvider(geminiActive(), "page text", [])).rejects.toThrow(
      /API key not valid[\s\S]*Create a fresh one at https:\/\/aistudio\.google\.com\/app\/apikey/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tells an expired OpenRouter key where to renew it", async () => {
    saveKey("openRouter", "sk-or-v1-expired");
    fetchMock.mockResolvedValue(statusReply(401, "API key expired."));

    await expect(
      callProvider(activeFor("openRouter"), "page text", []),
    ).rejects.toThrow(/API key expired[\s\S]*https:\/\/openrouter\.ai\/keys/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("names the key page when the provider rejects the key", async () => {
    fetchMock.mockResolvedValue(statusReply(403, "Permission denied on key."));

    await expect(callProvider(geminiActive(), "page text", [])).rejects.toThrow(
      /aistudio\.google\.com\/app\/apikey/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("JSON mode per provider", () => {
  it("asks Ollama for JSON and leaves OpenRouter alone", async () => {
    fetchMock.mockResolvedValue(OFFLINE_REPLY);
    saveKey("openRouter", "sk-or-v1-test");

    await callProvider(activeFor("openRouter"), "page text", []);
    expect(bodyOf(chatInit(0)).response_format).toBeUndefined();

    await callProvider(activeFor("ollama"), "page text", []);
    expect(bodyOf(chatInit(1)).response_format).toEqual({
      type: "json_object",
    });
  });
});

function activeFor(id: "gemini" | "openRouter" | "ollama"): ActiveProvider {
  setPreferredChoice(id);
  const active = activeProvider();
  if (!active) throw new Error(`No active provider for ${id}`);
  return active;
}

function chatUrl(index: number): string {
  return (fetchMock.mock.calls[index] as [string])[0];
}

function chatInit(index: number): RequestInit {
  return (fetchMock.mock.calls[index] as [string, RequestInit])[1];
}
