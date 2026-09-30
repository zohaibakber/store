import * as IndexedDb from "@effect/platform-browser/IndexedDb";
import { describe, expect, it } from "@effect/vitest";
import {
  BatchId,
  CategoryId,
  InvoiceId,
  InvoiceItemId,
  PARTITION_ENTITIES,
  partitionDigestOf,
  ProductId,
  type PartitionEntity,
  type PartitionLeafSource,
} from "@store/contracts";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { sqlitePartitionDigest } from "../src/replica/digest";
import { indexedDbPartitionDigest } from "../src/replica/indexeddb/digest";
import { ReplicaIndexedDb, storedProduct } from "../src/replica/indexeddb/schema";
import { openReplicaStore, runReplicaTransaction } from "../src/replica/storage";

const ORG = "org-golden";

type Fixture = ReadonlyArray<PartitionLeafSource>;

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const across = (ids: ReadonlyArray<string>, seed = 7): Fixture => {
  const next = rng(seed);
  return PARTITION_ENTITIES.flatMap((entity) =>
    ids.map((entityId) => ({
      entity,
      entityId,
      rowVersion:
        entity === "stockMovement"
          ? 1
          : next() < 0.02
            ? 9_007_199_254_740_991
            : 1 + Math.floor(next() * 50),
    })),
  );
};

const UNICODE_IDS = [
  "a",
  "a-",
  "a:",
  "a:1",
  "a0",
  "B",
  "z",
  "z:1",
  "Z-1",
  "é",
  "日本",
  "�",
  "￿",
  "",
  "퟿",
  "😀",
  "𠀀",
  "😀x",
  "😀",
  "a￿",
  "a😀",
  "á",
  'quote"back\\slash',
  "1",
  "10",
  "100",
  "1000",
  "11",
];

const randomIds = (count: number): ReadonlyArray<string> => {
  const next = rng(99);
  const seen = new Set<string>();
  const parts = ["a", "b", "-", ":", "1", "0", "é", "😀", "", "Z"];
  while (seen.size < count) {
    const length = 1 + Math.floor(next() * 7);
    let id = "";
    for (let index = 0; index < length; index += 1) id += parts[Math.floor(next() * parts.length)];
    seen.add(id);
  }
  return [...seen];
};

const unicode = across(UNICODE_IDS);

const sqliteFixtures: ReadonlyArray<readonly [string, Fixture]> = [
  ["unicode", unicode],
  ["random ids beyond one page", across(randomIds(4_500))],
];

const indexedFixtures: ReadonlyArray<readonly [string, Fixture]> = [
  ["unicode", unicode],
  ["random ids beyond one chunk", across(randomIds(1_500))],
];

const managed = (rowVersion: number) => ({
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  organizationId: ORG,
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: "op",
  rowVersion,
});

