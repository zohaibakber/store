import { afterEach, describe, expect, it } from "@effect/vitest";
import { LAST_UNIT_REPLICA_A, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";

const databaseName = "replica-contract";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

describe("replica store contract", () => {
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
