import { describe, expect, it } from "@effect/vitest";
import { partitionDigestOf, SyncPullResult, type PartitionLeafSource } from "@store/contracts";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  pendingRowMarks,
  products,
  replicaCoverage,
  replicaState,
  stockMovements,
} from "@store/db/replica.schema";
import { sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  readDigestFence,
  verifyPulledDigest,
  type ReplicaTransactor,
} from "../src/replica/coverage";
import { sqlitePartitionDigest } from "../src/replica/digest";
import { mapReplicaStoreFailure } from "../src/replica/errors";
import type { ReplicaDb } from "../src/replica/sql-client/drizzle";
import {
  openReplicaStore,
  runReplicaTransaction,
  type SqliteReplicaHandle,
} from "../src/replica/storage";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const ORGANIZATION_ID = "org-digest";

const ADVERSARIAL_IDS = [
  "a",
  "B",
  "z",
  "z:1",
  "Z-1",
  "é",
  "日本",
  "",
  "�",
  "😀",
  "á",
  'quote"back\\slash',
] as const;

const managed = (rowVersion: number) => ({
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000 + rowVersion,
  organizationId: ORGANIZATION_ID,
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: `operation-${rowVersion}`,
  rowVersion,
});

const seed = Effect.fn("digest.seed")(function* () {
  const store = yield* openReplicaStore();
  yield* runReplicaTransaction(store, (tx) =>
    Effect.gen(function* () {
      for (const [index, id] of ADVERSARIAL_IDS.entries()) {
        yield* tx.insert(categories).values({
          id: `c-${id}`,
          name: `Category ${index}`,
          tracksPacks: true,
          ...managed(index + 1),
        });
        yield* tx.insert(products).values({
          id: `p-${id}`,
          name: `Product ${index}`,
          categoryId: `c-${id}`,
          aisle: null,
          composition: null,
          strength: null,
          unitsPerPack: 1,
          purchasePrice: null,
          retailPrice: null,
          unitPrice: null,
          visible: true,
          ...managed(2 * index + 1),
        });
        yield* tx.insert(batches).values({
          id: `b-${id}`,
          productId: `p-${id}`,
          batchNumber: null,
          expiresAt: null,
          packQuantity: 0,
          unitQuantity: index,
          ...managed(9_007_199_254_740_991 - index),
        });
        yield* tx.insert(invoices).values({
          id: `i-${id}`,
          invoiceNumber: index + 1,
          customerName: index % 2 === 0 ? null : id,
          total: index * 100,
          ...managed(3 * index + 1),
        });
        yield* tx.insert(invoiceItems).values({
          id: `ii-${id}`,
          invoiceId: `i-${id}`,
          productId: `p-${id}`,
          batchId: `b-${id}`,
          productName: `Product ${index}`,
          batchNumber: null,
          quantity: 1,
          quantityType: "unit",
          baseUnitQuantity: 1,
          salePrice: 100,
          ...managed(4 * index + 1),
        });
        yield* tx.insert(stockMovements).values({
          id: `m-${id}`,
          productId: `p-${id}`,
          batchId: `b-${id}`,
          invoiceId: `i-${id}`,
          type: "sale",
          packDelta: 0,
          unitDelta: -1,
          note: null,
          organizationId: ORGANIZATION_ID,
          actorUserId: "user-1",
          deviceId: "device-1",
          operationId: `operation-${index}`,
          createdAt: 1_700_000_000_000,
        });
      }
    }),
  ).pipe(Effect.orDie);
  return store;
});

const expectedSources = (): ReadonlyArray<PartitionLeafSource> =>
  ADVERSARIAL_IDS.flatMap((id, index) => [
    { entity: "category" as const, entityId: `c-${id}`, rowVersion: index + 1 },
    { entity: "product" as const, entityId: `p-${id}`, rowVersion: 2 * index + 1 },
    { entity: "batch" as const, entityId: `b-${id}`, rowVersion: 9_007_199_254_740_991 - index },
    { entity: "invoice" as const, entityId: `i-${id}`, rowVersion: 3 * index + 1 },
    { entity: "invoiceItem" as const, entityId: `ii-${id}`, rowVersion: 4 * index + 1 },
    { entity: "stockMovement" as const, entityId: `m-${id}`, rowVersion: 1 },
  ]);

