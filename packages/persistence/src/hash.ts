import { createHash } from "node:crypto";

import { canonicalJson, type SyncOperation } from "@store/contracts";

export const operationPayloadHash = (operation: Omit<SyncOperation, "payloadHash">) =>
  createHash("sha256").update(canonicalJson(operation)).digest("hex");
