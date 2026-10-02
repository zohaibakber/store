import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
} from "@store/contracts";
import {
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import type { ReplicaOutboxActivity } from "../src/replica/activity";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { readOutboxActivitySqlite, readPendingRowIdsSqlite } from "../src/replica/sqlite/activity";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import type { ReplicaStoreContract } from "../src/replica/store";
import { enqueueRequestOf } from "./lib/enqueue";
import {
  acceptedCatalogReceipt,
  catalogEnvelope,
  renameProductWrite,
  seedCatalogGroup,
  seedSpareBatchGroup,
} from "./lib/pending-fixture";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

type ActivityHarness = {
  readonly store: ReplicaStoreContract;
  readonly incarnation: string;
  readonly readActivity: () => Effect.Effect<ReplicaOutboxActivity, unknown>;
  readonly readPendingRowIds: (
    entity: "product" | "category",
  ) => Effect.Effect<ReadonlyArray<string>, unknown>;
  readonly close: () => Effect.Effect<void, unknown>;
};

const databaseName = "replica-activity";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

const sqliteHarness = Effect.fn("activity.sqlite")(function* () {
  const scope = yield* Scope.make();
  const handle = yield* Scope.provide(seedReplicaTenUnits(), scope);
  const store = yield* makeSqliteReplicaStore(handle, "sqlite-activity");
  yield* store.applyTransactionGroup(seedSpareBatchGroup);
  return {
    store,
    incarnation: "incarnation-test",
    readActivity: () => readOutboxActivitySqlite(handle.db),
    readPendingRowIds: (entity) => readPendingRowIdsSqlite(handle.db, entity),
    close: () => Scope.close(scope, Exit.void),
  } satisfies ActivityHarness;
});

const indexedHarness = Effect.fn("activity.indexeddb")(function* () {
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
  yield* store.applyTransactionGroup(seedCatalogGroup);
  yield* store.applyTransactionGroup(seedSpareBatchGroup);
  return {
    store,
    incarnation: "local",
    readActivity: () => store.readOutboxActivity(),
    readPendingRowIds: (entity) => store.readPendingRowIds(entity),
    close: () => store.dispose(),
  } satisfies ActivityHarness;
});

const adapters = [
  ["SQLite", sqliteHarness],
  ["IndexedDB", indexedHarness],
] as const;

describe.each(adapters)("%s outbox activity", (_name, makeHarness) => {
  const withHarness = <A, E>(use: (harness: ActivityHarness) => Effect.Effect<A, E>) =>
    Effect.acquireUseRelease(makeHarness(), use, (harness) => Effect.orDie(harness.close()));

  it.effect("integrates a submitted command from the page carried by its receipt", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const submitted = catalogEnvelope({
          operationId: "catalog-submitted",
          clientSequence: "1",
          writes: [renameProductWrite("Renamed")],
        });
        yield* harness.store.enqueueCommand(enqueueRequestOf(submitted, 1));
        expect(yield* harness.readPendingRowIds("product")).toEqual([LAST_UNIT_PRODUCT_ID]);
        yield* harness.store.claimNextUpload({ claimId: "claim-1", claimedAt: 10 });

        const applied = yield* harness.store.settleUploadWithPage(
          "claim-1",
          acceptedCatalogReceipt(submitted, "3", 1),
          {
            epoch: LAST_UNIT_EPOCH,
            incarnation: AuthorityIncarnation.make(harness.incarnation),
            subscription: OPERATIONAL_SUBSCRIPTION,
            schemaVersion: 1,
            transactions: [
              {
                commitSequence: OrgCommitSequence.make("3"),
                operationId: "catalog-submitted",
                decision: "accepted",
                changes: [],
              },
            ],
            nextCommitSequence: OrgCommitSequence.make("3"),
            horizon: OrgCommitSequence.make("3"),
            retentionFloor: OrgCommitSequence.make("0"),
          },
        );

        expect(applied.value).toMatchObject({ appliedThrough: "3", repairRequired: false });
        expect(yield* harness.store.readCommandStatus("catalog-submitted")).toBe("integrated");
        expect((yield* harness.store.readSyncCursor()).appliedCommitSequence).toBe("3");
        expect(yield* harness.readPendingRowIds("product")).toEqual([]);
      }),
    ),
  );
});
