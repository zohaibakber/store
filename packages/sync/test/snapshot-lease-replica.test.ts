import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SnapshotId,
  syncProtocolError,
  type AcquireSnapshotRequest,
} from "@store/contracts";
import { LAST_UNIT_EPOCH, LAST_UNIT_REPLICA_A } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { makeSyncEngineFromReplicaStore } from "../src/engine";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import type { ReplicaStoreContract } from "../src/replica/store";
import { recoverFrom } from "../src/session";
import type { SyncTransport } from "../src/transport";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const databaseName = "snapshot-lease-replica";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

const recordingTransport = () => {
  const requests: Array<AcquireSnapshotRequest> = [];
  const transport: SyncTransport = {
    registerReplica: () => Effect.die("unused"),
    submitCommand: () => Effect.die("unused"),
    getReceipt: () => Effect.die("unused"),
    pull: () => Effect.fail(syncProtocolError("SNAPSHOT_REQUIRED", "Behind retained history.")),
    acquireSnapshot: (request) =>
      Effect.sync(() => {
        requests.push(request);
        return {
          _tag: "building" as const,
          snapshotId: SnapshotId.make("snapshot-building"),
          retryAfterMillis: 1_000,
        };
      }),
    readSnapshotPart: () => Effect.die("unused"),
    mintLiveTicket: () => Effect.die("unused"),
  };
  return { requests, transport };
};

const leaseRequests = (store: ReplicaStoreContract) =>
  Effect.gen(function* () {
    const pulled = recordingTransport();
    const engine = yield* makeSyncEngineFromReplicaStore(
      store,
      yield* Semaphore.make(1),
      pulled.transport,
    );
    yield* Effect.flip(
      engine.downloadOnce({
        epoch: LAST_UNIT_EPOCH,
        subscription: OPERATIONAL_SUBSCRIPTION,
        afterCommitSequence: OrgCommitSequence.make("0"),
      }),
    );
    const recovered = recordingTransport();
    yield* Effect.flip(recoverFrom(store, recovered.transport, "SNAPSHOT_REQUIRED"));
    return [...pulled.requests, ...recovered.requests];
  });

describe("snapshot download lease identity", () => {
  it("sends the replica id when acquiring a snapshot on SQLite", async () => {
    const requests = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* seedReplicaTenUnits();
          return yield* leaseRequests(yield* makeSqliteReplicaStore(handle, "sqlite-lease"));
        }),
      ),
    );
    expect(requests.map((request) => request.replicaId)).toEqual([
      LAST_UNIT_REPLICA_A,
      LAST_UNIT_REPLICA_A,
    ]);
  });

  it("sends the replica id when acquiring a snapshot on IndexedDB", async () => {
    const requests = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* makeIndexedDbReplicaStore({
          databaseName,
          databaseIdentity: databaseName,
          identity: { organizationId: "org-1", userId: "user-1", replicaId: "replica-idb" },
          indexedDB,
          IDBKeyRange,
        });
        const seen = yield* leaseRequests(store);
        yield* store.dispose();
        return seen;
      }),
    );
    expect(requests.map((request) => request.replicaId)).toEqual(["replica-idb", "replica-idb"]);
  });
});
