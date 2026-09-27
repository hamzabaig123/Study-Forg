/**
 * The only place the adapter touches the network.
 *
 * `backend.ts`'s generated client is a chainable query builder, and a builder
 * that a unit test has to reconstruct is a builder nobody tests. So every
 * database call in this folder goes through the four methods below, which a test
 * can replace with a recorder. Everything above this file is pure mapping.
 *
 * It is deliberately narrow: equality filters, null tests, one ilike shape, one
 * ordering, a limit, and row-returning writes. Anything that needs more — a
 * count, an atomic check, a cascade — is a Postgres function in
 * `supabase/migrations/0001_init.sql` and arrives through `rpc`, which is also
 * where the server-side authority (grading, sampling, token lookups) lives.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, unwrap } from "./client";

export interface Row {
  [key: string]: unknown;
}

export interface ReadOptions {
  select?: string;
  /** Column → value equality. RLS means every filter here is already scoped to the caller. */
  eq?: Record<string, string | number | boolean>;
  isNull?: string[];
  notNull?: string[];
  /** Case-insensitive substring match, true if any column contains the term. */
  contains?: { columns: string[]; term: string };
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

export interface WriteOptions {
  eq?: Record<string, string | number | boolean>;
  insert?: Row;
  update?: Row;
  upsert?: Row;
  onConflict?: string;
  remove?: boolean;
}

export interface SupabaseTransport {
  read(table: string, options?: ReadOptions): Promise<Row[]>;
  /** Returns the affected rows, so a caller never has to re-read to answer. */
  write(table: string, options: WriteOptions): Promise<Row[]>;
  rpc(name: string, args: Row): Promise<unknown>;
  /** The signed-in user's id, or null for a visitor. */
  userId(): Promise<string | null>;
}

/**
 * PostgREST's `ilike` treats `%` and `_` as wildcards and reads `*` as `%`.
 * A term is matched as text, so the two accidental wildcards are dropped; `*`
 * stays because it is what `contains` uses for the surrounding match.
 */
function literal(term: string): string {
  return `*${term.replace(/[%_]/gu, "")}*`;
}

function applyRead(builder: AnyBuilder, options: ReadOptions): AnyBuilder {
  let query = builder.select(options.select ?? "*");
  for (const [column, value] of Object.entries(options.eq ?? {})) {
    query = query.eq(column, value);
  }
  for (const column of options.isNull ?? []) {
    query = query.is(column, null);
  }
  for (const column of options.notNull ?? []) {
    query = query.not(column, "is", null);
  }
  if (options.contains && options.contains.columns.length > 0) {
    const pattern = literal(options.contains.term);
    query = query.or(
      options.contains.columns
        .map((column) => `${column}.ilike.${pattern}`)
        .join(","),
    );
  }
  if (options.order) {
    query = query.order(options.order.column, {
      ascending: options.order.ascending ?? true,
    });
  }
  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }
  return query;
}

/**
 * The builder's own type changes with every chained call, and this module is
 * where that stops mattering: it hands back rows or throws. `select()` with no
 * arguments is the row-returning tail of a mutation, and `PromiseLike` is what
 * lets `await` land on the PostgREST `{ data, error }` envelope.
 */
type QueryEnvelope = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type AnyBuilder = PromiseLike<QueryEnvelope> & {
  select: (columns?: string) => AnyBuilder;
  eq: (column: string, value: string | number | boolean) => AnyBuilder;
  is: (column: string, value: null) => AnyBuilder;
  not: (column: string, operator: string, value: null) => AnyBuilder;
  or: (filters: string) => AnyBuilder;
  order: (column: string, options: { ascending: boolean }) => AnyBuilder;
  limit: (count: number) => AnyBuilder;
  insert: (values: unknown) => AnyBuilder;
  update: (values: unknown) => AnyBuilder;
  upsert: (values: unknown, options?: { onConflict?: string }) => AnyBuilder;
  delete: () => AnyBuilder;
};

function createTransport(client: SupabaseClient): SupabaseTransport {
  const table = (name: string): AnyBuilder =>
    client.from(name) as unknown as AnyBuilder;

  return {
    async read(name, options = {}) {
      const data = unwrap(await applyRead(table(name), options));
      return (data ?? []) as Row[];
    },

    async write(name, options) {
      let query = table(name);
      if (options.insert !== undefined) {
        query = query.insert(options.insert);
      } else if (options.upsert !== undefined) {
        query = query.upsert(options.upsert, {
          onConflict: options.onConflict,
        });
      } else if (options.update !== undefined) {
        query = query.update(options.update);
      } else if (options.remove) {
        query = query.delete();
      } else {
        throw new Error("write() needs insert, update, upsert or remove");
      }
      for (const [column, value] of Object.entries(options.eq ?? {})) {
        query = query.eq(column, value);
      }
      const data = unwrap(await query.select());
      return (data ?? []) as Row[];
    },

    async rpc(name, args) {
      return unwrap(await client.rpc(name, args));
    },

    async userId() {
      const { data } = await client.auth.getUser();
      return data.user?.id ?? null;
    },
  };
}

let shared: SupabaseTransport | null = null;

/** The transport the shipped adapter uses: one client, built on first use. */
export function defaultTransport(): SupabaseTransport {
  shared ??= createTransport(getSupabase());
  return shared;
}
