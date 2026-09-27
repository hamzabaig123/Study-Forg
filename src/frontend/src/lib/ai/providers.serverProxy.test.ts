/**
 * The Server proxy: the fourth extraction engine, present only when a
 * configured Supabase project serves the app. These tests pin
 * `@/lib/supabase/env` to a configured project and fake the session client,
 * so the whole browser half runs offline.
 */
import {
  PROVIDERS,
  ProviderUnavailableError,
  SERVER_PROXY_AVAILABLE,
  activeProvider,
  callProvider,
  findProvider,
  preferredChoice,
  setPreferredChoice,
  visibleProviders,
} from "@/lib/ai/providers";
import { getSupabase } from "@/lib/supabase/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/env", () => ({
  SUPABASE_CONFIGURED: true,
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  selectDataBackend: () => "supabase",
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: vi.fn(),
}));

function stubFetch(
  replies: Array<{ ok: boolean; status?: number; body: string }>,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const reply = replies[Math.min(index, replies.length - 1)] ?? replies[0];
      index += 1;
      return {
        ok: reply.ok,
        status: reply.status ?? (reply.ok ? 200 : 500),
        headers: { get: () => null },
        text: async () => reply.body,
      };
    }),
  );
  return calls;
}

function session(token: string | null) {
  vi.mocked(getSupabase).mockReturnValue({
    auth: {
      getSession: async () => ({
        data: { session: token ? { access_token: token } : null },
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

beforeEach(() => {
  localStorage.clear();
  session("access-token-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("server proxy availability", () => {
  it("is offered beside the three local providers", () => {
    expect(SERVER_PROXY_AVAILABLE).toBe(true);
    expect(PROVIDERS).toHaveLength(3);
    expect(visibleProviders().map((provider) => provider.id)).toEqual([
      "gemini",
      "openRouter",
      "ollama",
      "serverProxy",
    ]);
    expect(findProvider("serverProxy")).toMatchObject({
      requiresKey: false,
      storageKey: null,
    });
  });

  it("survives as a saved preference and becomes the active provider", () => {
    setPreferredChoice("serverProxy");
    expect(preferredChoice()).toBe("serverProxy");
    expect(activeProvider()?.provider.id).toBe("serverProxy");
  });
});

describe("server proxy requests", () => {
  it("posts the unit to the function with the session token, never a key", async () => {
    const calls = stubFetch([
      { ok: true, body: JSON.stringify({ text: '{"items":[]}' }) },
    ]);
    const active = {
      provider: findProvider("serverProxy")!,
      key: "",
      model: "gemini-3.7-flash",
    };
    const reply = await callProvider(active, "prompt text", []);

    expect(reply.text).toBe('{"items":[]}');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://test.supabase.co/functions/v1/ai-proxy");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer access-token-1");
    expect(headers.apikey).toBe("test-anon-key");
    expect(JSON.parse(String(calls[0].init.body)).model).toBe(
      "gemini-3.7-flash",
    );
  });

  it("steps over busy models and reports the one that answered", async () => {
    const calls = stubFetch([
      {
        ok: false,
        status: 503,
        body: JSON.stringify({
          error: {
            message: "This model is currently experiencing high demand",
          },
        }),
      },
      { ok: true, body: JSON.stringify({ text: "answered" }) },
    ]);
    const active = {
      provider: findProvider("serverProxy")!,
      key: "",
      model: "gemini-3.7-flash",
    };
    const reply = await callProvider(active, "prompt", []);
    expect(reply.text).toBe("answered");
    // First attempt busy, second attempt after the 0.5 s backoff answered —
    // the model that got through is written back onto the active provider.
    expect(calls).toHaveLength(2);
    expect(reply.model).toBe("gemini-3.7-flash");
    expect(active.model).toBe("gemini-3.7-flash");
  });

  it("walks the whole list and gives up as unavailable", async () => {
    const calls = stubFetch([
      {
        ok: false,
        status: 503,
        body: JSON.stringify({ error: { message: "high demand" } }),
      },
    ]);
    const active = {
      provider: findProvider("serverProxy")!,
      key: "",
      model: "gemini-3.7-flash",
    };
    await expect(callProvider(active, "prompt", [])).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(calls).toHaveLength(8);
  });

  it("refuses to call anything without a signed-in session", async () => {
    session(null);
    const calls = stubFetch([{ ok: true, body: "{}" }]);
    const active = {
      provider: findProvider("serverProxy")!,
      key: "",
      model: "gemini-3.7-flash",
    };
    await expect(callProvider(active, "prompt", [])).rejects.toThrow(
      /sign in/i,
    );
    expect(calls).toHaveLength(0);
  });
});
