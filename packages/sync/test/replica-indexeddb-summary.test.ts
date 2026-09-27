import { afterEach, describe, expect, it } from "@effect/vitest";
import { OrgCommitSequence } from "@store/contracts";
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";

const databaseName = "replica-indexeddb-summary";

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

const product = (id: string, categoryId: string, aisle: string | null) => ({
  entity: "product" as const,
  action: "upsert" as const,
  entityId: id,
  rowVersion: 1,
  row: {
    id,
    name: `Product ${id}`,
    categoryId,
    aisle,
    composition: null,
    strength: null,
    unitsPerPack: 1,
    purchasePrice: null,
    retailPrice: null,
    unitPrice: null,
    visible: true,
    ...managed,
  },
});

describe("IndexedDB subset summary", () => {
  it.effect("counts filtered rows and lists trimmed, case-folded distinct values", () =>
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
          product("p-1", "c-1", "Shelf A"),
          product("p-2", "c-1", " shelf a "),
          product("p-3", "c-2", "Shelf B"),
          product("p-4", "c-2", null),
          product("p-5", "c-2", "  "),
        ],
      });

      const all = yield* store.summarizeSubset(
        {
          table: "products",
          scan: { _tag: "generationPrefix", reverse: false },
          residual: undefined,
          orderBy: [],
          limit: 1,
          offset: 0,
        },
        ["aisle"],
        500,
      );
      expect(all.summary).toEqual({
        count: 5,
        distinct: [{ column: "aisle", values: ["Shelf A", "Shelf B"] }],
      });

      const filtered = yield* store.summarizeSubset(
        {
          table: "products",
          scan: { _tag: "indexEquals", index: "byCategory", value: "c-2" },
          residual: undefined,
          orderBy: [],
          limit: 1,
          offset: 0,
        },
        [],
        500,
      );
      expect(filtered.summary.count).toBe(3);
      yield* store.dispose();
    }),
  );
});
