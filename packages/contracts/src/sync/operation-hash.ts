import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalJson } from "./canonical-json";
import type { SyncOperation } from "./schema";

export const canonicalPayloadHash = <Payload>(payload: Payload) =>
  bytesToHex(sha256(utf8ToBytes(canonicalJson(payload) ?? "null")));

export const operationPayloadHash = (
  operation: SyncOperation | Omit<SyncOperation, "payloadHash">,
) => {
  const payload = Object.fromEntries(
    Object.entries(operation).filter(([key]) => key !== "payloadHash"),
  );
  return canonicalPayloadHash(payload);
};
