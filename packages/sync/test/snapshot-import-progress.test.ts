import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartHash,
  type SnapshotManifest,
} from "@store/contracts";
import {
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import type { ReplicaStoreContract } from "../src/replica/store";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const databaseName = "snapshot-import-progress";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

const manifest: SnapshotManifest = {
  snapshotId: SnapshotId.make("snapshot-progress"),
  epoch: LAST_UNIT_EPOCH,
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: 1,
  horizon: OrgCommitSequence.make("4"),
  parts: [1, 2, 3].map((partNumber) => ({
    partNumber,
    objectKey: `parts/${partNumber}`,
    byteLength: 1,
    sha256: SnapshotPartHash.make("b".repeat(64)),
  })),
  entityCounts: [],
};

const part = (partNumber: number) => ({ snapshotId: manifest.snapshotId, partNumber, rows: [] });

const resumeProgress = (store: ReplicaStoreContract) =>
  Effect.gen(function* () {
    const fresh = yield* store.beginSnapshotImport(manifest);
    yield* store.importSnapshotPart(manifest, part(1));
    yield* store.importSnapshotPart(manifest, part(2));
    const resumed = yield* store.beginSnapshotImport(manifest);
    yield* store.importSnapshotPart(manifest, part(3));
    const staged = yield* store.beginSnapshotImport(manifest);
    return [fresh.partsImported, resumed.partsImported, staged.partsImported];
  });

describe("snapshot import progress", () => {
  it.effect("reports staged parts on SQLite so a resumed download skips them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* seedReplicaTenUnits();
        const store = yield* makeSqliteReplicaStore(handle, "sqlite-progress");
        expect(yield* resumeProgress(store)).toEqual([0, 2, 3]);
      }),
    ),
  );

  it.effect("reports staged parts on IndexedDB so a resumed download skips them", () =>
    Effect.gen(function* () {
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
      expect(yield* resumeProgress(store)).toEqual([0, 2, 3]);
      yield* store.dispose();
    }),
  );
});
