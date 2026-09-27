import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

export const compareCodeUnits = Order.String;

type JsonValue = typeof Schema.Json.Type;

const isJsonObject = Schema.is(Schema.JsonObject);
const decodeJsonString = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));
const encodeJsonString = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const canonicalizeJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, nested]) => [key, canonicalizeJson(nested)]),
  );
};

export const canonicalJson = <Value>(value: Value): string | undefined =>
  pipe(
    encodeJsonString(value),
    Option.flatMap(decodeJsonString),
    Option.map(canonicalizeJson),
    Option.flatMap(encodeJsonString),
    Option.getOrUndefined,
  );
