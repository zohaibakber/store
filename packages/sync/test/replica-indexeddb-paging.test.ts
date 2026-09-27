import { afterEach, describe, expect, it } from "@effect/vitest";
import { OrgCommitSequence } from "@store/contracts";
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import type { IndexedDbSubsetPlan } from "../src/replica/indexeddb/query";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";

const databaseName = "replica-indexeddb-paging";
const PRODUCTS = 620;

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

const managed = {
  createdAt: 1,
  updatedAt: 1,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "replica-1",
  operationId: "seed",
  rowVersion: 1,
};

const idOf = (index: number) => `p-${String(index).padStart(4, "0")}`;
const priceOf = (index: number) => (index * 37) % PRODUCTS;

const product = (index: number) => ({
  entity: "product" as const,
  action: "upsert" as const,
  entityId: idOf(index),
  rowVersion: 1,
  row: {
    id: idOf(index),
    name: `Product ${index}`,
    categoryId: index % 2 === 0 ? "c-even" : "c-odd",
    aisle: null,
    composition: null,
    strength: null,
    unitsPerPack: 1,
    purchasePrice: null,
    retailPrice: priceOf(index),
    unitPrice: null,
    visible: true,
    ...managed,
  },
});

const indexes = Array.from({ length: PRODUCTS }, (_, index) => index);

const plan = (overrides: Partial<IndexedDbSubsetPlan>): IndexedDbSubsetPlan => ({
  table: "products",
  scan: { _tag: "generationPrefix", reverse: false },
  residual: undefined,
  orderBy: [],
  limit: 50,
  offset: 0,
  ...overrides,
});

describe("IndexedDB subset paging", () => {
  it.effect("pages past the first scan chunk without materializing the table", () =>
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
        changes: indexes.map(product),
      });

      const byPrice = yield* store.querySubset(
        plan({ orderBy: [{ column: "retailPrice", direction: "desc" }], offset: 300 }),
      );
      expect(byPrice.rows.map((row) => row["id"])).toEqual(
        [...indexes]
          .sort((left, right) => priceOf(right) - priceOf(left))
          .slice(300, 350)
          .map(idOf),
      );

      const tail = yield* store.querySubset(
        plan({ orderBy: [{ column: "id", direction: "asc" }], offset: 600 }),
      );
      expect(tail.rows.map((row) => row["id"])).toEqual(indexes.slice(600).map(idOf));

      const odd = yield* store.querySubset(
        plan({
          residual: { _tag: "compare", column: "categoryId", op: "eq", value: "c-odd" },
          orderBy: [{ column: "retailPrice", direction: "asc" }],
          offset: 280,
        }),
      );
      expect(odd.rows.map((row) => row["id"])).toEqual(
        indexes
          .filter((index) => index % 2 === 1)
          .sort((left, right) => priceOf(left) - priceOf(right))
          .slice(280)
          .map(idOf),
      );

      const summary = yield* store.summarizeSubset(plan({ limit: 1 }), [], 500);
      expect(summary.summary.count).toBe(PRODUCTS);
      yield* store.dispose();
    }),
  );
});
