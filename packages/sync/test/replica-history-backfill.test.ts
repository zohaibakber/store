import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  CATALOG_PARTITION_DIGEST_VERSION,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  PARTITION_DIGEST_VERSION,
  SyncEpoch,
  type SyncTransactionGroup,
} from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { invoiceItems, invoices, replicaState, stockMovements } from "@store/db/replica.schema";
import { replicaMigrations } from "@store/db/replica/migrations";
import { asc, count } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { TestClock } from "effect/testing";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeSyncEngineFromReplicaStore } from "../src/engine";
import { runMigrations, sqlClientMigrationTarget } from "../src/migrations";
import { sqlitePartitionDigest } from "../src/replica/digest";
import { ReplicaCoverageRepairRequired } from "../src/replica/errors";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { makeReplicaDb } from "../src/replica/sql-client/drizzle";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import {
  openReplicaStore,
  runReplicaTransaction,
  type SqliteReplicaHandle,
} from "../src/replica/storage";
import type { ReplicaStoreContract } from "../src/replica/store";
import { recoverFrom } from "../src/session";
import { classifySyncFailure, dispositionFor } from "../src/transport";
import { authorityDigest } from "./lib/authority-digest";
import {
  commitToHistoryAuthority,
  historicSales,
  historyAuthorityTransport,
  makeHistoryAuthority,
  saleGroup,
  type HistoryAuthority,
} from "./lib/history-authority";
import { FIXTURE_NOW, seedCatalogGroup } from "./lib/pending-fixture";
import { FIXTURE_USER_ID } from "./lib/replica-fixture";

const NOW = Date.UTC(2026, 8, 28, 9, 0, 0);

const HISTORY_COVERAGE_MIGRATION = "20260928150000_history_coverage";

const HISTORIC_INVOICES = 30;

const ITEMS_PER_INVOICE = 2;

const recentSale = saleGroup({
  commitSequence: "2",
  operationId: "recent-sale",
  invoiceId: "inv-recent",
  invoiceNumber: HISTORIC_INVOICES + 1,
  items: [{ itemId: "item-recent", movementId: "move-recent" }],
});

const pendingSale = lastUnitBuyerAEnvelope;

const acceptedPendingSale = (invoiceNumber: number): SyncTransactionGroup => {
  const sale = saleGroup({
    commitSequence: "3",
    operationId: pendingSale.operationId,
    invoiceId: "sale-a",
    invoiceNumber,
    items: [{ itemId: "item-a", movementId: "move-a" }],
  });
  return {
    ...sale,
    changes: [
      ...sale.changes,
      {
        entity: "batch",
        action: "upsert",
        entityId: LAST_UNIT_BATCH_ID,
        rowVersion: 2,
        row: {
          id: LAST_UNIT_BATCH_ID,
          productId: LAST_UNIT_PRODUCT_ID,
          batchNumber: "B-1",
          expiresAt: null,
          packQuantity: 0,
          unitQuantity: 9,
          createdAt: FIXTURE_NOW,
          updatedAt: FIXTURE_NOW + 1,
          deletedAt: null,
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
          deviceId: LAST_UNIT_REPLICA_A,
          operationId: pendingSale.operationId,
          rowVersion: 2,
        },
      },
    ],
  };
};

const caughtUpPage = (authority: HistoryAuthority, incarnation: string) =>
  Effect.gen(function* () {
    const log = yield* Ref.get(authority.log);
    return {
      epoch: SyncEpoch.make(LAST_UNIT_EPOCH),
      incarnation: AuthorityIncarnation.make(incarnation),
      subscription: OPERATIONAL_SUBSCRIPTION,
      schemaVersion: 1,
      transactions: log,
      nextCommitSequence: OrgCommitSequence.make("2"),
      horizon: OrgCommitSequence.make("2"),
      retentionFloor: OrgCommitSequence.make("0"),
      digest: yield* authorityDigest(authority.partition, CATALOG_PARTITION_DIGEST_VERSION),
    };
  });

const catalogOnlyReplicaState = {
  id: "singleton",
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  userId: FIXTURE_USER_ID,
  replicaId: LAST_UNIT_REPLICA_A,
  epoch: LAST_UNIT_EPOCH,
  incarnation: "incarnation-test",
  appliedCommitSequence: "0",
  nextClientSequence: "1",
  localCommitVersion: 0,
};

const migrationsBeforeUpgrade = Object.fromEntries(
  Object.entries(replicaMigrations).filter(([key]) => key < HISTORY_COVERAGE_MIGRATION),
);

const openBeforeUpgrade = (path: string) =>
  SqliteClient.make({ filename: path }).pipe(
    Effect.provide(Reactivity.layer),
    Effect.flatMap((sql) =>
      runMigrations(migrationsBeforeUpgrade, sqlClientMigrationTarget(sql)).pipe(
        Effect.andThen(makeReplicaDb(sql)),
        Effect.map((db): SqliteReplicaHandle => ({ sql, db })),
      ),
    ),
    Effect.orDie,
  );

