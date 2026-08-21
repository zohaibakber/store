import {
  decodeStoreError as decodeStoreErrorContract,
  type StoreError,
} from "@store/contracts/store-errors";

import { toastManager } from "@/components/ui/toast";

// Electron wraps main-process failures before they reach the renderer.
const ipcPrefix = /^Error invoking remote method '[^']+': (?:Error: )?/;

export const decodeStoreError = (cause: unknown): StoreError | null => {
  try {
    return decodeStoreErrorContract(cause);
  } catch {
    return null;
  }
};

export const storeErrorMessage = (
  cause: unknown,
  fallback = "Something went wrong. Try again.",
): string => {
  const decoded = decodeStoreError(cause);
  if (decoded?._tag === "PersistenceError") return decoded.message;
  if (decoded?._tag === "ProductNotFoundError") return `No product with id ${decoded.id}.`;
  if (decoded?._tag === "BatchNotFoundError") return "That batch isn't here.";
  if (decoded?._tag === "CategoryNotFoundError") return "That category isn't here.";
  if (decoded?._tag === "InvoiceNotFoundError") return `No invoice with id ${decoded.id}.`;
  return cause instanceof Error ? cause.message.replace(ipcPrefix, "") : fallback;
};

export const toastStoreError = (cause: unknown, fallback?: string) => {
  toastManager.add({ title: storeErrorMessage(cause, fallback), type: "error" });
};
