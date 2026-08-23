/**
 * `bigint` isn't natively JSON-serializable. This pair of helpers is the
 * one place that convention is handled, so the canonical `events` table
 * can round-trip a payload (including its `bigint` fields, e.g.
 * `stake`, `amount`, `epoch`) exactly — required for replay (db.ts /
 * projection.ts's `rebuildProjections`) to reconstruct the same typed
 * payload ingestion originally produced, not a stringly-typed
 * approximation of it.
 */

interface BigIntMarker {
  __bigint__: string;
}

function isBigIntMarker(value: unknown): value is BigIntMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value as object).length === 1 &&
    typeof (value as Record<string, unknown>).__bigint__ === "string"
  );
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? { __bigint__: v.toString() } : v));
}

export function parseJson<T = unknown>(text: string): T {
  return JSON.parse(text, (_key, v) => (isBigIntMarker(v) ? BigInt(v.__bigint__) : v)) as T;
}
