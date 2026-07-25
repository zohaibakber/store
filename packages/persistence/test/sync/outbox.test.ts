import {
  MAX_SYNC_CHANGES_PER_OPERATION,
  MAX_SYNC_CHANGES_PER_REQUEST,
  MAX_SYNC_OPERATIONS_PER_REQUEST,
} from "@store/contracts";
import { expect, test } from "vitest";

import { exchangeOutcome, selectBatch } from "../../src/sync/outbox";

const queued = (operationId: string, changes: number) => ({
  operationId,
  payload: Array.from({ length: changes }, (_, index) => ({ index })),
});

const selected = (due: ReadonlyArray<ReturnType<typeof queued>>) => {
  const batch = selectBatch(due);
  if (batch._tag !== "Selected") throw new Error(`Expected a batch, got ${batch.reason}`);
  return batch;
};

test("an empty outbox produces an empty, drained batch", () => {
  const batch = selected([]);
  expect(batch.operations).toEqual([]);
  expect(batch.changeCount).toBe(0);
  expect(batch.moreDue).toBe(false);
});

test("everything that fits goes out in one request", () => {
  const due = [queued("a", 2), queued("b", 3), queued("c", 1)];
  const batch = selected(due);
  expect(batch.operations.map((operation) => operation.operationId)).toEqual(["a", "b", "c"]);
  expect(batch.changeCount).toBe(6);
  expect(batch.moreDue).toBe(false);
});

test("the operations-per-request cap holds the rest back", () => {
  const due = Array.from({ length: MAX_SYNC_OPERATIONS_PER_REQUEST + 5 }, (_, index) =>
    queued(`operation-${index}`, 1),
  );
  const batch = selected(due);
  expect(batch.operations).toHaveLength(MAX_SYNC_OPERATIONS_PER_REQUEST);
  expect(batch.moreDue).toBe(true);
});

test("the changes-per-request cap cuts the batch at the operation boundary", () => {
  const due = [queued("a", MAX_SYNC_CHANGES_PER_REQUEST - 1), queued("b", 5), queued("c", 1)];
  const batch = selected(due);
  expect(batch.operations.map((operation) => operation.operationId)).toEqual(["a"]);
  expect(batch.changeCount).toBe(MAX_SYNC_CHANGES_PER_REQUEST - 1);
  expect(batch.moreDue).toBe(true);
});

test("a head-of-line operation filling the whole request is sent alone", () => {
  const batch = selected([queued("big", MAX_SYNC_CHANGES_PER_REQUEST), queued("next", 1)]);
  expect(batch.operations.map((operation) => operation.operationId)).toEqual(["big"]);
  expect(batch.changeCount).toBe(MAX_SYNC_CHANGES_PER_REQUEST);
  expect(batch.moreDue).toBe(true);
});

test("an operation with no changes is unsendable", () => {
  const batch = selectBatch([queued("empty", 0)]);
  expect(batch._tag).toBe("Unsendable");
  if (batch._tag === "Unsendable") expect(batch.operationId).toBe("empty");
});

test("an operation past the per-operation change cap is unsendable", () => {
  const batch = selectBatch([queued("huge", MAX_SYNC_CHANGES_PER_OPERATION + 1)]);
  expect(batch._tag).toBe("Unsendable");
  if (batch._tag === "Unsendable") expect(batch.operationId).toBe("huge");
});

test("an unsendable operation is reported even when it follows a sendable one", () => {
  const batch = selectBatch([queued("fine", 1), queued("empty", 0)]);
  expect(batch._tag).toBe("Unsendable");
  if (batch._tag === "Unsendable") expect(batch.operationId).toBe("empty");
});

test("exchangeOutcome distinguishes why an exchange stopped", () => {
  expect(exchangeOutcome({ hasMore: false, moreDue: false })).toEqual({ _tag: "Drained" });
  expect(exchangeOutcome({ hasMore: true, moreDue: false })).toEqual({
    _tag: "MorePending",
    reason: "server-pages",
  });
  expect(exchangeOutcome({ hasMore: false, moreDue: true })).toEqual({
    _tag: "MorePending",
    reason: "held-back",
  });
  expect(exchangeOutcome({ hasMore: true, moreDue: true })._tag).toBe("MorePending");
});
