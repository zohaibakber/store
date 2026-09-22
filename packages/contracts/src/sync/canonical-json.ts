import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

/** Lexicographic code-unit order (same as `Order.String`). */
export const compareCodeUnits = Order.String;

export type JsonValue = typeof Schema.Json.Type;
export type JsonObject = typeof Schema.JsonObject.Type;

const isJsonObject = Schema.is(Schema.JsonObject);
const decodeJsonString = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));
const encodeJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

export const canonicalizeJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, nested]) => [key, canonicalizeJson(nested)]),
  );
};

/**
 * Stable JSON text for hashing: JSON round-trip via Schema, then object keys
 * sorted by code-unit order. Returns `undefined` when the value is not
 * JSON-serializable (same as `JSON.stringify(undefined)`).
 */
export const canonicalJson = <Value>(value: Value) => {
  try {
    const roundTripped = decodeJsonString(encodeJsonString(value));
    return encodeJsonString(canonicalizeJson(roundTripped));
  } catch {
    return undefined;
  }
};
