import { afterEach, describe, expect, it } from "@effect/vitest";
import { ReplicaClientSequence } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { commandOutbox } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { encodeEnvelopeJson } from "../src/replica/codecs";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { runReplicaTransaction } from "../src/replica/storage";
import { seedCatalogGroup } from "./lib/pending-fixture";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const databaseName = "replica-contract";

const rewriteIndexedDbEnvelope = (operationId: string, envelopeJson: string) =>
  new Promise<void>((resolve, reject) => {
    const opened = indexedDB.open(databaseName);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const database = opened.result;
      const transaction = database.transaction("command_outbox", "readwrite");
      const outbox = transaction.objectStore("command_outbox");
      const read = outbox.get(operationId);
      read.onsuccess = () => {
        outbox.put({ ...read.result, envelopeJson });
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });

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

  it.effect(
    "rejects a stored envelope whose identity differs from its outbox row on both adapters",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const tampered = encodeEnvelopeJson({
            ...lastUnitBuyerAEnvelope,
            clientSequence: ReplicaClientSequence.make("7"),
          });

          const sqliteHandle = yield* seedReplicaTenUnits();
          const sqlite = yield* makeSqliteReplicaStore(sqliteHandle, "sqlite-contract");
          yield* sqlite.enqueueCommand(lastUnitBuyerAEnvelope, 1);
          yield* runReplicaTransaction(sqliteHandle, (tx) =>
            tx
              .update(commandOutbox)
              .set({ envelopeJson: tampered })
              .where(eq(commandOutbox.operationId, lastUnitBuyerAEnvelope.operationId)),
          );

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
          yield* indexed.applyTransactionGroup(seedCatalogGroup);
          yield* indexed.enqueueCommand(lastUnitBuyerAEnvelope, 1);
          yield* Effect.promise(() =>
            rewriteIndexedDbEnvelope(lastUnitBuyerAEnvelope.operationId, tampered),
          );

          const sqliteClaim = yield* Effect.flip(
            sqlite.claimNextUpload({ claimId: "c1", claimedAt: 10 }),
          );
          const indexedClaim = yield* Effect.flip(
            indexed.claimNextUpload({ claimId: "c1", claimedAt: 10 }),
          );
          expect(sqliteClaim._tag === "SyncProtocolError" && sqliteClaim.code).toBe(
            "COMMAND_IDENTITY_MISMATCH",
          );
          expect(indexedClaim._tag === "SyncProtocolError" && indexedClaim.code).toBe(
            "COMMAND_IDENTITY_MISMATCH",
          );
          yield* indexed.dispose();
        }),
      ),
  );

  it.effect("reads batches with pending sale overlays applied", () =>
    Effect.gen(function* () {
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
      yield* indexed.applyTransactionGroup(seedCatalogGroup);
      yield* indexed.enqueueCommand(lastUnitBuyerAEnvelope, 1);
      const read = yield* indexed.querySubset({
        table: "batches",
        scan: { _tag: "primaryEquals", id: LAST_UNIT_BATCH_ID },
        residual: { _tag: "compare", column: "id", op: "eq", value: LAST_UNIT_BATCH_ID },
        orderBy: [],
        limit: 1,
        offset: 0,
      });
      expect(read.rows.map((row) => [row["packQuantity"], row["unitQuantity"]])).toEqual([[0, 9]]);
      yield* indexed.dispose();
    }),
  );
});
