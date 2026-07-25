import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical-json";
import type { SyncOperation } from "./schema";

export const operationPayloadHash = (
  operation: SyncOperation | Omit<SyncOperation, "payloadHash">,
) => {
  const { payloadHash: _payloadHash, ...payload } = operation as SyncOperation;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
};
