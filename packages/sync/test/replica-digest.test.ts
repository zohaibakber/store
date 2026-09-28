import { describe, expect, it } from "@effect/vitest";
import { partitionDigestOf, type PartitionLeafSource } from "@store/contracts";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  pendingRowMarks,
  products,
  stockMovements,
} from "@store/db/replica.schema";
import * as Effect from "effect/Effect";

import { sqlitePartitionDigest } from "../src/replica/digest";
import { openReplicaStore, runReplicaTransaction } from "../src/replica/storage";

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
  it.effect("computes the history digest in one SQLite statement as the shared contract", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* seed();
        const local = yield* runReplicaTransaction(store, (tx) => sqlitePartitionDigest(tx, 3));
        const expected = yield* partitionDigestOf([...expectedSources()].reverse(), 3);
        expect(local).toEqual(expected);
        expect(expected.count).toBe(ADVERSARIAL_IDS.length * 6);
      }),
    ),
  );

  it.effect("keeps the catalog digest for version 2 and ignores history rows", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* seed();
        const local = yield* runReplicaTransaction(store, (tx) => sqlitePartitionDigest(tx, 2));
        const expected = yield* partitionDigestOf([...expectedSources()].reverse(), 2);
        expect(local).toEqual(expected);
        expect(local?.version).toBe(2);
        expect(expected.count).toBe(ADVERSARIAL_IDS.length * 3);
      }),
    ),
  );

  it.effect("digests an empty partition", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* openReplicaStore();
        const local = yield* runReplicaTransaction(store, (tx) => sqlitePartitionDigest(tx, 3));
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
            return {
              history: yield* sqlitePartitionDigest(tx, 3),
              catalog: yield* sqlitePartitionDigest(tx, 2),
            };
          }),
        );
        expect(local.history).toBeUndefined();
        expect(local.catalog?.version).toBe(2);
      }),
    ),
  );
});
