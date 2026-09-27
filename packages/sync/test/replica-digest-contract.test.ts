import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OrgCommitSequence,
  SyncEpoch,
  type SyncPullRequest,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { TestClock } from "effect/testing";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeSyncEngineFromReplicaStore } from "../src/engine";
import { DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS } from "../src/replica/digest-cadence";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import type { ReplicaStoreContract } from "../src/replica/store";
import type { SyncTransport } from "../src/transport";
import {
  authorityDigest,
  commitToAuthority,
  makeAuthorityPartition,
  serverChangeLog,
  serverPartitionDigest,
  type AuthorityPartition,
  type PostgresPartitionTables,
} from "./lib/authority-digest";
import {
  catalogEnvelope,
  FIXTURE_NOW,
  renameProductWrite,
  seedCatalogGroup,
  seedSpareBatchGroup,
  SPARE_BATCH_ID,
} from "./lib/pending-fixture";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const NOW = Date.UTC(2026, 8, 22, 9, 0, 0);

const pullRequest: SyncPullRequest = {
  epoch: SyncEpoch.make(LAST_UNIT_EPOCH),
  subscription: "operational",
  afterCommitSequence: OrgCommitSequence.make("0"),
};

type StoreHarness = {
  readonly store: ReplicaStoreContract;
  readonly incarnation: string;
  readonly close: () => Effect.Effect<void, unknown>;
};

const makeSqliteHarness = Effect.fn("digest.sqlite")(function* () {
  const scope = yield* Scope.make();
  const handle = yield* Scope.provide(seedReplicaTenUnits(), scope);
  const store = yield* makeSqliteReplicaStore(handle, "sqlite-digest");
  return {
    store,
    incarnation: "incarnation-test",
    close: () => Scope.close(scope, Exit.void),
  } satisfies StoreHarness;
});

let databaseCounter = 0;

const makeIndexedHarness = Effect.fn("digest.indexeddb")(function* () {
  databaseCounter += 1;
  const databaseName = `replica-digest-${databaseCounter}`;
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
  return {
    store,
    incarnation: "local",
    close: () =>
      store
        .dispose()
        .pipe(Effect.tap(() => Effect.sync(() => indexedDB.deleteDatabase(databaseName)))),
  } satisfies StoreHarness;
});

type Authority = {
  readonly partition: AuthorityPartition;
  readonly log: Ref.Ref<ReadonlyArray<SyncTransactionGroup>>;
  readonly requested: Ref.Ref<ReadonlyArray<boolean>>;
};

const makeAuthority = Effect.fn("digest.authority")(function* () {
  const partition = makeAuthorityPartition();
  commitToAuthority(partition, seedCatalogGroup);
  commitToAuthority(partition, seedSpareBatchGroup);
  return {
    partition,
    log: yield* Ref.make<ReadonlyArray<SyncTransactionGroup>>([
      seedCatalogGroup,
      seedSpareBatchGroup,
    ]),
    requested: yield* Ref.make<ReadonlyArray<boolean>>([]),
  } satisfies Authority;
});

const commit = (authority: Authority, group: SyncTransactionGroup) =>
  Effect.gen(function* () {
    commitToAuthority(authority.partition, group);
    yield* Ref.update(authority.log, (log) => [...log, group]);
  });

const authorityTransport = (incarnation: string, authority: Authority): SyncTransport => ({
  registerReplica: () => Effect.die("unused"),
  submitCommand: () => Effect.die("unused"),
  getReceipt: () => Effect.succeed(undefined),
  pull: (request) =>
    Effect.gen(function* () {
      const wanted = request.includeDigest === true;
      yield* Ref.update(authority.requested, (calls) => [...calls, wanted]);
      const log = yield* Ref.get(authority.log);
      const head = log.at(-1)?.commitSequence ?? OrgCommitSequence.make("0");
      const page: SyncPullResult = {
        epoch: SyncEpoch.make(LAST_UNIT_EPOCH),
        incarnation: AuthorityIncarnation.make(incarnation),
        subscription: "operational",
        schemaVersion: 1,
        transactions: log,
        nextCommitSequence: head,
        horizon: head,
        retentionFloor: OrgCommitSequence.make("0"),
      };
      return wanted ? { ...page, digest: authorityDigest(authority.partition) } : page;
    }),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
  mintLiveTicket: () => Effect.die("unused"),
});