type UpgradedReplica = {
  readonly store: ReplicaStoreContract;
  readonly incarnation: string;
  readonly handle?: SqliteReplicaHandle;
  readonly close: Effect.Effect<void>;
};

const upgradeSqliteReplica = Effect.fn("backfill.sqlite")(function* (authority: HistoryAuthority) {
  const path = join(mkdtempSync(join(tmpdir(), "store-history-backfill-")), "replica.sqlite");
  const before = yield* Scope.make();
  const legacy = yield* Scope.provide(openBeforeUpgrade(path), before);
  yield* runReplicaTransaction(legacy, (tx) =>
    tx.insert(replicaState).values(catalogOnlyReplicaState),
  ).pipe(Effect.orDie);
  const legacyStore = yield* makeSqliteReplicaStore(legacy, "history-backfill");
  const applied = yield* legacyStore.applyRemotePage(
    yield* caughtUpPage(authority, "incarnation-test"),
  );
  expect(applied.value).toMatchObject({ repairRequired: false, digestVerified: true });
  yield* legacyStore.recordDigestVerification(OPERATIONAL_SUBSCRIPTION, NOW);
  expect(yield* legacyStore.readDigestVerification(OPERATIONAL_SUBSCRIPTION)).toBe(NOW);
  yield* Scope.close(before, Exit.void);

  const after = yield* Scope.make();
  const handle = yield* Scope.provide(openReplicaStore(path), after);
  const store = yield* makeSqliteReplicaStore(handle, "history-backfill");
  expect(yield* store.readDigestVerification(OPERATIONAL_SUBSCRIPTION)).toBeUndefined();
  return {
    store,
    incarnation: "incarnation-test",
    handle,
    close: Scope.close(after, Exit.void),
  } satisfies UpgradedReplica;
});

let indexedDbCounter = 0;

const catalogOnlyIndexedDbReplica = Effect.fn("backfill.indexeddb")(function* (
  authority: HistoryAuthority,
) {
  indexedDbCounter += 1;
  const databaseName = `history-backfill-${indexedDbCounter}`;
  const store = yield* makeIndexedDbReplicaStore({
    databaseName,
    databaseIdentity: databaseName,
    identity: {
      organizationId: LAST_UNIT_ORGANIZATION_ID,
      userId: FIXTURE_USER_ID,
      replicaId: LAST_UNIT_REPLICA_A,
    },
    indexedDB,
    IDBKeyRange,
  });
  const applied = yield* store.applyRemotePage(yield* caughtUpPage(authority, "local"));
  expect(applied.value).toMatchObject({ repairRequired: false, digestVerified: true });
  yield* store.recordDigestVerification(OPERATIONAL_SUBSCRIPTION, NOW);
  yield* TestClock.adjust("7 hours");
  return {
    store,
    incarnation: "local",
    close: store
      .dispose()
      .pipe(
        Effect.andThen(Effect.sync(() => indexedDB.deleteDatabase(databaseName))),
        Effect.orDie,
      ),
  } satisfies UpgradedReplica;
});

const sqliteCounts = (handle: SqliteReplicaHandle) =>
  runReplicaTransaction(handle, (tx) =>
    Effect.gen(function* () {
      const [invoiceCount] = yield* tx.select({ value: count() }).from(invoices).all();
      const [itemCount] = yield* tx.select({ value: count() }).from(invoiceItems).all();
      const [movementCount] = yield* tx.select({ value: count() }).from(stockMovements).all();
      const numbers = yield* tx
        .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .orderBy(asc(invoices.invoiceNumber))
        .all();
      return {
        invoices: invoiceCount?.value,
        items: itemCount?.value,
        movements: movementCount?.value,
        numbers,
      };
    }),
  ).pipe(Effect.orDie);

const harnesses = [
  ["sqlite after the replica migration", upgradeSqliteReplica],
  ["indexeddb once verification is due", catalogOnlyIndexedDbReplica],
] as const;

