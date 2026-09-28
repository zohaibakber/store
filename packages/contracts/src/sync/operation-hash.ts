import { sha256 } from "@noble/hashes/sha2.js";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";

import { canonicalJson } from "./canonical-json";

const utf8 = new TextEncoder();

const nativeSubtle = (): SubtleCrypto | undefined => globalThis.crypto?.subtle;

export const sha256Hex = (text: string): Effect.Effect<string> => {
  const bytes = utf8.encode(text);
  const subtle = nativeSubtle();
  if (subtle === undefined) return Effect.sync(() => Encoding.encodeHex(sha256(bytes)));
  return Effect.promise(() => subtle.digest("SHA-256", bytes)).pipe(
    Effect.map((buffer) => Encoding.encodeHex(new Uint8Array(buffer))),
  );
};

const canonicalText = <Payload>(payload: Payload) => canonicalJson(payload) ?? "null";

export const canonicalPayloadHash = <Payload>(payload: Payload) =>
  Encoding.encodeHex(sha256(utf8.encode(canonicalText(payload))));

export const nativeCanonicalPayloadHash = <Payload>(payload: Payload): Effect.Effect<string> =>
  Effect.suspend(() => sha256Hex(canonicalText(payload)));
