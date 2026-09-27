import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import type { ReplicaCommitNotice } from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import type { ReplicaOutboxActivity } from "../src/replica/activity";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { readOutboxActivitySqlite, readPendingRowIdsSqlite } from "../src/replica/sqlite/activity";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import type { ReplicaStoreContract } from "../src/replica/store";
import {
  catalogEnvelope,
  insertCategoryWrite,
  NEW_CATEGORY_ID,
  rejectedReceipt,
  renameProductWrite,
  seedCatalogGroup,
  seedSpareBatchGroup,
} from "./lib/pending-fixture";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

type ActivityHarness = {
  readonly store: ReplicaStoreContract;
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
    readActivity: () => readOutboxActivitySqlite(handle.sql),
    readPendingRowIds: (entity) => readPendingRowIdsSqlite(handle.sql, entity),
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

  it.effect("reports pending and rejected commands with their receipts and pending rows", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const empty = yield* harness.readActivity();
        expect(empty).toEqual({ statusCounts: [], rejected: [], caughtUpAt: null });

        const rejected = catalogEnvelope({
          operationId: "catalog-rejected",
          clientSequence: "1",
          writes: [renameProductWrite("Renamed")],
        });
        yield* harness.store.enqueueCommand(rejected, 1);
        expect(yield* harness.readPendingRowIds("product")).toEqual([LAST_UNIT_PRODUCT_ID]);
        yield* harness.store.claimNextUpload({ claimId: "claim-1", claimedAt: 10 });
        yield* harness.store.settleUploadClaim("claim-1", rejectedReceipt(rejected, "6"));

        const pending = catalogEnvelope({
          operationId: "catalog-pending",
          clientSequence: "2",
          writes: [insertCategoryWrite],
        });
        yield* harness.store.enqueueCommand(pending, 2);

        const activity = yield* harness.readActivity();
        expect(
          [...activity.statusCounts].sort((left, right) => left.status.localeCompare(right.status)),
        ).toEqual([
          { status: "pending", count: 1 },
          { status: "rejected", count: 1 },
        ]);
        expect(activity.rejected.map((row) => row.operationId)).toEqual(["catalog-rejected"]);
        expect(activity.rejected[0]?.clientSequence).toBe("1");
        expect(activity.rejected[0]?.receiptJson).toContain("ENTITY_CONFLICT");
        expect(yield* harness.readPendingRowIds("product")).toEqual([]);
        expect(yield* harness.readPendingRowIds("category")).toEqual([NEW_CATEGORY_ID]);
      }),
    ),
  );

  it.effect("records the caught-up time and publishes it without a new local version", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const before = yield* harness.store.readStamp();
        const received = yield* harness.store.commits.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        const recorded = yield* harness.store.recordCaughtUp(1_234);
        const notices: ReadonlyArray<ReplicaCommitNotice> = yield* Fiber.join(received);
        expect(recorded.notice?.localCommitVersion).toBe(before.localCommitVersion);
        expect(notices.map((notice) => notice.touchedEntities)).toEqual([[]]);
        expect((yield* harness.readActivity()).caughtUpAt).toBe(1_234);
        expect(yield* harness.store.readStamp()).toEqual(before);
      }),
    ),
  );
});