const chunks = <A>(items: ReadonlyArray<A>, size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

const of = (fixture: Fixture, entity: PartitionEntity) =>
  fixture.filter((source) => source.entity === entity);

const categoryRows = (fixture: Fixture) =>
  of(fixture, "category").map(({ entityId: id, rowVersion }) => ({
    id: CategoryId.make(id),
    name: `n-${id}`,
    tracksPacks: true,
    ...managed(rowVersion),
  }));

const productRows = (fixture: Fixture) =>
  of(fixture, "product").map(({ entityId: id, rowVersion }, index) => ({
    id: ProductId.make(id),
    name: `n${index}`,
    categoryId: CategoryId.make("c"),
    aisle: null,
    composition: null,
    strength: null,
    unitsPerPack: 1,
    purchasePrice: null,
    retailPrice: null,
    unitPrice: null,
    visible: true,
    ...managed(rowVersion),
  }));

const batchRows = (fixture: Fixture) =>
  of(fixture, "batch").map(({ entityId: id, rowVersion }) => ({
    id: BatchId.make(id),
    productId: ProductId.make("p"),
    batchNumber: null,
    expiresAt: null,
    packQuantity: 0,
    unitQuantity: 0,
    ...managed(rowVersion),
  }));

const invoiceRows = (fixture: Fixture) =>
  of(fixture, "invoice").map(({ entityId: id, rowVersion }, index) => ({
    id: InvoiceId.make(id),
    invoiceNumber: index + 1,
    customerName: null,
    total: 0,
    ...managed(rowVersion),
    operationId: `op-${index}`,
  }));

const invoiceItemRows = (fixture: Fixture) =>
  of(fixture, "invoiceItem").map(({ entityId: id, rowVersion }) => ({
    id: InvoiceItemId.make(id),
    invoiceId: InvoiceId.make("i"),
    productId: ProductId.make("p"),
    batchId: BatchId.make("b"),
    productName: "x",
    batchNumber: null,
    quantity: 1,
    quantityType: "unit" as const,
    baseUnitQuantity: 1,
    salePrice: 1,
    ...managed(rowVersion),
  }));

const stockMovementRows = (fixture: Fixture) =>
  of(fixture, "stockMovement").map(({ entityId: id }) => ({
    id,
    productId: ProductId.make("p"),
    batchId: BatchId.make("b"),
    invoiceId: "i",
    type: "sale" as const,
    packDelta: 0,
    unitDelta: -1,
    note: null,
    organizationId: ORG,
    actorUserId: "user-1",
    deviceId: "device-1",
    operationId: "op",
    createdAt: 1_700_000_000_000,
  }));

const seedSqlite = (fixture: Fixture) =>
  Effect.gen(function* () {
    const store = yield* openReplicaStore();
    yield* runReplicaTransaction(store, (tx) =>
      Effect.gen(function* () {
        for (const part of chunks(categoryRows(fixture), 200))
          yield* tx.insert(categories).values(part);
        for (const part of chunks(productRows(fixture), 200))
          yield* tx.insert(products).values(part);
        for (const part of chunks(batchRows(fixture), 200)) yield* tx.insert(batches).values(part);
        for (const part of chunks(invoiceRows(fixture), 200))
          yield* tx.insert(invoices).values(part);
        for (const part of chunks(invoiceItemRows(fixture), 200))
          yield* tx.insert(invoiceItems).values(part);
        for (const part of chunks(stockMovementRows(fixture), 200))
          yield* tx.insert(stockMovements).values(part);
      }),
    ).pipe(Effect.orDie);
    return store;
  });

let databaseCounter = 0;

const seedIndexed = (fixture: Fixture) =>
  Effect.gen(function* () {
    databaseCounter += 1;
    const database = yield* Layer.build(
      ReplicaIndexedDb.layer(`digest-streaming-${databaseCounter}`).pipe(
        Layer.provide(
          Layer.succeed(IndexedDb.IndexedDb, IndexedDb.make({ indexedDB, IDBKeyRange })),
        ),
      ),
    );
    const api = yield* ReplicaIndexedDb.getQueryBuilder.pipe(Effect.provideContext(database));
    yield* api.from("replica_state").upsert({
      id: "singleton",
      organizationId: ORG,
      userId: "user-1",
      replicaId: "replica-1",
      epoch: "e",
      incarnation: "i",
      appliedCommitSequence: "0",
      nextClientSequence: "1",
      localCommitVersion: 0,
      activeGeneration: 1,
      caughtUpAt: null,
      registeredAt: null,
    });
    const generation = { generation: 1 };
    for (const part of chunks(categoryRows(fixture), 500))
      yield* api.from("categories").insertAll(part.map((row) => ({ ...generation, ...row })));
    for (const part of chunks(productRows(fixture), 500))
      yield* api.from("products").insertAll(part.map((row) => storedProduct(1, row)));
    for (const part of chunks(batchRows(fixture), 500))
      yield* api.from("batches").insertAll(part.map((row) => ({ ...generation, ...row })));
    for (const part of chunks(invoiceRows(fixture), 500))
      yield* api.from("invoices").insertAll(part.map((row) => ({ ...generation, ...row })));
    for (const part of chunks(invoiceItemRows(fixture), 500))
      yield* api.from("invoice_items").insertAll(part.map((row) => ({ ...generation, ...row })));
    for (const part of chunks(stockMovementRows(fixture), 500))
      yield* api.from("stock_movements").insertAll(part.map((row) => ({ ...generation, ...row })));
    return api;
  });

describe("streamed replica digest", () => {
  for (const [name, fixture] of sqliteFixtures) {
    it.effect(`sqlite ${name}`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* seedSqlite(fixture);
          const local = yield* runReplicaTransaction(store, (tx) => sqlitePartitionDigest(tx));
          expect(local).toEqual(yield* partitionDigestOf(fixture));
        }),
      ),
    );
  }

  for (const [name, fixture] of indexedFixtures) {
    it.effect(`indexeddb ${name}`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const api = yield* seedIndexed(fixture);
          const local = yield* indexedDbPartitionDigest(api);
          expect(local).toEqual(yield* partitionDigestOf(fixture));
        }),
      ),
    );
  }
});
