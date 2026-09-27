import { sha256 } from "@noble/hashes/sha2.js";
import * as Encoding from "effect/Encoding";

import { canonicalJson } from "./canonical-json";

const utf8 = new TextEncoder();

export const canonicalPayloadHash = <Payload>(payload: Payload) =>
  Encoding.encodeHex(sha256(utf8.encode(canonicalJson(payload) ?? "null")));
