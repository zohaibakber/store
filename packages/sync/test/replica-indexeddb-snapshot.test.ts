import { afterEach, describe, expect, it } from "@effect/vitest";
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
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import type { IndexedDbSubsetPlan } from "../src/replica/indexeddb/query";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";

const databaseName = "replica-idb-snapshot";

const managed = {
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  deletedAt: null,
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: LAST_UNIT_REPLICA_A,
  operationId: "seed",
  rowVersion: 1,
};

const manifest: SnapshotManifest = {
  snapshotId: SnapshotId.make("snapshot-idb-1"),
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

const batchPlan = (id: string): IndexedDbSubsetPlan => ({
  table: "batches",
  scan: { _tag: "primaryEquals", id },
  residual: undefined,
  orderBy: [],
  limit: 10,
  offset: 0,
});

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

describe("IndexedDB staged snapshot activation", () => {
  it.effect(
    "stages parts without writing live generation, then activates with pending overlays",
    () =>
      Effect.gen(function* () {
        const store = yield* makeIndexedDbReplicaStore({
          databaseName,
          databaseIdentity: "idb-snapshot",
          identity: {
            organizationId: LAST_UNIT_ORGANIZATION_ID,
            userId: "user-1",
            replicaId: LAST_UNIT_REPLICA_A,
          },
          indexedDB,
          IDBKeyRange,
        });

        yield* store.applyTransactionGroup({
          commitSequence: OrgCommitSequence.make("1"),
          operationId: "seed-batch",
          decision: "accepted",
          changes: [
            {
              entity: "product",
              action: "upsert",
              entityId: LAST_UNIT_PRODUCT_ID,
              rowVersion: 1,
              row: {
                id: LAST_UNIT_PRODUCT_ID,
                name: "Ten pack",
                categoryId: "general",
                aisle: null,
                composition: null,
                strength: null,
                unitsPerPack: 1,
                purchasePrice: 50,
                retailPrice: 100,
                unitPrice: 100,
                visible: true,
                ...managed,
              },
            },
            {
              entity: "batch",
              action: "upsert",
              entityId: LAST_UNIT_BATCH_ID,
              rowVersion: 1,
              row: {
                id: LAST_UNIT_BATCH_ID,
                productId: LAST_UNIT_PRODUCT_ID,
                batchNumber: "B-1",
                expiresAt: null,
                packQuantity: 0,
                unitQuantity: 10,
                ...managed,
              },
            },
          ],
        });

        yield* store.enqueueCommand(lastUnitBuyerAEnvelope, 1);
        const before = yield* store.readStamp();
        expect(before.generationId).toBe("1");

        yield* store.beginSnapshotImport(manifest);
        yield* store.importSnapshotPart(manifest, partPayload);
        yield* store.importSnapshotPart(manifest, partPayload);

        const liveBeforeActivate = yield* store.querySubset(batchPlan(LAST_UNIT_BATCH_ID));
        expect(liveBeforeActivate.rows[0]?.unitQuantity).toBe(10);

        const activated = yield* store.activateSnapshot(manifest.snapshotId);
        expect(activated.notice?.generationId).toBe("2");
        expect(activated.notice?.localCommitVersion).toBeGreaterThan(before.localCommitVersion);

        const after = yield* store.readStamp();
        expect(after.generationId).toBe("2");

        const liveAfter = yield* store.querySubset(batchPlan(LAST_UNIT_BATCH_ID));
        expect(liveAfter.rows[0]?.unitQuantity).toBe(8);

        const status = yield* store.readCommandStatus(lastUnitBuyerAEnvelope.operationId);
        expect(status).toBe("pending");

        yield* store.dispose();
      }),
  );
});
