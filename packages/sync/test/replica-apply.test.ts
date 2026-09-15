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
import { describe, expect, it } from "vitest";

import { applyTransactionGroup } from "../src/replica/apply";
import {
  commandStatus,
  recordCommandReceipt,
  saveLocalCommand,
  visibleBatchStock,
} from "../src/replica/commands";
import { openReplicaStore, runReplicaTransaction } from "../src/replica/storage";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

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
    invoiceId: lastUnitBuyerAEnvelope.command.payload.invoiceId,
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

describe("replica overlay apply", () => {
  it("shows 10 then 9 with an overlay and stays 9 after the confirmed image, never 8", () => {
    const store = seedReplicaTenUnits();
    runReplicaTransaction(store.db, (tx) => {
      expect(visibleBatchStock(tx, LAST_UNIT_BATCH_ID)).toEqual({
        packQuantity: 0,
        unitQuantity: 10,
      });
      saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
      expect(visibleBatchStock(tx, LAST_UNIT_BATCH_ID)).toEqual({
        packQuantity: 0,
        unitQuantity: 9,
      });
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe("pending");
      applyTransactionGroup(tx, confirmedSale());
      expect(visibleBatchStock(tx, LAST_UNIT_BATCH_ID)).toEqual({
        packQuantity: 0,
        unitQuantity: 9,
      });
      expect(
        tx.select().from(batches).where(eq(batches.id, LAST_UNIT_BATCH_ID)).get()?.unitQuantity,
      ).toBe(9);
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe("integrated");
      applyTransactionGroup(tx, confirmedSale());
      expect(visibleBatchStock(tx, LAST_UNIT_BATCH_ID)).toEqual({
        packQuantity: 0,
        unitQuantity: 9,
      });
    });
    store.close();
  });

  it("ends at the same visible stock for receipt-first and delta-first", () => {
    const receiptFirst = seedReplicaTenUnits();
    runReplicaTransaction(receiptFirst.db, (tx) => {
      saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
      recordCommandReceipt(tx, acceptedReceipt());
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe(
        "accepted_awaiting_integration",
      );
      expect(visibleBatchStock(tx, LAST_UNIT_BATCH_ID)?.unitQuantity).toBe(9);
      applyTransactionGroup(tx, confirmedSale());
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe("integrated");
      expect(visibleBatchStock(tx, LAST_UNIT_BATCH_ID)?.unitQuantity).toBe(9);
    });
    receiptFirst.close();

    const deltaFirst = seedReplicaTenUnits();
    runReplicaTransaction(deltaFirst.db, (tx) => {
      saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
      applyTransactionGroup(tx, confirmedSale());
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe("integrated");
      recordCommandReceipt(tx, acceptedReceipt());
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe("integrated");
      expect(visibleBatchStock(tx, LAST_UNIT_BATCH_ID)?.unitQuantity).toBe(9);
    });
    deltaFirst.close();
  });
});

describe("replica command lifetime", () => {
  it("keeps a pending outbox row after reopening the sqlite file", () => {
    const directory = mkdtempSync(join(tmpdir(), "store-replica-"));
    const path = join(directory, "replica.sqlite");
    const first = seedReplicaTenUnits(path);
    runReplicaTransaction(first.db, (tx) => saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1));
    first.close();
    const reopened = openReplicaStore(path);
    runReplicaTransaction(reopened.db, (tx) => {
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe("pending");
      expect(visibleBatchStock(tx, LAST_UNIT_BATCH_ID)?.unitQuantity).toBe(9);
    });
    reopened.close();
  });

  it("does not save an outbox row when the local transaction throws", () => {
    const store = seedReplicaTenUnits();
    expect(() =>
      runReplicaTransaction(store.db, (tx) => {
        saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
        throw new Error("disk full");
      }),
    ).toThrow("disk full");
    runReplicaTransaction(store.db, (tx) => {
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBeUndefined();
      expect(visibleBatchStock(tx, LAST_UNIT_BATCH_ID)?.unitQuantity).toBe(10);
    });
    store.close();
  });
});
