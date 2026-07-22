import { canonicalJson, type SyncOperation } from "@store/contracts";
import { createHash } from "node:crypto";

export const operationPayloadHash = (operation: SyncOperation) => {
  const { payloadHash: _payloadHash, ...payload } = operation;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
};
