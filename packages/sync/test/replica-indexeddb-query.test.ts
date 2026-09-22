import { afterEach, describe, expect, it } from "@effect/vitest";
import { OrgCommitSequence } from "@store/contracts";
import * as Effect from "effect/Effect";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import type { IndexedDbSubsetPlan } from "../src/replica/indexeddb/query";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";

const databaseName = "replica-indexeddb-query";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

type ManagedSeedColumns = {
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number | null;
  readonly organizationId: string;
  readonly createdByUserId: string;
  readonly updatedByUserId: string;
  readonly deviceId: string;
  readonly operationId: string;
  readonly rowVersion: number;
};

const managed = {
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "replica-1",
  operationId: "seed",
  rowVersion: 1,
} satisfies ManagedSeedColumns;

describe("IndexedDB subset query path", () => {
  it.effect("loads a catalog category by primary id with a paired stamp", () =>
    Effect.gen(function* () {
      const store = yield* makeIndexedDbReplicaStore({
        databaseName,
        databaseIdentity: databaseName,
        identity: {
          organizationId: "org-1",
          userId: "user-1",
          replicaId: "replica-1",
        },
        indexedDB,
        IDBKeyRange,
      });

      yield* store.applyTransactionGroup({
        commitSequence: OrgCommitSequence.make("1"),
        operationId: "seed-cat",
        decision: "accepted",
        changes: [
          {
            entity: "category",
            action: "upsert",
            entityId: "cat-1",
            rowVersion: 1,
            row: { id: "cat-1", name: "Analgesics", tracksPacks: true, ...managed },
          },
          {
            entity: "category",
            action: "upsert",
            entityId: "cat-2",
            rowVersion: 1,
            row: { id: "cat-2", name: "Antibiotics", tracksPacks: true, ...managed },
          },
        ],
      });

      const plan: IndexedDbSubsetPlan = {
        table: "categories",
        scan: { _tag: "primaryEquals", id: "cat-1" },
        residual: undefined,
        orderBy: [],
        limit: 10,
        offset: 0,
      };
      const result = yield* store.querySubset(plan);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.id).toBe("cat-1");
      expect(result.stamp.localCommitVersion).toBeGreaterThan(0);

      yield* store.dispose();
    }),
  );

  it.effect("loads invoice items by invoice index and a bounded createdAt list", () =>
    Effect.gen(function* () {
      const name = `${databaseName}-invoice`;
      const store = yield* makeIndexedDbReplicaStore({
        databaseName: name,
        databaseIdentity: name,
        identity: {
          organizationId: "org-1",
          userId: "user-1",
          replicaId: "replica-1",
        },
        indexedDB,
        IDBKeyRange,
      });

      yield* store.applyTransactionGroup({
        commitSequence: OrgCommitSequence.make("1"),
        operationId: "seed-invoice",
        decision: "accepted",
        changes: [
          {
            entity: "invoice",
            action: "upsert",
            entityId: "inv-1",
            rowVersion: 1,
            row: {
              id: "inv-1",
              invoiceNumber: 1,
              customerName: "A",
              total: 100,
              ...managed,
              createdAt: 10,
            },
          },
          {
            entity: "invoice",
            action: "upsert",
            entityId: "inv-2",
            rowVersion: 1,
            row: {
              id: "inv-2",
              invoiceNumber: 2,
              customerName: "B",
              total: 200,
              ...managed,
              createdAt: 20,
              operationId: "seed-invoice-2",
            },
          },
          {
            entity: "invoiceItem",
            action: "upsert",
            entityId: "item-1",
            rowVersion: 1,
            row: {
              id: "item-1",
              invoiceId: "inv-1",
              productId: "prod-1",
              batchId: "batch-1",
              productName: "Paracetamol",
              batchNumber: "B1",
              quantity: 1,
              quantityType: "unit",
              baseUnitQuantity: 1,
              salePrice: 100,
              ...managed,
            },
          },
        ],
      });

      const items = yield* store.querySubset({
        table: "invoice_items",
        scan: { _tag: "indexEquals", index: "byInvoice", value: "inv-1" },
        residual: undefined,
        orderBy: [],
        limit: 20,
        offset: 0,
      });
      expect(items.rows.map((row) => row.id)).toEqual(["item-1"]);

      const list = yield* store.querySubset({
        table: "invoices",
        scan: { _tag: "indexPrefix", index: "byCreatedAt", reverse: true },
        residual: undefined,
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: 1,
        offset: 0,
      });
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0]?.id).toBe("inv-2");

      yield* store.dispose();
      indexedDB.deleteDatabase(name);
    }),
  );
});
