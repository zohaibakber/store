import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SyncEpoch,
  type SyncPullResult,
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
import { readOutboxActivitySqlite, readPendingRowIdsSqlite } from "../src/replica/sqlite/activity";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import type { ReplicaStoreContract } from "../src/replica/store";
import { applyGroup } from "./lib/authority";
import { enqueueRequestOf } from "./lib/enqueue";
import { makeIndexedDbReplicaStore } from "./lib/indexeddb-store";
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
  yield* applyGroup(store, seedSpareBatchGroup);
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
  yield* applyGroup(store, seedCatalogGroup);
  yield* applyGroup(store, seedSpareBatchGroup);
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

  const submitted = catalogEnvelope({
    operationId: "catalog-submitted",
    clientSequence: "1",
    writes: [renameProductWrite("Renamed")],
  });

  const ownPageAt = (
    harness: ActivityHarness,
    commitSequence: string,
    epoch: string = LAST_UNIT_EPOCH,
  ): SyncPullResult => ({
    epoch: SyncEpoch.make(epoch),
    incarnation: AuthorityIncarnation.make(harness.incarnation),
    subscription: OPERATIONAL_SUBSCRIPTION,
    schemaVersion: 1,
    transactions: [
      {
        commitSequence: OrgCommitSequence.make(commitSequence),
        operationId: submitted.operationId,
        decision: "accepted",
        changes: [],
      },
    ],
    nextCommitSequence: OrgCommitSequence.make(commitSequence),
    horizon: OrgCommitSequence.make(commitSequence),
    retentionFloor: OrgCommitSequence.make("0"),
  });

  const submitWithPage = (harness: ActivityHarness, page: SyncPullResult) =>
    Effect.gen(function* () {
      yield* harness.store.enqueueCommand(enqueueRequestOf(submitted, 1));
      yield* harness.store.claimNextUpload({ claimId: "claim-1", claimedAt: 10, staleBefore: 0 });
      return yield* harness.store.integrateAuthority({
        receipt: {
          claimId: "claim-1",
          receipt: acceptedCatalogReceipt(submitted, page.nextCommitSequence, 1),
        },
        payload: { _tag: "submitPage", page },
      });
    });

  it.effect("integrates a submitted command from the page carried by its receipt", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const applied = yield* submitWithPage(harness, ownPageAt(harness, "3"));

        expect(applied.value).toMatchObject({
          outcome: { _tag: "applied" },
          appliedThrough: "3",
          repairRequired: false,
        });
        expect(yield* harness.store.readCommandStatus("catalog-submitted")).toBe("integrated");
        expect((yield* harness.store.readSyncCursor()).appliedCommitSequence).toBe("3");
        expect(yield* harness.readPendingRowIds("product")).toEqual([]);
      }),
    ),
  );

  it.effect("settles the receipt and leaves a page that skips a commit unapplied", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const integrated = yield* submitWithPage(harness, ownPageAt(harness, "4"));

        expect(integrated.value).toMatchObject({ outcome: { _tag: "pull" }, appliedThrough: "2" });
        expect((yield* harness.store.readSyncCursor()).appliedCommitSequence).toBe("2");
        expect(yield* harness.store.readCommandStatus("catalog-submitted")).toBe(
          "accepted_awaiting_integration",
        );
        expect(yield* harness.readPendingRowIds("product")).toEqual([LAST_UNIT_PRODUCT_ID]);
      }),
    ),
  );

  it.effect("settles the receipt and refuses a page from another epoch", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const integrated = yield* submitWithPage(harness, ownPageAt(harness, "3", "99"));

        expect(integrated.value).toMatchObject({
          outcome: { _tag: "refused", error: { code: "EPOCH_MISMATCH" } },
          appliedThrough: "2",
        });
        expect((yield* harness.store.readSyncCursor()).appliedCommitSequence).toBe("2");
        expect(yield* harness.store.readCommandStatus("catalog-submitted")).toBe(
          "accepted_awaiting_integration",
        );
        expect(yield* harness.readPendingRowIds("product")).toEqual([LAST_UNIT_PRODUCT_ID]);
      }),
    ),
  );

  it.effect("reclaims a stale upload claim as uncertain and leaves a fresh one alone", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        yield* harness.store.enqueueCommand(enqueueRequestOf(submitted, 1));
        yield* harness.store.claimNextUpload({ claimId: "claim-1", claimedAt: 10, staleBefore: 0 });

        const fresh = yield* harness.store.claimNextUpload({
          claimId: "claim-2",
          claimedAt: 20,
          staleBefore: 9,
        });
        expect(fresh.value).toBeUndefined();

        const reclaimed = yield* harness.store.claimNextUpload({
          claimId: "claim-3",
          claimedAt: 30,
          staleBefore: 10,
        });
        expect(reclaimed.value).toMatchObject({
          operationId: submitted.operationId,
          claimId: "claim-3",
          attempts: 2,
          outcomeUncertain: true,
        });
      }),
    ),
  );
});
