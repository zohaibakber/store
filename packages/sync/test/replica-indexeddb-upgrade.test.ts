import * as IndexedDb from "@effect/platform-browser/IndexedDb";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { LAST_UNIT_ORGANIZATION_ID, LAST_UNIT_REPLICA_A } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { ReplicaIndexedDbV1 } from "../src/replica/indexeddb/schema";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";

const databaseName = "replica-upgrade";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

type OpenDatabase = {
  readonly version: number;
  readonly stores: ReadonlyArray<string>;
};

const inspectDatabase = Effect.callback<OpenDatabase, Error>((resume) => {
  const request = indexedDB.open(databaseName);
  request.onsuccess = () => {
    const database = request.result;
    const opened: OpenDatabase = {
      version: database.version,
      stores: [...database.objectStoreNames],
    };
    database.close();
    resume(Effect.succeed(opened));
  };
  request.onerror = () => resume(Effect.fail(new Error("The database could not be opened.")));
});

const openVersionOneDatabase = Effect.gen(function* () {
  const runtime = ManagedRuntime.make(
    ReplicaIndexedDbV1.layer(databaseName).pipe(
      Layer.provide(Layer.succeed(IndexedDb.IndexedDb, IndexedDb.make({ indexedDB, IDBKeyRange }))),
    ),
  );
  yield* Effect.promise(() => runtime.runPromise(Effect.void));
  yield* Effect.promise(() => runtime.dispose());
});

describe("IndexedDB replica schema versions", () => {
  it.effect("upgrades a version one database by adding the pending projection stores", () =>
    Effect.gen(function* () {
      yield* openVersionOneDatabase;
      const before = yield* inspectDatabase;
      expect(before.version).toBe(1);
      expect(before.stores).not.toContain("pending_row_marks");
      expect(before.stores).not.toContain("pending_row_journal");
      expect(before.stores).toContain("command_outbox");

      const store = yield* makeIndexedDbReplicaStore({
        databaseName,
        databaseIdentity: databaseName,
        identity: {
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          userId: "user-1",
          replicaId: LAST_UNIT_REPLICA_A,
        },
        indexedDB,
        IDBKeyRange,
      });
      const marks = yield* store.readPendingMarks();
      expect(marks).toHaveLength(0);
      yield* store.dispose();

      const after = yield* inspectDatabase;
      expect(after.version).toBe(2);
      expect(after.stores).toContain("pending_row_marks");
      expect(after.stores).toContain("pending_row_journal");
      expect(after.stores).toContain("command_outbox");
    }),
  );
});
