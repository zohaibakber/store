import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartHash,
  syncProtocolError,
  type SnapshotManifest,
  type SnapshotPartPayload,
  type SyncPullRequest,
  type SyncPullResult,
} from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeSyncEngineFromReplicaStore } from "../src/engine";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import type { SyncTransport } from "../src/transport";

const databaseName = "engine-snapshot-recovery";

const manifest: SnapshotManifest = {
  snapshotId: SnapshotId.make("snapshot-engine-1"),
  epoch: LAST_UNIT_EPOCH,
  subscription: OPERATIONAL_SUBSCRIPTION,
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

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

describe("engine snapshot recovery against published transport", () => {
  it.effect("imports a ready snapshot then completes pull", () =>
    Effect.gen(function* () {
      let pullCalls = 0;
      const transport: SyncTransport = {
        registerReplica: () => Effect.die("unused"),
        submitCommand: () => Effect.die("unused"),
        getReceipt: () => Effect.die("unused"),
        pull: (_request: SyncPullRequest) => {
          pullCalls += 1;
          if (pullCalls === 1) {
            return Effect.fail(
              syncProtocolError("SNAPSHOT_REQUIRED", "This replica is behind retained history."),
            );
          }
          return Effect.succeed({
            epoch: LAST_UNIT_EPOCH,
            incarnation: AuthorityIncarnation.make("local"),
            subscription: OPERATIONAL_SUBSCRIPTION,
            schemaVersion: 1,
            transactions: [],
            nextCommitSequence: OrgCommitSequence.make("3"),
            horizon: OrgCommitSequence.make("3"),
            retentionFloor: OrgCommitSequence.make("0"),
          } satisfies SyncPullResult);
        },
        acquireSnapshot: () => Effect.succeed({ _tag: "ready" as const, manifest }),
        readSnapshotPart: (_snapshotId, partNumber) => {
          if (partNumber !== 1) {
            return Effect.fail(syncProtocolError("SNAPSHOT_UNAVAILABLE", "missing part"));
          }
          return Effect.succeed(partPayload);
        },
        mintLiveTicket: () => Effect.die("unused"),
      };

      const store = yield* makeIndexedDbReplicaStore({
        databaseName,
        databaseIdentity: "engine-recovery",
        identity: {
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          userId: "user-1",
          replicaId: LAST_UNIT_REPLICA_A,
        },
        indexedDB,
        IDBKeyRange,
      });
      const mutex = yield* Semaphore.make(1);
      const engine = yield* makeSyncEngineFromReplicaStore(store, mutex, transport);
      const applied = yield* engine.downloadOnce({
        epoch: LAST_UNIT_EPOCH,
        subscription: OPERATIONAL_SUBSCRIPTION,
        afterCommitSequence: OrgCommitSequence.make("0"),
      });
      expect(pullCalls).toBe(2);
      expect(applied).toBe("3");
      const stamp = yield* store.readStamp();
      expect(stamp.generationId).toBe("2");
      yield* store.dispose();
    }),
  );
});
