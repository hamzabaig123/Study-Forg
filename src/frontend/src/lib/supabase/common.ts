/**
 * Shared plumbing for the Supabase adapter slices.
 *
 * The adapter is split by domain (`content`, `practice`, `library`, `sharing`,
 * `links`, `system`) so each file reads like the part of the contract it
 * implements, and every one of them needs the same four small things: the
 * caller's id, an activity row, a JSON-array RPC, and the trim-to-undefined
 * rule the mock applies to optional labels. Putting them here is what stops the
 * slices from each inventing their own version of "who is signed in".
 */
import type { Id } from "@/backend";
import { tokenHash } from "./tokens";
import type { Row, SupabaseTransport } from "./transport";

export interface Adapter {
  transport: SupabaseTransport;
}

/**
 * The signed-in user's id.
 *
 * Everything owner-facing is refused before the query rather than by row level
 * security: RLS is the backstop that makes a missed check harmless, but a
 * Postgres error about a policy is a worse message than "sign in again", and
 * the app's queries all gate on an authenticated session anyway.
 */
export async function requireUserId(
  transport: SupabaseTransport,
): Promise<string> {
  const id = await transport.userId();
  if (!id) {
    throw new Error("This action needs a signed-in account.");
  }
  return id;
}

/** `null`, empty and whitespace-only all mean "no label" to every backend. */
export function optionalLabel(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The same text, but as the database wants it: `null` rather than `undefined`. */
export function nullableLabel(value: string | null | undefined): string | null {
  return optionalLabel(value) ?? null;
}

/**
 * A bigint as the string PostgREST casts into an `integer`/`bigint` parameter.
 *
 * `JSON.stringify` throws on a BigInt, and widening to `number` would silently
 * corrupt an id above 2^53 — which the mock's ids never reach but an imported
 * archive's might.
 */
export function idArg(value: Id | bigint): string {
  return value.toString();
}

/** A `jsonb` parameter: the tagged union exactly as the domain holds it. */
export function jsonArg<T>(value: T): T {
  return structuredClone(value);
}

export async function logActivity(
  transport: SupabaseTransport,
  kind: string,
  title: string,
): Promise<void> {
  await transport.write("activity", { insert: { kind, title } });
}

/** An RPC that answers a JSON array of rows. */
export async function rpcRows(
  transport: SupabaseTransport,
  name: string,
  args: Row = {},
): Promise<Row[]> {
  const payload = await transport.rpc(name, args);
  return Array.isArray(payload) ? (payload as Row[]) : [];
}

/** An RPC that answers a single JSON object envelope. */
export async function rpcEnvelope(
  transport: SupabaseTransport,
  name: string,
  args: Row = {},
): Promise<Row> {
  const payload = (await transport.rpc(name, args)) as Row | null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError(`${name} returned no reply`);
  }
  return payload;
}

/**
 * The same, for the functions that answer SQL `null`.
 *
 * `shared_note`, `shared_content` and the link-by-token readers return null
 * rather than an error object when a token matches nothing, because "this link
 * does not exist" and "this link was revoked" are the same page to a visitor. A
 * caller that treats a reply as guaranteed would turn a dead token into a thrown
 * TypeError, which the share page renders as a crash.
 */
export async function rpcOptional(
  transport: SupabaseTransport,
  name: string,
  args: Row = {},
): Promise<Row | null> {
  const payload = await transport.rpc(name, args);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload as Row;
}

/** The first written row, or null when the filter matched nothing they own. */
export function firstOrNone(rows: Row[]): Row | null {
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Drop fields from a view before it is written to a file.
 *
 * Only used by `exportMyData`, and only for tokens: the mock's archive strips
 * them for the same reason, because an export is a file that gets emailed and
 * left in Downloads, and a share token is a key that opens that share while the
 * list screens still re-show it.
 */
export function withoutFields<T extends object>(row: T, fields: string[]): T {
  const copy = { ...row } as Record<string, unknown>;
  for (const field of fields) {
    delete copy[field];
  }
  return copy as T;
}

/**
 * Digest a token for lookup.
 *
 * Anonymous reads are keyed on the digest rather than the plaintext column so
 * the plaintext never appears in a query string the platform logs, and a visitor
 * cannot walk the table by primary key to guess one.
 */
export async function hashToken(token: string): Promise<string> {
  return tokenHash(token);
}

/** Turn the domain's `ShareTarget`/`SessionScope` pair into column values. */
export function scopeColumns(
  target:
    | { __kind__: "topic"; topic: Id }
    | { __kind__: "chapter"; chapter: Id },
): { scope_kind: string; scope_id: string } {
  return target.__kind__ === "topic"
    ? { scope_kind: "topic", scope_id: idArg(target.topic) }
    : { scope_kind: "chapter", scope_id: idArg(target.chapter) };
}

/** Questions in a scope, oldest first — the order every export and share uses. */
export async function questionsInScope(
  transport: SupabaseTransport,
  target:
    | { __kind__: "topic"; topic: Id }
    | { __kind__: "chapter"; chapter: Id },
): Promise<Row[]> {
  if (target.__kind__ === "topic") {
    return transport.read("question", {
      eq: { topic_id: idArg(target.topic) },
      order: { column: "id" },
    });
  }
  const topics = await transport.read("topic", {
    eq: { chapter_id: idArg(target.chapter) },
    order: { column: "id" },
  });
  const topicIds = topics.map((row) => String(row.id));
  if (topicIds.length === 0) {
    return [];
  }
  // `in` is not in the narrow transport on purpose: one read per topic keeps the
  // result in id order without a planner deciding to sort a long list anyway.
  const rows: Row[] = [];
  for (const topicId of topicIds) {
    rows.push(
      ...(await transport.read("question", {
        eq: { topic_id: topicId },
        order: { column: "id" },
      })),
    );
  }
  return rows;
}
