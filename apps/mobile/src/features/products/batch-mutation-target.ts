import type { BatchMutationTarget } from "@/lib/inventory-types";

export const batchMutationTarget = (
  selectedBatchId: string | null,
  newBatchId: string,
): BatchMutationTarget =>
  selectedBatchId ? { batchId: selectedBatchId } : { batchId: null, newBatchId };
