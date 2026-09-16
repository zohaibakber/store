import {
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartHash,
  type SnapshotManifest,
  type SnapshotPartPayload,
} from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { batches, commandOutbox, replicaState } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { commandStatus, saveLocalCommand, visibleBatchStock } from "../src/replica/commands";
import {
  activateSnapshotGeneration,
  beginSnapshotImport,
  importSnapshotPart,
  pendingOutboxCount,
} from "../src/replica/import";
import { runReplicaTransaction } from "../src/replica/storage";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const manifest: SnapshotManifest = {
  snapshotId: SnapshotId.make("snapshot-1"),
  epoch: LAST_UNIT_EPOCH,
  subscription: "operational",
  schemaVersion: 1,
  horizon: OrgCommitSequence.make("3"),
  parts: [
    {
      partNumber: 1,
      objectKey: "parts/1",
      byteLength: 1,
      sha256: SnapshotPartHash.make("a".repeat(64)),
    },
  ],
  entityCounts: [{ entity: "batch", rowCount: 1 }],
};

const partPayload: SnapshotPartPayload = {
  snapshotId: manifest.snapshotId,
  partNumber: 1,
  rows: [
    {
      entity: "batch",
      entityId: LAST_UNIT_BATCH_ID,
      rowVersion: 3,
      row: {
        id: LAST_UNIT_BATCH_ID,
        productId: LAST_UNIT_PRODUCT_ID,
        batchNumber: "B-1",
        expiresAt: null,
        packQuantity: 0,
        unitQuantity: 8,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_003,
        deletedAt: null,
        organizationId: LAST_UNIT_ORGANIZATION_ID,
        createdByUserId: "user-1",
        updatedByUserId: "user-1",
        deviceId: LAST_UNIT_REPLICA_A,
        operationId: "snapshot-batch",
        rowVersion: 3,
      },
    },
  ],
};

describe("replica snapshot import", () => {
  it("imports the same part twice without duplicating rows", () => {
    const store = seedReplicaTenUnits();
    runReplicaTransaction(store.db, (tx) => {
      beginSnapshotImport(tx, manifest);
      const first = importSnapshotPart(tx, manifest, partPayload);
      const second = importSnapshotPart(tx, manifest, partPayload);
      expect(first).toEqual({ _tag: "caught_up", throughCommitSequence: "3" });
      expect(second).toEqual({ _tag: "caught_up", throughCommitSequence: "3" });
      expect(
        tx.select().from(batches).where(eq(batches.id, LAST_UNIT_BATCH_ID)).all(),
      ).toHaveLength(1);
      expect(
        tx.select().from(batches).where(eq(batches.id, LAST_UNIT_BATCH_ID)).get()?.unitQuantity,
      ).toBe(8);
    });
    store.close();
  });

  it("activates a snapshot generation while preserving pending commands", () => {
    const store = seedReplicaTenUnits();
    runReplicaTransaction(store.db, (tx) => {
      saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
      beginSnapshotImport(tx, manifest);
      importSnapshotPart(tx, manifest, partPayload);
      activateSnapshotGeneration(tx, manifest.snapshotId);
      expect(pendingOutboxCount(tx)).toBe(1);
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe("pending");
      expect(visibleBatchStock(tx, LAST_UNIT_BATCH_ID)?.unitQuantity).toBe(7);
      expect(tx.select().from(replicaState).get()?.activeGeneration).toBe(2);
      expect(tx.select().from(replicaState).get()?.appliedCommitSequence).toBe("3");
      expect(
        tx
          .select()
          .from(commandOutbox)
          .where(eq(commandOutbox.operationId, lastUnitBuyerAEnvelope.operationId))
          .get(),
      ).toBeDefined();
    });
    store.close();
  });
});
