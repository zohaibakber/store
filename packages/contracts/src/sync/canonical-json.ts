import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

export const compareCodeUnits = Order.String;

type JsonValue = typeof Schema.Json.Type;

const isJsonObject = Schema.is(Schema.JsonObject);
const decodeJsonString = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));
const encodeJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const canonicalizeJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, nested]) => [key, canonicalizeJson(nested)]),
  );
};

export const canonicalJson = <Value>(value: Value) => {
  try {
    const roundTripped = decodeJsonString(encodeJsonString(value));
    return encodeJsonString(canonicalizeJson(roundTripped));
  } catch {
    return undefined;
  }
};
