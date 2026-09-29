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
    name: nameOf(index),
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

const nameOf = (index: number) => `${index % 2 === 0 ? "alpha" : "Beta"} ${index % 97}`;

const byName = (left: number, right: number) => {
  const leftKey = nameOf(left).toLowerCase();
  const rightKey = nameOf(right).toLowerCase();
  if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
  return idOf(left) < idOf(right) ? -1 : 1;
};

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
        plan({
          orderBy: [
            { column: "retailPrice", direction: "desc", nulls: "last", collation: "binary" },
          ],
          offset: 300,
        }),
      );
      expect(byPrice.rows.map((row) => row["id"])).toEqual(
        [...indexes]
          .sort((left, right) => priceOf(right) - priceOf(left))
          .slice(300, 350)
          .map(idOf),
      );

      const tail = yield* store.querySubset(
        plan({
          orderBy: [{ column: "id", direction: "asc", nulls: "first", collation: "binary" }],
          offset: 600,
        }),
      );
      expect(tail.rows.map((row) => row["id"])).toEqual(indexes.slice(600).map(idOf));

      const odd = yield* store.querySubset(
        plan({
          residual: { _tag: "compare", column: "categoryId", op: "eq", value: "c-odd" },
          orderBy: [
            { column: "retailPrice", direction: "asc", nulls: "first", collation: "binary" },
          ],
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

      const nameAscending = yield* store.querySubset(
        plan({
          scan: { _tag: "indexPrefix", index: "byNameKey", reverse: false },
          orderBy: [
            { column: "name", direction: "asc", nulls: "first", collation: "nocase" },
            { column: "id", direction: "asc", nulls: "first", collation: "binary" },
          ],
          offset: 510,
        }),
      );
      expect(nameAscending.rows.map((row) => row["id"])).toEqual(
        [...indexes].sort(byName).slice(510, 560).map(idOf),
      );

      const nameDescending = yield* store.querySubset(
        plan({
          scan: { _tag: "indexPrefix", index: "byNameKey", reverse: true },
          orderBy: [
            { column: "name", direction: "desc", nulls: "last", collation: "nocase" },
            { column: "id", direction: "desc", nulls: "last", collation: "binary" },
          ],
          offset: 40,
        }),
      );
      expect(nameDescending.rows.map((row) => row["id"])).toEqual(
        [...indexes].sort(byName).reverse().slice(40, 90).map(idOf),
      );

      const searched = yield* store.querySubset(
        plan({
          scan: { _tag: "indexPrefix", index: "byNameKey", reverse: false },
          residual: { _tag: "like", column: "name", pattern: "%beta%" },
          orderBy: [
            { column: "name", direction: "asc", nulls: "first", collation: "nocase" },
            { column: "id", direction: "asc", nulls: "first", collation: "binary" },
          ],
          offset: 280,
        }),
      );
      expect(searched.rows.map((row) => row["id"])).toEqual(
        indexes
          .filter((index) => index % 2 === 1)
          .sort(byName)
          .slice(280)
          .map(idOf),
      );

      const oddIndexes = indexes.filter((index) => index % 2 === 1).sort(byName);
      const oddByName = yield* store.querySubset(
        plan({
          scan: {
            _tag: "indexEqualsOrdered",
            index: "byCategoryName",
            value: "c-odd",
            reverse: false,
          },
          orderBy: [
            { column: "name", direction: "asc", nulls: "first", collation: "nocase" },
            { column: "id", direction: "asc", nulls: "first", collation: "binary" },
          ],
          offset: 280,
        }),
      );
      expect(oddByName.rows.map((row) => row["id"])).toEqual(oddIndexes.slice(280).map(idOf));

      const oddByNameDescending = yield* store.querySubset(
        plan({
          scan: {
            _tag: "indexEqualsOrdered",
            index: "byCategoryName",
            value: "c-odd",
            reverse: true,
          },
          orderBy: [
            { column: "name", direction: "desc", nulls: "last", collation: "nocase" },
            { column: "id", direction: "desc", nulls: "last", collation: "binary" },
          ],
        }),
      );
      expect(oddByNameDescending.rows.map((row) => row["id"])).toEqual(
        [...oddIndexes].reverse().slice(0, 50).map(idOf),
      );

      const summary = yield* store.summarizeSubset(plan({ limit: 1 }), [], 500);
      expect(summary.summary.count).toBe(PRODUCTS);
      const evenCount = yield* store.summarizeSubset(
        plan({ scan: { _tag: "indexEquals", index: "byCategory", value: "c-even" }, limit: 1 }),
        [],
        500,
      );
      expect(evenCount.summary.count).toBe(PRODUCTS / 2);
      yield* store.dispose();
    }),
  );

  it.effect(
    "continues a name-ordered scan across chunks full of duplicate names",
    () =>
      Effect.gen(function* () {
        const store = yield* makeIndexedDbReplicaStore({
          databaseName,
          databaseIdentity: databaseName,
          identity: { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" },
          indexedDB,
          IDBKeyRange,
        });
        const count = 600;
        const nameAt = (index: number) => (index < 5 ? `aa ${index}` : index % 2 ? "Dup" : "dup");
        yield* store.applyTransactionGroup({
          commitSequence: OrgCommitSequence.make("1"),
          operationId: "seed",
          decision: "accepted",
          changes: Array.from({ length: count }, (_, index) => {
            const change = product(index);
            return { ...change, row: { ...change.row, categoryId: "c-odd", name: nameAt(index) } };
          }),
        });
        const expected = (direction: "asc" | "desc") => {
          const ordered = Array.from({ length: count }, (_, index) => index).sort((left, right) => {
            const leftKey = nameAt(left).toLowerCase();
            const rightKey = nameAt(right).toLowerCase();
            if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
            return idOf(left) < idOf(right) ? -1 : 1;
          });
          return (direction === "asc" ? ordered : ordered.reverse()).map(idOf);
        };
        for (const direction of ["asc", "desc"] as const) {
          const rows = yield* store.querySubset(
            plan({
              scan: {
                _tag: "indexEqualsOrdered",
                index: "byCategoryName",
                value: "c-odd",
                reverse: direction === "desc",
              },
              residual: { _tag: "like", column: "id", pattern: "p-%" },
              orderBy: [
                { column: "name", direction, nulls: "first", collation: "nocase" },
                { column: "id", direction, nulls: "first", collation: "binary" },
              ],
              limit: 600,
              offset: 0,
            }),
          );
          expect(rows.rows.map((row) => row["id"])).toEqual(expected(direction));
        }
        for (const direction of ["asc", "desc"] as const) {
          const rows = yield* store.querySubset(
            plan({
              scan: { _tag: "indexPrefix", index: "byNameKey", reverse: direction === "desc" },
              residual: { _tag: "like", column: "id", pattern: "p-%" },
              orderBy: [
                { column: "name", direction, nulls: "first", collation: "nocase" },
                { column: "id", direction, nulls: "first", collation: "binary" },
              ],
              limit: 600,
              offset: 0,
            }),
          );
          expect(rows.rows.map((row) => row["id"])).toEqual(expected(direction));
        }
        yield* store.dispose();
      }),
    30_000,
  );
});