describe.each(harnesses)("history backfill for a catalog-only replica (%s)", (_name, prepare) => {
  it.effect("repairs through a history snapshot and keeps the unsent outbox", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const authority = yield* makeHistoryAuthority(
        historicSales(HISTORIC_INVOICES, ITEMS_PER_INVOICE),
        [seedCatalogGroup, recentSale],
      );
      const replica: UpgradedReplica = yield* prepare(authority);
      const transport = historyAuthorityTransport(authority, replica.incarnation);
      const mutex = yield* Semaphore.make(1);
      const engine = yield* makeSyncEngineFromReplicaStore(replica.store, mutex, transport);

      const failure = yield* Effect.flip(engine.catchUp());
      expect(failure).toBeInstanceOf(ReplicaCoverageRepairRequired);
      expect(dispositionFor(classifySyncFailure(failure, NOW))).toEqual({
        _tag: "recover",
        code: "SNAPSHOT_REQUIRED",
      });
      expect((yield* Ref.get(authority.pulls)).map((pull) => pull.digestVersion)).toEqual([
        PARTITION_DIGEST_VERSION,
      ]);

      yield* replica.store.enqueueCommand(pendingSale, NOW);
      yield* recoverFrom(replica.store, transport, "SNAPSHOT_REQUIRED");

      expect((yield* Ref.get(authority.acquired)).map((request) => request.digestVersion)).toEqual([
        PARTITION_DIGEST_VERSION,
      ]);
      expect(yield* replica.store.readCommandStatus(pendingSale.operationId)).toBe("pending");
      const marks = yield* replica.store.readPendingMarks();
      expect(marks).toContainEqual({
        entity: "invoice",
        entityId: "sale-a",
        operationId: pendingSale.operationId,
      });
      if (replica.handle !== undefined) {
        const counts = yield* sqliteCounts(replica.handle);
        expect(counts.invoices).toBe(HISTORIC_INVOICES + 2);
        expect(counts.items).toBe(HISTORIC_INVOICES * ITEMS_PER_INVOICE + 2);
        expect(counts.movements).toBe(HISTORIC_INVOICES * ITEMS_PER_INVOICE + 2);
        expect(counts.numbers.at(0)).toEqual({ id: "inv-000000", invoiceNumber: 1 });
        expect(counts.numbers.at(-1)).toEqual({
          id: "sale-a",
          invoiceNumber: HISTORIC_INVOICES + 2,
        });
      }

      const pending = yield* Effect.exit(engine.catchUp());
      expect(Exit.isSuccess(pending)).toBe(true);
      expect(yield* replica.store.readDigestVerification(OPERATIONAL_SUBSCRIPTION)).toBeUndefined();

      yield* commitToHistoryAuthority(authority, acceptedPendingSale(HISTORIC_INVOICES + 2));
      yield* TestClock.adjust("1 minute");
      const settled = yield* Effect.exit(engine.catchUp());
      expect(Exit.isSuccess(settled)).toBe(true);
      expect(yield* replica.store.readCommandStatus(pendingSale.operationId)).toBe("integrated");
      expect(yield* replica.store.readPendingMarks()).toEqual([]);
      expect(yield* replica.store.readDigestVerification(OPERATIONAL_SUBSCRIPTION)).toBeDefined();
      expect((yield* Ref.get(authority.pulls)).at(-1)?.digestVersion).toBe(
        PARTITION_DIGEST_VERSION,
      );
      expect(yield* Ref.get(authority.acquired)).toHaveLength(1);
      if (replica.handle !== undefined) {
        const local = yield* runReplicaTransaction(replica.handle, (tx) =>
          sqlitePartitionDigest(tx, PARTITION_DIGEST_VERSION),
        ).pipe(Effect.orDie);
        expect(local).toEqual(yield* authorityDigest(authority.partition));
      }
      yield* replica.close;
    }),
  );
});

describe("history snapshot volume", () => {
  it.effect(
    "imports 5k invoices, 20k items and 20k movements across many parts and verifies the digest",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          const authority = yield* makeHistoryAuthority(historicSales(5_000, 4), [
            seedCatalogGroup,
          ]);
          const handle = yield* openReplicaStore();
          yield* runReplicaTransaction(handle, (tx) =>
            tx
              .insert(replicaState)
              .values({ ...catalogOnlyReplicaState, incarnation: "incarnation-test" }),
          ).pipe(Effect.orDie);
          const store = yield* makeSqliteReplicaStore(handle, "history-volume");
          const transport = historyAuthorityTransport(authority, "incarnation-test");
          const mutex = yield* Semaphore.make(1);
          const engine = yield* makeSyncEngineFromReplicaStore(store, mutex, transport);

          const started = performance.now();
          yield* recoverFrom(store, transport, "SNAPSHOT_REQUIRED");
          const importMillis = performance.now() - started;
          const parts = yield* Ref.get(authority.snapshotParts);
          expect(parts.size).toBe(1 + Math.ceil(45_000 / 500));

          const caughtUp = yield* Effect.exit(engine.catchUp());
          expect(Exit.isSuccess(caughtUp)).toBe(true);
          expect(yield* store.readDigestVerification(OPERATIONAL_SUBSCRIPTION)).toBe(NOW);
          const counts = yield* sqliteCounts(handle);
          expect(counts).toMatchObject({ invoices: 5_000, items: 20_000, movements: 20_000 });
          yield* Effect.logInfo("history snapshot import", { importMillis, parts: parts.size });
          expect(importMillis).toBeLessThan(60_000);
        }),
      ),
    120_000,
  );
});
