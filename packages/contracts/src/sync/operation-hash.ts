import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

import { canonicalJson } from "./canonical-json";
import type { SyncOperation } from "./schema";

export const operationPayloadHash = (
  operation: SyncOperation | Omit<SyncOperation, "payloadHash">,
) => {
  const payload = Object.fromEntries(
    Object.entries(operation).filter(([key]) => key !== "payloadHash"),
  );
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(payload) ?? "null")));
};