const managed = (operationId: string, rowVersion: number) => ({
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW + rowVersion,
  deletedAt: null,
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  createdByUserId: "user-1",
  updatedByUserId: "user-2",
  deviceId: "replica-b",
  operationId,
  rowVersion,
});

const remoteChanges: ReadonlyArray<SyncTransactionGroup> = [
  {
    commitSequence: OrgCommitSequence.make("3"),
    operationId: "remote-rename",
    decision: "accepted",
    changes: [
      {
        entity: "product",
        action: "upsert",
        entityId: LAST_UNIT_PRODUCT_ID,
        rowVersion: 2,
        row: {
          id: LAST_UNIT_PRODUCT_ID,
          name: "Renamed remotely",
          categoryId: "general",
          aisle: "A1",
          composition: null,
          strength: "5mg",
          unitsPerPack: 1,
          purchasePrice: 55,
          retailPrice: 110,
          unitPrice: 110,
          visible: false,
          ...managed("remote-rename", 2),
        },
      },
    ],
  },
  {
    commitSequence: OrgCommitSequence.make("4"),
    operationId: "remote-restock",
    decision: "accepted",
    changes: [
      {
        entity: "batch",
        action: "upsert",
        entityId: LAST_UNIT_BATCH_ID,
        rowVersion: 2,
        row: {
          id: LAST_UNIT_BATCH_ID,
          productId: LAST_UNIT_PRODUCT_ID,
          batchNumber: "B-1",
          expiresAt: FIXTURE_NOW + 86_400_000,
          packQuantity: 3,
          unitQuantity: 7,
          ...managed("remote-restock", 2),
        },
      },
      {
        entity: "stockMovement",
        action: "upsert",
        entityId: "remote-restock-movement",
        rowVersion: 1,
        row: {
          id: "remote-restock-movement",
          productId: LAST_UNIT_PRODUCT_ID,
          batchId: LAST_UNIT_BATCH_ID,
          invoiceId: null,
          type: "adjustment",
          packDelta: 3,
          unitDelta: -3,
          note: null,
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          actorUserId: "user-2",
          deviceId: "replica-b",
          operationId: "remote-restock",
          createdAt: FIXTURE_NOW,
        },
      },
    ],
  },
  {
    commitSequence: OrgCommitSequence.make("5"),
    operationId: "remote-delete",
    decision: "accepted",
    changes: [
      {
        entity: "batch",
        action: "delete",
        entityId: SPARE_BATCH_ID,
        rowVersion: 2,
        row: { id: SPARE_BATCH_ID, deletedAt: FIXTURE_NOW + 10 },
      },
    ],
  },
  {
    commitSequence: OrgCommitSequence.make("6"),
    operationId: "remote-category",
    decision: "accepted",
    changes: [
      {
        entity: "category",
        action: "upsert",
        entityId: "remote-category",
        rowVersion: 1,
        row: {
          id: "remote-category",
          name: "Remote shelf",
          tracksPacks: false,
          ...managed("remote-category", 1),
        },
      },
    ],
  },
];

const withEngine = <A, E>(
  harness: StoreHarness,
  authority: Authority,
  use: (
    engine: Effect.Success<ReturnType<typeof makeSyncEngineFromReplicaStore>>,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const mutex = yield* Semaphore.make(1);
    const engine = yield* makeSyncEngineFromReplicaStore(
      harness.store,
      mutex,
      authorityTransport(harness.incarnation, authority),
      { digestVerificationIntervalMillis: DEFAULT_DIGEST_VERIFICATION_INTERVAL_MILLIS },
    );
    return yield* use(engine);
  });

