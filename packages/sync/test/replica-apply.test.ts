import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OrgCommitSequence,
  type CommandReceipt,
  type SyncTransactionGroup,
} from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { batches } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { applyTransactionGroup } from "../src/replica/apply";
import {
  commandStatus,
  recordCommandReceipt,
  saveLocalCommand,
  visibleBatchStock,
} from "../src/replica/commands";
import { openReplicaStore, runReplicaTransaction } from "../src/replica/storage";
import { invoicePayloadOf, seedReplicaTenUnits, withSeededReplica } from "./lib/replica-fixture";

const confirmedBatch = (unitQuantity: number, rowVersion = 2) => ({
  id: LAST_UNIT_BATCH_ID,
  productId: LAST_UNIT_PRODUCT_ID,
  batchNumber: "B-1",
  expiresAt: null,
  packQuantity: 0,
  unitQuantity,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
  deletedAt: null,
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: LAST_UNIT_REPLICA_A,
  operationId: lastUnitBuyerAEnvelope.operationId,
  rowVersion,
});

const acceptedReceipt = (commitSequence = "1"): CommandReceipt => ({
  operationId: lastUnitBuyerAEnvelope.operationId,
  replicaId: LAST_UNIT_REPLICA_A,
  clientSequence: lastUnitBuyerAEnvelope.clientSequence,
  payloadHash: lastUnitBuyerAEnvelope.payloadHash,
  decision: "accepted",
  commitSequence: OrgCommitSequence.make(commitSequence),
  result: {
    _tag: "issueInvoice",
    invoiceId: invoicePayloadOf(lastUnitBuyerAEnvelope).invoiceId,
    invoiceNumber: 1,
  },
});

const confirmedSale = (commitSequence = "1"): SyncTransactionGroup => ({
  commitSequence: OrgCommitSequence.make(commitSequence),
  operationId: lastUnitBuyerAEnvelope.operationId,
  decision: "accepted",
  changes: [
    {
      entity: "batch",
      action: "upsert",
      entityId: LAST_UNIT_BATCH_ID,
      rowVersion: 2,
      row: confirmedBatch(9),
    },
  ],
});

const otherTerminalSale = (
  unitQuantity: number,
  commitSequence: string,
  rowVersion: number,
): SyncTransactionGroup => ({
  commitSequence: OrgCommitSequence.make(commitSequence),
  operationId: "operation-other-terminal",
  decision: "accepted",
  changes: [
    {
      entity: "batch",
      action: "upsert",
      entityId: LAST_UNIT_BATCH_ID,
      rowVersion,
      row: { ...confirmedBatch(unitQuantity, rowVersion), operationId: "operation-other-terminal" },
    },
  ],
});

