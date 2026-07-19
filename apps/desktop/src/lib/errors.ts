import { decodeStoreError as decodeStoreErrorContract, type StoreError } from "@store/contracts";

export const decodeStoreError = (error: unknown): StoreError | null => {
  try {
    return decodeStoreErrorContract(error);
  } catch {
    return null;
  }
};

export const storeErrorMessage = (error: unknown): string => {
  const decoded = decodeStoreError(error);
  if (decoded?._tag === "PersistenceError") return decoded.message;
  if (decoded?._tag === "ProductNotFoundError") return `Product ${decoded.id} could not be found.`;
  if (decoded?._tag === "InvoiceNotFoundError") return `Invoice ${decoded.id} could not be found.`;
  return error instanceof Error ? error.message : "The store operation could not be completed.";
};
