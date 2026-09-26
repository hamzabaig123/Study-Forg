/**
 * JSON for a domain that uses bigints.
 *
 * `JSON.stringify` throws on a `bigint`, so an archive or an export of the
 * domain views — every id and timestamp is one — has to say what a bigint is
 * before it serialises. `main.tsx` patches `BigInt.prototype.toJSON`, which
 * would flatten a bigint into a bare string and lose the distinction between
 * `"12"` the id and `12n` the id on the way back in. Tagging up front keeps the
 * round trip exact whichever way that patch goes.
 */

/** @see {@link untagBigints} for the matching `JSON.parse` reviver. */
export function tagBigints(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (Array.isArray(value)) {
    return value.map(tagBigints);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (entry !== undefined) {
        out[key] = tagBigints(entry);
      }
    }
    return out;
  }
  return value;
}

export function untagBigints(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { $bigint?: unknown }).$bigint === "string"
  ) {
    return BigInt((value as { $bigint: string }).$bigint);
  }
  return value;
}

/** `JSON.stringify(tagBigints(value))`, with the same optional indent. */
export function stringifyWithBigints(value: unknown, indent = 0): string {
  return JSON.stringify(tagBigints(value), null, indent);
}

/** The inverse of {@link stringifyWithBigints}. */
export function parseWithBigints(text: string): unknown {
  return JSON.parse(text, untagBigints);
}
