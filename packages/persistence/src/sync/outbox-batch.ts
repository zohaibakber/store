import {
  MAX_SYNC_CHANGES_PER_OPERATION,
  MAX_SYNC_CHANGES_PER_REQUEST,
  MAX_SYNC_OPERATIONS_PER_REQUEST,
} from "@store/contracts";

export interface QueuedOperation {
  readonly operationId: string;
  readonly payload: ReadonlyArray<unknown>;
}

export type BatchSelection<T extends QueuedOperation> =
  | {
      readonly _tag: "Selected";
      readonly operations: ReadonlyArray<T>;
      readonly changeCount: number;
      readonly moreDue: boolean;
    }
  | { readonly _tag: "Unsendable"; readonly operationId: string; readonly reason: string };

export const selectBatch = <T extends QueuedOperation>(
  due: ReadonlyArray<T>,
): BatchSelection<T> => {
  const operations: T[] = [];
  let changeCount = 0;

  for (const queued of due) {
    if (operations.length >= MAX_SYNC_OPERATIONS_PER_REQUEST) break;
    if (queued.payload.length === 0)
      return {
        _tag: "Unsendable",
        operationId: queued.operationId,
        reason: `Queued operation ${queued.operationId} contains no changes`,
      };
    if (queued.payload.length > MAX_SYNC_CHANGES_PER_OPERATION)
      return {
        _tag: "Unsendable",
        operationId: queued.operationId,
        reason: `Queued operation ${queued.operationId} contains ${queued.payload.length} changes; the supported maximum is ${MAX_SYNC_CHANGES_PER_OPERATION}`,
      };
    // The first operation must be sent or rejected so it cannot block the queue.
    if (operations.length > 0 && changeCount + queued.payload.length > MAX_SYNC_CHANGES_PER_REQUEST)
      break;
    operations.push(queued);
    changeCount += queued.payload.length;
  }

  return {
    _tag: "Selected",
    operations,
    changeCount,
    moreDue: due.length > operations.length,
  };
};

export type ExchangeOutcome =
  | { readonly _tag: "Drained" }
  | { readonly _tag: "MorePending"; readonly reason: "server-pages" | "held-back" };

export const exchangeOutcome = (input: {
  readonly hasMore: boolean;
  readonly moreDue: boolean;
}): ExchangeOutcome =>
  input.hasMore
    ? { _tag: "MorePending", reason: "server-pages" }
    : input.moreDue
      ? { _tag: "MorePending", reason: "held-back" }
      : { _tag: "Drained" };
