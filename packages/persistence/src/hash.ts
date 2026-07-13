import { canonicalJson, type SyncOperation } from "@store/contracts";
import { createHash } from "node:crypto";

export const operationPayloadHash = (operation: Omit<SyncOperation, "payloadHash">) =>
  createHash("sha256").update(canonicalJson(operation)).digest("hex");