const harnesses = [
  ["sqlite", makeSqliteHarness],
  ["indexeddb", makeIndexedHarness],
] as const;

describe.each(harnesses)("digest verification (%s)", (_name, makeHarness) => {
  it.effect("requests a digest on the first pull and then only after the interval", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = yield* makeHarness();
      const authority = yield* makeAuthority();
      yield* withEngine(harness, authority, (engine) =>
        Effect.gen(function* () {
          yield* engine.downloadOnce(pullRequest);
          expect(yield* Ref.get(authority.requested)).toEqual([true]);
          expect(yield* harness.store.readDigestVerification("operational")).toBe(NOW);

          yield* TestClock.adjust("1 hour");
          yield* engine.downloadOnce(pullRequest);
          expect(yield* Ref.get(authority.requested)).toEqual([true, false]);

          yield* TestClock.adjust("6 hours");
          yield* engine.downloadOnce(pullRequest);
          expect(yield* Ref.get(authority.requested)).toEqual([true, false, true]);
          expect(yield* harness.store.readDigestVerification("operational")).toBe(NOW + 25_200_000);
        }),
      );
      yield* harness.close();
    }),
  );

  it.effect("records the caught-up time on the first caught-up pull and then once a minute", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = yield* makeHarness();
      const authority = yield* makeAuthority();
      const recorded = yield* Ref.make<ReadonlyArray<number>>([]);
      const counting: StoreHarness = {
        ...harness,
        store: {
          ...harness.store,
          recordCaughtUp: (caughtUpAt) =>
            Ref.update(recorded, (times) => [...times, caughtUpAt]).pipe(
              Effect.andThen(harness.store.recordCaughtUp(caughtUpAt)),
            ),
        },
      };
      yield* withEngine(counting, authority, (engine) =>
        Effect.gen(function* () {
          yield* engine.downloadOnce(pullRequest);
          yield* TestClock.adjust("30 seconds");
          yield* engine.downloadOnce(pullRequest);
          yield* TestClock.adjust("31 seconds");
          yield* engine.downloadOnce(pullRequest);
        }),
      );
      expect(yield* Ref.get(recorded)).toEqual([NOW, NOW + 61_000]);
      yield* harness.close();
    }),
  );

  it.effect("verifies the local rows against the authority digest after accepted changes", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = yield* makeHarness();
      const authority = yield* makeAuthority();
      yield* withEngine(harness, authority, (engine) =>
        Effect.gen(function* () {
          yield* engine.downloadOnce(pullRequest);
          for (const group of remoteChanges) {
            yield* commit(authority, group);
            yield* TestClock.adjust("7 hours");
            const exit = yield* Effect.exit(engine.downloadOnce(pullRequest));
            expect(Exit.isSuccess(exit)).toBe(true);
          }
          expect(yield* Ref.get(authority.requested)).toEqual([true, true, true, true, true]);
          expect(yield* harness.store.readDigestVerification("operational")).toBe(
            NOW + 4 * 25_200_000,
          );
        }),
      );
      yield* harness.close();
    }),
  );

  it.effect("marks coverage for repair when a local row diverges from the authority", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = yield* makeHarness();
      const authority = yield* makeAuthority();
      yield* withEngine(harness, authority, (engine) =>
        Effect.gen(function* () {
          yield* engine.downloadOnce(pullRequest);
          const [tampered] = remoteChanges;
          if (tampered === undefined) return yield* Effect.die("missing fixture");
          yield* harness.store.applyTransactionGroup(tampered);
          yield* TestClock.adjust("7 hours");
          const failure = yield* Effect.exit(engine.downloadOnce(pullRequest));
          expect(Exit.isFailure(failure)).toBe(true);
          expect(yield* Ref.get(authority.requested)).toEqual([true, true]);
          expect(yield* harness.store.readDigestVerification("operational")).toBeUndefined();
        }),
      );
      yield* harness.close();
    }),
  );

  it.effect("skips verification while a catalog shadow is pending", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const harness = yield* makeHarness();
      const authority = yield* makeAuthority();
      yield* withEngine(harness, authority, (engine) =>
        Effect.gen(function* () {
          yield* engine.downloadOnce(pullRequest);
          yield* harness.store.enqueueCommand(
            catalogEnvelope({
              operationId: "pending-rename",
              clientSequence: "1",
              writes: [renameProductWrite("Local only")],
            }),
            NOW,
          );
          yield* TestClock.adjust("7 hours");
          const exit = yield* Effect.exit(engine.downloadOnce(pullRequest));
          expect(Exit.isSuccess(exit)).toBe(true);
          expect(yield* Ref.get(authority.requested)).toEqual([true, true]);
          expect(yield* harness.store.readDigestVerification("operational")).toBe(NOW);
        }),
      );
      yield* harness.close();
    }),
  );
});

