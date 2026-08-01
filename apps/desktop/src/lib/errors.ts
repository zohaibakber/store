import {
  decodeStoreError as decodeStoreErrorContract,
  type StoreError,
} from "@store/contracts/store-errors";

import { toastManager } from "@/components/ui/toast";

// Electron wraps main-process failures before they reach the renderer.
const ipcPrefix = /^Error invoking remote method '[^']+': (?:Error: )?/;

export const decodeStoreError = (error: unknown): StoreError | null => {
  try {
    return decodeStoreErrorContract(error);
  } catch {
    return null;
  }
};

export const storeErrorMessage = (
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string => {
  const decoded = decodeStoreError(error);
  if (decoded?._tag === "PersistenceError") return decoded.message;
  if (decoded?._tag === "ProductNotFoundError") return `Product ${decoded.id} could not be found.`;
  if (decoded?._tag === "BatchNotFoundError") return "That batch could not be found.";
  if (decoded?._tag === "CategoryNotFoundError") return "That category could not be found.";
  if (decoded?._tag === "InvoiceNotFoundError") return `Invoice ${decoded.id} could not be found.`;
  return error instanceof Error ? error.message.replace(ipcPrefix, "") : fallback;
};

export const toastStoreError = (error: unknown, fallback?: string) => {
  toastManager.add({ title: storeErrorMessage(error, fallback), type: "error" });
};
