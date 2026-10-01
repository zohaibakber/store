import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartHash,
  type SnapshotManifest,
} from "@store/contracts";
import {
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { enqueueRequestOf } from "./lib/enqueue";
import { seedCatalogGroup } from "./lib/pending-fixture";

const databaseName = "replica-idb-generation";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

const managed = {
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: LAST_UNIT_REPLICA_A,
  operationId: "snapshot",
  rowVersion: 3,
};

const snapshotId = SnapshotId.make("idb-generation");

const manifest: SnapshotManifest = {
  snapshotId,
  epoch: LAST_UNIT_EPOCH,
  subscription: "operational",
  schemaVersion: 1,
  horizon: OrgCommitSequence.make("3"),
  parts: [1, 2].map((partNumber) => ({
    partNumber,
    byteLength: 1,
    sha256: SnapshotPartHash.make("a".repeat(64)),
  })),
  entityCounts: [],
  digestVersion: 3,
};

const count = (store: string, generation: number) =>
  new Promise<number>((resolve, reject) => {
    const open = indexedDB.open(databaseName);
    open.onsuccess = () => {
      const db = open.result;
      const request = db
        .transaction(store, "readonly")
        .objectStore(store)
        .count(IDBKeyRange.bound([generation], [generation, []]));
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  });

const stagedCount = () =>
  new Promise<number>((resolve, reject) => {
    const open = indexedDB.open(databaseName);
    open.onsuccess = () => {
      const db = open.result;
      const request = db
        .transaction("snapshot_staged_rows", "readonly")
        .objectStore("snapshot_staged_rows")
        .count();
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  });

const batchRows = (part: number, length: number) =>
  Array.from({ length }, (_, index) => ({
    entity: "batch" as const,
    entityId: `batch-${part}-${index}`,
    rowVersion: 3,
    row: {
      id: `batch-${part}-${index}`,
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: "B",
      expiresAt: null,
      packQuantity: 0,
      unitQuantity: 8,
      ...managed,
    },
  }));

describe("IndexedDB snapshot activation", () => {
  it.live(
    "keeps imported rows out of the active generation until activation, then retires the old one",
    () =>
      Effect.gen(function* () {
        const store = yield* makeIndexedDbReplicaStore({
          databaseName,
          databaseIdentity: "idb-generation",
          identity: {
            organizationId: LAST_UNIT_ORGANIZATION_ID,
            userId: "user-1",
            replicaId: LAST_UNIT_REPLICA_A,
          },
          indexedDB,
          IDBKeyRange,
        });
        yield* store.applyTransactionGroup(seedCatalogGroup);
        yield* store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
        const activeBatches = yield* Effect.promise(() => count("batches", 1));
        yield* store.beginSnapshotImport(manifest);
        yield* store.importSnapshotPart(manifest, {
          snapshotId,
          partNumber: 1,
          rows: batchRows(1, 500),
        });
        yield* store.importSnapshotPart(manifest, {
          snapshotId,
          partNumber: 2,
          rows: batchRows(2, 100),
        });
        expect(yield* Effect.promise(stagedCount)).toBe(0);
        expect(yield* Effect.promise(() => count("batches", 2))).toBe(600);
        expect(yield* Effect.promise(() => count("batches", 1))).toBe(activeBatches);
        expect((yield* store.readStamp()).generationId).toBe("1");

        const activated = yield* store.activateSnapshot(snapshotId);
        expect(activated.value._tag).toBe("activated");
        expect(activated.notice?.fullInvalidation).toBe(true);
        expect((yield* store.readStamp()).generationId).toBe("2");
        expect(yield* Effect.promise(() => count("batches", 2))).toBe(600);
        expect(yield* Effect.promise(stagedCount)).toBe(0);
        expect((yield* store.readPendingMarks()).length).toBeGreaterThan(0);

        yield* Effect.sleep("200 millis");
        expect(yield* Effect.promise(() => count("batches", 1))).toBe(0);
        expect(yield* Effect.promise(() => count("products", 1))).toBe(0);
        yield* store.dispose();
      }),
  );

  it.live("restarts an abandoned import of the same snapshot from scratch", () =>
    Effect.gen(function* () {
      const store = yield* makeIndexedDbReplicaStore({
        databaseName,
        databaseIdentity: "idb-generation-restart",
        identity: {
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          userId: "user-1",
          replicaId: LAST_UNIT_REPLICA_A,
        },
        indexedDB,
        IDBKeyRange,
      });
      yield* store.applyTransactionGroup(seedCatalogGroup);
      yield* store.beginSnapshotImport(manifest);
      yield* store.importSnapshotPart(manifest, {
        snapshotId,
        partNumber: 1,
        rows: batchRows(1, 700),
      });
      yield* store.abandonSnapshot(snapshotId);

      const restarted = yield* store.beginSnapshotImport(manifest);
      expect(restarted.partsImported).toBe(0);
      expect(yield* Effect.promise(stagedCount)).toBe(0);
      yield* store.importSnapshotPart(manifest, {
        snapshotId,
        partNumber: 1,
        rows: batchRows(1, 20),
      });
      yield* store.importSnapshotPart(manifest, {
        snapshotId,
        partNumber: 2,
        rows: batchRows(2, 10),
      });
      const activated = yield* store.activateSnapshot(snapshotId);
      expect(activated.value._tag).toBe("activated");
      expect((yield* store.readStamp()).generationId).toBe("3");
      expect(yield* Effect.promise(() => count("batches", 3))).toBe(30);
      yield* Effect.sleep("200 millis");
      expect(yield* Effect.promise(() => count("batches", 2))).toBe(0);
      yield* store.dispose();
    }),
  );
});
