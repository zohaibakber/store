import { afterEach, describe, expect, it } from "@effect/vitest";
import { OrgCommitSequence, type SyncEntity } from "@store/contracts";
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";

const databaseName = "replica-indexeddb-insights";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

const DAY = 86_400_000;
const OFFSET_MINUTES = 300;
const dayStart = 20_000 * DAY - OFFSET_MINUTES * 60_000;

const managed = (createdAt: number) => ({
  createdAt,
  updatedAt: createdAt,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "replica-1",
  operationId: "seed",
  rowVersion: 1,
});

const upsert = <Row extends { readonly id: string }>(entity: SyncEntity, row: Row) => ({
  entity,
  action: "upsert" as const,
  entityId: row.id,
  rowVersion: 1,
  row,
});

const product = (id: string, unitsPerPack: number) =>
  upsert("product", {
    id,
    name: `Product ${id}`,
    categoryId: "cat-1",
    aisle: null,
    composition: null,
    strength: null,
    unitsPerPack,
    purchasePrice: 500,
    retailPrice: 900,
    unitPrice: null,
    visible: true,
    ...managed(1),
  });

const batch = (id: string, productId: string, packQuantity: number, unitQuantity: number) =>
  upsert("batch", {
    id,
    productId,
    batchNumber: id,
    expiresAt: dayStart + 40 * DAY,
    packQuantity,
    unitQuantity,
    ...managed(1),
  });

const invoice = (id: string, invoiceNumber: number, createdAt: number, total: number) =>
  upsert("invoice", { id, invoiceNumber, customerName: null, total, ...managed(createdAt) });

const line = (id: string, invoiceId: string, productId: string, units: number, price: number) =>
  upsert("invoiceItem", {
    id,
    invoiceId,
    productId,
    batchId: "b-1",
    productName: `Product ${productId}`,
    batchNumber: "b-1",
    quantity: units,
    quantityType: "unit",
    baseUnitQuantity: units,
    salePrice: price,
    ...managed(1),
  });

describe("IndexedDB insights read", () => {
  it.effect("aggregates windowed sales by local day and hour and keeps stocked batches", () =>
    Effect.gen(function* () {
      const store = yield* makeIndexedDbReplicaStore({
        databaseName,
        databaseIdentity: databaseName,
        identity: { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" },
        indexedDB,
        IDBKeyRange,
      });
      yield* store.applyTransactionGroup({
        commitSequence: OrgCommitSequence.make("1"),
        operationId: "seed",
        decision: "accepted",
        changes: [
          upsert("category", { id: "cat-1", name: "Tablets", tracksPacks: true, ...managed(1) }),
          product("p-1", 10),
          product("p-2", 1),
          batch("b-1", "p-1", 2, 3),
          batch("b-2", "p-2", 0, 0),
          invoice("i-1", 1, dayStart + 9 * 3_600_000, 700),
          line("l-1", "i-1", "p-1", 3, 100),
          line("l-2", "i-1", "p-2", 2, 200),
          invoice("i-2", 2, dayStart + 23 * 3_600_000, 300),
          line("l-3", "i-2", "p-1", 3, 100),
          invoice("i-3", 3, dayStart - 3 * DAY, 999),
          line("l-4", "i-3", "p-1", 9, 111),
        ],
      });

      const read = yield* store.queryInsights({
        since: dayStart - DAY,
        until: dayStart + 2 * DAY,
        utcOffsetMinutes: OFFSET_MINUTES,
      });

      expect(read.facts.truncated).toBe(false);
      expect(read.facts.products.map((row) => [row.id, row.categoryName, row.tracksPacks])).toEqual(
        [
          ["p-1", "Tablets", true],
          ["p-2", "Tablets", true],
        ],
      );
      expect(read.facts.batches.map((row) => row.productId)).toEqual(["p-1"]);
      expect(read.facts.days).toEqual([{ day: 20_000, invoices: 2, revenue: 1000 }]);
      expect(read.facts.hours).toEqual([
        { hour: 9, invoices: 1, revenue: 700 },
        { hour: 23, invoices: 1, revenue: 300 },
      ]);
      expect(
        [...read.facts.sales].sort((left, right) => left.productId.localeCompare(right.productId)),
      ).toEqual([
        { productId: "p-1", day: 20_000, units: 6, revenue: 600 },
        { productId: "p-2", day: 20_000, units: 2, revenue: 400 },
      ]);
      yield* store.dispose();
    }),
  );
});
