import { sha256 } from "@noble/hashes/sha2.js";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

const utf8 = new TextEncoder();

const nativeSubtle = (): SubtleCrypto | undefined => globalThis.crypto?.subtle;

export const sha256Hex = (text: string): Effect.Effect<string> => {
  const bytes = utf8.encode(text);
  const subtle = nativeSubtle();
  if (subtle === undefined) return Effect.sync(() => Hex.encode(sha256(bytes)));
  return Effect.promise(() => subtle.digest("SHA-256", bytes)).pipe(
    Effect.map((buffer) => Hex.encode(new Uint8Array(buffer))),
  );
};

const compareCodeUnits = Order.String;

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

const canonicalJson = <Value>(value: Value): string | undefined =>
  pipe(
    encodeJsonString(value),
    Option.flatMap(decodeJsonString),
    Option.map(canonicalizeJson),
    Option.flatMap(encodeJsonString),
    Option.getOrUndefined,
  );

const canonicalText = <Payload>(payload: Payload) => canonicalJson(payload) ?? "null";

export const canonicalPayloadHash = <Payload>(payload: Payload) =>
  Hex.encode(sha256(utf8.encode(canonicalText(payload))));
