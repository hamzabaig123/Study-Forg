import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createTransport } from "./transport";

/** The PostgREST envelope a builder awaits to. */
type Envelope = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

/**
 * A query builder that either answers at once or stops answering.
 *
 * The hanging half is the point: a real project cannot be made to stall on
 * demand, and a stalled request is exactly what the ceiling exists to cut off.
 * It rejects the way a fetch does when its signal fires — an `AbortError` — so
 * the transport's translation is exercised rather than mocked away.
 */
class FakeBuilder {
  readonly signals: AbortSignal[] = [];

  constructor(private readonly reply: Envelope | "hang") {}

  abortSignal(signal: AbortSignal): this {
    this.signals.push(signal);
    return this;
  }

  select(): this {
    return this;
  }

  eq(): this {
    return this;
  }

  insert(): this {
    return this;
  }

  // Deliberately awaitable: the builder this stands in for is a `PromiseLike`,
  // and the transport only ever reaches it through `await`.
  // biome-ignore lint/suspicious/noThenProperty: a thenable fake of a thenable builder
  then<T1 = Envelope, T2 = never>(
    onfulfilled?: ((value: Envelope) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return new Promise<Envelope>((resolve, reject) => {
      const reply = this.reply;
      if (reply !== "hang") {
        queueMicrotask(() => resolve(reply));
        return;
      }
      const signal = this.signals[this.signals.length - 1];
      if (!signal) return; // no ceiling was attached, so this never settles
      const fail = () => reject(new DOMException("aborted", "AbortError"));
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    }).then(onfulfilled, onrejected);
  }
}

function clientFor(reply: Envelope | "hang") {
  const builder = new FakeBuilder(reply);
  return {
    builder,
    client: {
      from: () => builder,
      rpc: () => builder,
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as unknown as SupabaseClient,
  };
}

describe("transport request ceiling", () => {
  const answered: Envelope = { data: [{ id: 1 }], error: null };

  it("attaches a signal to reads, writes and rpc calls", async () => {
    const { builder, client } = clientFor(answered);
    const transport = createTransport(client);

    await expect(transport.read("class")).resolves.toEqual([{ id: 1 }]);
    await expect(
      transport.write("class", { insert: { name: "Physics" } }),
    ).resolves.toEqual([{ id: 1 }]);
    await expect(transport.rpc("get_dashboard_stats", {})).resolves.toEqual([
      { id: 1 },
    ]);

    expect(builder.signals).toHaveLength(3);
    for (const signal of builder.signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("turns a stalled request into its own error", async () => {
    const { client } = clientFor("hang");
    const transport = createTransport(client, 5);

    await expect(transport.read("class")).rejects.toThrow(
      /did not answer within/i,
    );
    await expect(transport.rpc("export_content", {})).rejects.toThrow(
      /did not answer within/i,
    );
  });

  it("leaves a real PostgREST error alone", async () => {
    const { client } = clientFor({
      data: null,
      error: { message: "permission denied for table class", code: "42501" },
    });
    const transport = createTransport(client);

    await expect(transport.read("class")).rejects.toThrow(
      "permission denied for table class",
    );
  });
});
