import { useState } from "react";

import { batchMutationTarget } from "@/features/products/batch-mutation-target";
import { useProductActions } from "@/features/products/products-provider";
import { authErrorMessage } from "@/lib/auth-client";
import type {
  MobileBatch,
  SaveBatchDetailsInput,
  UpdateBatchQuantityInput,
} from "@/lib/inventory-types";

export type BatchWritePending = null | "batch" | "quantity";

export type BatchWriteResult = { ok: true; batch: MobileBatch } | { ok: false; message: string };

type DetailsInput = {
  productId: string;
  selectedBatchId: string | null;
  newBatchId: string;
  batchNumber: string | null;
  expiresAt: number | null;
};

export type QuantityInput = {
  productId: string;
  selectedBatchId: string | null;
  newBatchId: string;
  packQuantity: number;
  unitQuantity: number;
  batchNumber?: string | null;
  expiresAt?: number | null;
};

export function useBatchWrites() {
  const { saveBatchDetails, updateBatchQuantity } = useProductActions();
  const [pending, setPending] = useState<BatchWritePending>(null);

  const writeBatchDetails = async (input: DetailsInput): Promise<BatchWriteResult> => {
    setPending("batch");
    try {
      const payload: SaveBatchDetailsInput = {
        productId: input.productId,
        ...batchMutationTarget(input.selectedBatchId, input.newBatchId),
        batchNumber: input.batchNumber,
        expiresAt: input.expiresAt,
      };
      const batch = await saveBatchDetails(payload);
      return { ok: true, batch };
    } catch (cause) {
      return { ok: false, message: authErrorMessage(cause) };
    } finally {
      setPending(null);
    }
  };

  const writeBatchQuantity = async (input: QuantityInput): Promise<BatchWriteResult> => {
    setPending("quantity");
    try {
      const payload: UpdateBatchQuantityInput = {
        productId: input.productId,
        ...batchMutationTarget(input.selectedBatchId, input.newBatchId),
        packQuantity: input.packQuantity,
        unitQuantity: input.unitQuantity,
      };
      if (input.batchNumber !== undefined) payload.batchNumber = input.batchNumber;
      if (input.expiresAt !== undefined) payload.expiresAt = input.expiresAt;
      const batch = await updateBatchQuantity(payload);
      return { ok: true, batch };
    } catch (cause) {
      return { ok: false, message: authErrorMessage(cause) };
    } finally {
      setPending(null);
    }
  };

  return { pending, writeBatchDetails, writeBatchQuantity };
}
