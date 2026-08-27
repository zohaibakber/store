import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalJson } from "./canonical-json";

export const canonicalPayloadHash = <Payload>(payload: Payload) =>
  bytesToHex(sha256(utf8ToBytes(canonicalJson(payload) ?? "null")));
