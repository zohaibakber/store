import { afterEach, describe, expect, it } from "@effect/vitest";
import { LAST_UNIT_REPLICA_A, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { openReplicaIdentity } from "../src/replica/commands";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { runReplicaTransaction } from "../src/replica/storage";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const databaseName = "replica-contract";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

describe("replica store contract", () => {
  it.effect("indexes enqueue, claim, and stamp the same way on SQLite and IndexedDB", () =>
    Effect.gen(function* () {
      const sqliteHandle = seedReplicaTenUnits();
      runReplicaTransaction(sqliteHandle.db, (tx) => {
        openReplicaIdentity(tx, {
          replicaId: LAST_UNIT_REPLICA_A,
          adoptPendingOutbox: false,
        });
      });
      const sqlite = yield* makeSqliteReplicaStore(sqliteHandle.db, "sqlite-contract");

      const indexed = yield* makeIndexedDbReplicaStore({
        databaseName,
        databaseIdentity: "idb-contract",
        identity: {
          organizationId: lastUnitBuyerAEnvelope.organizationId,
          userId: "user-1",
          replicaId: LAST_UNIT_REPLICA_A,
        },
        indexedDB,
        IDBKeyRange,
      });

      const sqliteQueued = yield* sqlite.enqueueCommand(lastUnitBuyerAEnvelope, 1);
      const indexedQueued = yield* indexed.enqueueCommand(lastUnitBuyerAEnvelope, 1);
      expect(sqliteQueued.value.status).toBe("pending");
      expect(indexedQueued.value.status).toBe("pending");
      expect(sqliteQueued.notice?.localCommitVersion).toBeGreaterThan(0);
      expect(indexedQueued.notice?.localCommitVersion).toBeGreaterThan(0);

      const sqliteClaim = yield* sqlite.claimNextUpload({ claimId: "c1", claimedAt: 10 });
      const indexedClaim = yield* indexed.claimNextUpload({ claimId: "c1", claimedAt: 10 });
      expect(sqliteClaim.value?.operationId).toBe(lastUnitBuyerAEnvelope.operationId);
      expect(indexedClaim.value?.operationId).toBe(lastUnitBuyerAEnvelope.operationId);

      const sqliteStamp = yield* sqlite.readStamp();
      const indexedStamp = yield* indexed.readStamp();
      expect(sqliteStamp.localCommitVersion).toBeGreaterThan(0);
      expect(indexedStamp.localCommitVersion).toBeGreaterThan(0);

      const sqliteReplay = yield* sqlite.enqueueCommand(lastUnitBuyerAEnvelope, 2);
      const indexedReplay = yield* indexed.enqueueCommand(lastUnitBuyerAEnvelope, 2);
      expect(sqliteReplay.notice).toBeUndefined();
      expect(indexedReplay.notice).toBeUndefined();

      yield* indexed.dispose();
      sqliteHandle.close();
    }),
  );

  it.effect("rejects identity mismatch without a memory fallback", () =>
    Effect.gen(function* () {
      const first = yield* makeIndexedDbReplicaStore({
        databaseName,
        databaseIdentity: "idb-contract",
        identity: {
          organizationId: lastUnitBuyerAEnvelope.organizationId,
          userId: "user-1",
          replicaId: LAST_UNIT_REPLICA_A,
        },
        indexedDB,
        IDBKeyRange,
      });
      yield* first.dispose();

      const second = makeIndexedDbReplicaStore({
        databaseName,
        databaseIdentity: "idb-contract",
        identity: {
          organizationId: lastUnitBuyerAEnvelope.organizationId,
          userId: "user-2",
          replicaId: LAST_UNIT_REPLICA_A,
        },
        indexedDB,
        IDBKeyRange,
      });
      const result = yield* Effect.flip(second);
      expect(result._tag).toBe("IndexedDbIdentityMismatch");
    }),
  );
});