const serverMetadata = (operationId: string, rowVersion: number) => ({
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  createdByUserId: "user-1",
  updatedByUserId: "user-2",
  deviceId: "replica-b",
  operationId,
  rowVersion,
});

const serverTables: PostgresPartitionTables = {
  categories: [
    {
      id: "general",
      name: "General",
      tracksPacks: true,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW + 3,
      ...serverMetadata("server-general", 3),
    },
    {
      id: "tea",
      name: "Tea",
      tracksPacks: false,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
      ...serverMetadata("server-tea", 1),
    },
  ],
  products: [
    {
      id: LAST_UNIT_PRODUCT_ID,
      name: "Ten pack",
      categoryId: "tea",
      aisle: "B2",
      composition: null,
      strength: "10mg",
      unitsPerPack: 10,
      purchasePrice: 50,
      retailPrice: null,
      unitPrice: 12,
      visible: true,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW + 5,
      deletedAt: null,
      ...serverMetadata("server-product", 5),
    },
    {
      id: "retired-product",
      name: "Retired",
      categoryId: "general",
      aisle: null,
      composition: null,
      strength: null,
      unitsPerPack: 1,
      purchasePrice: null,
      retailPrice: null,
      unitPrice: null,
      visible: false,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW + 9,
      deletedAt: FIXTURE_NOW + 9,
      ...serverMetadata("server-retire", 2),
    },
  ],
  batches: [
    {
      id: LAST_UNIT_BATCH_ID,
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: null,
      expiresAt: FIXTURE_NOW + 86_400_000,
      packQuantity: 4,
      unitQuantity: 7,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW + 2,
      deletedAt: null,
      ...serverMetadata("server-batch", 2),
    },
    {
      id: "sold-out-batch",
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: "OLD",
      expiresAt: null,
      packQuantity: 0,
      unitQuantity: 0,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW + 4,
      deletedAt: FIXTURE_NOW + 4,
      ...serverMetadata("server-sold-out", 3),
    },
  ],
};

describe.each(harnesses)(
  "client digest matches the server partition digest (%s)",
  (_name, makeHarness) => {
    it.effect("verifies a replica built from server-shaped change rows", () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const applied = yield* harness.store.applyRemotePage({
          epoch: SyncEpoch.make(LAST_UNIT_EPOCH),
          incarnation: AuthorityIncarnation.make(harness.incarnation),
          subscription: "operational",
          schemaVersion: 1,
          transactions: [
            {
              commitSequence: OrgCommitSequence.make("1"),
              operationId: "server-dataset",
              decision: "accepted",
              changes: serverChangeLog(serverTables),
            },
          ],
          nextCommitSequence: OrgCommitSequence.make("1"),
          horizon: OrgCommitSequence.make("1"),
          retentionFloor: OrgCommitSequence.make("0"),
          digest: serverPartitionDigest(serverTables),
        });
        expect(applied.value).toEqual({
          appliedThrough: "1",
          repairRequired: false,
          digestVerified: true,
        });
        yield* harness.close();
      }),
    );
  },
);