describe("replica overlay apply", () => {
  it("shows 10 then 9 with an overlay and stays 9 after the confirmed image, never 8", async () => {
    const seen = await Effect.runPromise(
      withSeededReplica((store) =>
        runReplicaTransaction(store, (tx) =>
          Effect.gen(function* () {
            const start = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            yield* saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
            const overlaid = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            const pending = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
            yield* applyTransactionGroup(tx, confirmedSale());
            const confirmed = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            const stored = yield* tx
              .select()
              .from(batches)
              .where(eq(batches.id, LAST_UNIT_BATCH_ID))
              .get();
            const integrated = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
            yield* applyTransactionGroup(tx, confirmedSale());
            const replayed = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            return {
              start,
              overlaid,
              pending,
              confirmed,
              stored: stored?.unitQuantity,
              integrated,
              replayed,
            };
          }),
        ),
      ),
    );
    expect(seen.start).toEqual({ packQuantity: 0, unitQuantity: 10 });
    expect(seen.overlaid).toEqual({ packQuantity: 0, unitQuantity: 9 });
    expect(seen.pending).toBe("pending");
    expect(seen.confirmed).toEqual({ packQuantity: 0, unitQuantity: 9 });
    expect(seen.stored).toBe(9);
    expect(seen.integrated).toBe("integrated");
    expect(seen.replayed).toEqual({ packQuantity: 0, unitQuantity: 9 });
  });

  it("subtracts a pending local sale from another terminal's confirmed stock", async () => {
    const seen = await Effect.runPromise(
      withSeededReplica((store) =>
        runReplicaTransaction(store, (tx) =>
          Effect.gen(function* () {
            yield* saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
            const overlaid = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            yield* applyTransactionGroup(tx, otherTerminalSale(7, "1", 2));
            const stored = yield* tx
              .select()
              .from(batches)
              .where(eq(batches.id, LAST_UNIT_BATCH_ID))
              .get();
            const afterRemote = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            const stillPending = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
            yield* applyTransactionGroup(tx, {
              commitSequence: OrgCommitSequence.make("2"),
              operationId: lastUnitBuyerAEnvelope.operationId,
              decision: "accepted",
              changes: [
                {
                  entity: "batch",
                  action: "upsert",
                  entityId: LAST_UNIT_BATCH_ID,
                  rowVersion: 3,
                  row: confirmedBatch(6, 3),
                },
              ],
            });
            const settled = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            const integrated = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
            return {
              overlaid,
              stored: stored?.unitQuantity,
              afterRemote,
              stillPending,
              settled,
              integrated,
            };
          }),
        ),
      ),
    );
    expect(seen.overlaid).toEqual({ packQuantity: 0, unitQuantity: 9 });
    expect(seen.stored).toBe(7);
    expect(seen.afterRemote).toEqual({ packQuantity: 0, unitQuantity: 6 });
    expect(seen.stillPending).toBe("pending");
    expect(seen.settled).toEqual({ packQuantity: 0, unitQuantity: 6 });
    expect(seen.integrated).toBe("integrated");
  });

  it("ends at the same visible stock for receipt-first and delta-first", async () => {
    const receiptFirst = await Effect.runPromise(
      withSeededReplica((store) =>
        runReplicaTransaction(store, (tx) =>
          Effect.gen(function* () {
            yield* saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
            yield* recordCommandReceipt(tx, acceptedReceipt());
            const accepted = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
            const beforeDelta = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            yield* applyTransactionGroup(tx, confirmedSale());
            const integrated = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
            const afterDelta = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            return { accepted, beforeDelta, integrated, afterDelta };
          }),
        ),
      ),
    );
    expect(receiptFirst.accepted).toBe("accepted_awaiting_integration");
    expect(receiptFirst.beforeDelta?.unitQuantity).toBe(9);
    expect(receiptFirst.integrated).toBe("integrated");
    expect(receiptFirst.afterDelta?.unitQuantity).toBe(9);

    const deltaFirst = await Effect.runPromise(
      withSeededReplica((store) =>
        runReplicaTransaction(store, (tx) =>
          Effect.gen(function* () {
            yield* saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
            yield* applyTransactionGroup(tx, confirmedSale());
            const integrated = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
            yield* recordCommandReceipt(tx, acceptedReceipt());
            const afterReceipt = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
            const stock = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
            return { integrated, afterReceipt, stock };
          }),
        ),
      ),
    );
    expect(deltaFirst.integrated).toBe("integrated");
    expect(deltaFirst.afterReceipt).toBe("integrated");
    expect(deltaFirst.stock?.unitQuantity).toBe(9);
  });
});

describe("replica command lifetime", () => {
  it("keeps a pending outbox row after reopening the sqlite file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "store-replica-"));
    const path = join(directory, "replica.sqlite");
    await Effect.runPromise(
      withSeededReplica(
        (store) =>
          runReplicaTransaction(store, (tx) => saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1)),
        path,
      ),
    );
    const reopened = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openReplicaStore(path);
          return yield* runReplicaTransaction(store, (tx) =>
            Effect.gen(function* () {
              const status = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
              const stock = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
              return { status, unitQuantity: stock?.unitQuantity };
            }),
          );
        }),
      ),
    );
    expect(reopened.status).toBe("pending");
    expect(reopened.unitQuantity).toBe(9);
  });

  it("does not save an outbox row when the local transaction fails", async () => {
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* seedReplicaTenUnits();
          const failure = yield* runReplicaTransaction(store, (tx) =>
            Effect.gen(function* () {
              yield* saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
              return yield* Effect.fail("disk full");
            }),
          ).pipe(Effect.flip);
          const after = yield* runReplicaTransaction(store, (tx) =>
            Effect.gen(function* () {
              const status = yield* commandStatus(tx, lastUnitBuyerAEnvelope.operationId);
              const stock = yield* visibleBatchStock(tx, LAST_UNIT_BATCH_ID);
              return { status, unitQuantity: stock?.unitQuantity };
            }),
          );
          return { failure, after };
        }),
      ),
    );
    expect(seen.failure).toBe("disk full");
    expect(seen.after.status).toBeUndefined();
    expect(seen.after.unitQuantity).toBe(10);
  });
});