describe("replica partition digest", () => {
  it.effect("computes the partition digest in one SQLite statement as the shared contract", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* seed();
        const local = yield* runReplicaTransaction(store, (tx) => sqlitePartitionDigest(tx));
        const expected = yield* partitionDigestOf([...expectedSources()].reverse());
        expect(local).toEqual(expected);
        expect(expected.count).toBe(ADVERSARIAL_IDS.length * 6);
      }),
    ),
  );

  it.effect("digests an empty partition", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* openReplicaStore();
        const local = yield* runReplicaTransaction(store, (tx) => sqlitePartitionDigest(tx));
        expect(local).toEqual(yield* partitionDigestOf([]));
      }),
    ),
  );

  it.effect("skips the digest while a partition row is pending", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* seed();
        const local = yield* runReplicaTransaction(store, (tx) =>
          Effect.gen(function* () {
            yield* tx
              .insert(pendingRowMarks)
              .values({ entity: "invoice", entityId: "i-a", operationId: "pending-1" });
            return yield* sqlitePartitionDigest(tx);
          }),
        );
        expect(local).toBeUndefined();
      }),
    ),
  );
});

type Mutation = (tx: ReplicaDb) => Effect.Effect<void, EffectDrizzleQueryError>;

type Interference = (turn: number, span: string) => Mutation | undefined;

const interferingTransactor = (handle: SqliteReplicaHandle, interfere: Interference) => {
  let turns = 0;
  const transact: ReplicaTransactor = (span, run) =>
    Effect.gen(function* () {
      turns += 1;
      const mutation = interfere(turns, span);
      if (mutation) yield* runReplicaTransaction(handle, mutation).pipe(Effect.orDie);
      return yield* runReplicaTransaction(handle, run).pipe(
        Effect.mapError(mapReplicaStoreFailure),
      );
    });
  return { transact, turns: () => turns };
};

const bumpLocalVersion: Mutation = (tx) =>
  tx
    .run(sql`update ${replicaState} set "localCommitVersion" = "localCommitVersion" + 1`)
    .pipe(Effect.asVoid);

const advanceAuthority: Mutation = (tx) =>
  tx.run(sql`update ${replicaState} set "appliedCommitSequence" = '99'`).pipe(Effect.asVoid);

const decodePullResult = Schema.decodeUnknownSync(SyncPullResult);

const fencedSetup = Effect.gen(function* () {
  const handle = yield* seedReplicaTenUnits();
  const digest = yield* runReplicaTransaction(handle, (tx) => sqlitePartitionDigest(tx));
  const fence = yield* runReplicaTransaction(handle, readDigestFence);
  const page = decodePullResult({
    epoch: "1",
    incarnation: "incarnation-test",
    subscription: "operational",
    schemaVersion: 1,
    transactions: [],
    nextCommitSequence: "0",
    horizon: "0",
    retentionFloor: "0",
    digest,
  });
  const coverage = runReplicaTransaction(handle, (tx) => tx.select().from(replicaCoverage).all());
  return { handle, fence, page, coverage };
});

describe("fenced partition digest verification", () => {
  it.effect("rescans after a local-only change and verifies the unchanged partition", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { handle, fence, page, coverage } = yield* fencedSetup;
        const probe = interferingTransactor(handle, (turn) =>
          turn === 3 ? bumpLocalVersion : undefined,
        );
        const verified = yield* verifyPulledDigest(probe.transact, page, fence);
        expect(verified).toEqual({ repairRequired: false, digestVerified: true });
        expect((yield* coverage)[0]?.digest).toBe(page.digest?.digest);
      }),
    ),
  );

  it.effect("discards a scan once the authority position moves", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { handle, fence, page, coverage } = yield* fencedSetup;
        const probe = interferingTransactor(handle, (turn) =>
          turn === 3 ? advanceAuthority : undefined,
        );
        const verified = yield* verifyPulledDigest(probe.transact, page, fence);
        expect(verified).toEqual({ repairRequired: false, digestVerified: false });
        expect(probe.turns()).toBe(3);
        expect(yield* coverage).toEqual([]);
      }),
    ),
  );

  it.effect("gives up after bounded rescans and rechecks the fence before recording", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { handle, fence, page, coverage } = yield* fencedSetup;
        const restless = interferingTransactor(handle, (turn) =>
          turn >= 2 ? bumpLocalVersion : undefined,
        );
        expect(yield* verifyPulledDigest(restless.transact, page, fence)).toEqual({
          repairRequired: false,
          digestVerified: false,
        });
        expect(restless.turns()).toBe(4);
        const current = yield* runReplicaTransaction(handle, readDigestFence);
        const late = interferingTransactor(handle, (_, span) =>
          span.endsWith("settleDigestCoverage") ? bumpLocalVersion : undefined,
        );
        expect(yield* verifyPulledDigest(late.transact, page, current)).toEqual({
          repairRequired: false,
          digestVerified: false,
        });
        expect(yield* coverage).toEqual([]);
      }),
    ),
  );
});
