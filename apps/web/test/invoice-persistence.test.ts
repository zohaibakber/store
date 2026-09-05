import type { BatchRow, CategoryRow, ProductRow } from "@store/client-db";
import type { IssueInvoiceCommand, SyncEntityChange } from "@store/contracts";
import { decodeBatchId, decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import { collectionOptions, DbClient } from "@tanstack/react-db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Queue from "effect/Queue";
import { describe, expect, it } from "vitest";

import { catalogMemoryCollectionConfigs } from "../../../packages/client-db/src/collections";
import {
  Catalog,
  CatalogLive,
  CatalogError,
  CatalogTransport,
  DurableStore,
} from "../../../packages/sync/src";
import {
  diffFromChanges,
  type ReplicaDiff,
  emptyReplicaSnapshot,
} from "../../../packages/sync/src/replica";
import { makeInventoryActions } from "../src/lib/inventory/actions";
const actor = {
  organizationId: "org-1",
  userId: "user-1",
  deviceId: "device-1",
};

const category = (): CategoryRow => ({
  id: decodeCategoryId("category-1"),
  name: "General",
  tracksPacks: true,
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

const product = (): ProductRow => ({
  id: decodeProductId("product-1"),
  name: "Paracetamol",
  categoryId: decodeCategoryId("category-1"),
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 10,
  purchasePrice: null,
  retailPrice: null,
  unitPrice: null,
  visible: true,
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

const batch = (overrides: Partial<BatchRow> = {}): BatchRow => ({
  id: decodeBatchId("batch-1"),
  productId: decodeProductId("product-1"),
  batchNumber: "A",
  expiresAt: null,
  packQuantity: 2,
  unitQuantity: 0,
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...overrides,
});

describe("invoice persistence", () => {
  it("preserves an invoice and stock across a rejected upload and restart", async () => {
    const dbClient = new DbClient();
    const snapshot = {
      ...emptyReplicaSnapshot(),
      cursor: 1,
      rows: {
        ...emptyReplicaSnapshot().rows,
        category: [category()],
        product: [product()],
        batch: [batch()],
      },
    };
    const values = new Map<string, string>();
    const layer = CatalogLive({
      organizationId: actor.organizationId,
      deviceId: actor.deviceId,
      apiOrigin: "https://inventory.example",
    }).pipe(
      Layer.provide(
        Layer.succeed(
          DurableStore,
          DurableStore.of({
            get: (key) => Effect.sync(() => values.get(key) ?? JSON.stringify(snapshot)),
            set: (key, value) =>
              Effect.sync(() => {
                values.set(key, value);
              }),
            remove: (key) =>
              Effect.sync(() => {
                values.delete(key);
              }),
          }),
        ),
      ),
      Layer.provide(
        Layer.succeed(
          CatalogTransport,
          CatalogTransport.of({
            pull: () => Effect.never,
            snapshot: () => Effect.never,
            write: () => Effect.never,
            issueInvoice: () =>
              Effect.fail(new CatalogError({ reason: "unauthenticated", message: "catalog 401" })),
            importInventory: () => Effect.never,
          }),
        ),
      ),
    );
    const runtime = ManagedRuntime.make(layer);
    const catalog = await runtime.runPromise(Catalog);
    const listeners = new Set<(diff: ReplicaDiff) => void>();
    const configs = catalogMemoryCollectionConfigs({
      scopeId: "invoice-test",
      snapshot: () => runtime.runPromise(catalog.snapshot),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      persistCatalog: async () => undefined,
    });
    const inventory = {
      dbClient,
      categories: dbClient.collection(collectionOptions(configs.categories)),
      products: dbClient.collection(collectionOptions(configs.products)),
      batches: dbClient.collection(collectionOptions(configs.batches)),
      invoices: dbClient.collection(collectionOptions(configs.invoices)),
      invoiceItems: dbClient.collection(collectionOptions(configs.invoiceItems)),
      stockMovements: dbClient.collection(collectionOptions(configs.stockMovements)),
      enqueueInvoice: async (
        command: IssueInvoiceCommand,
        changes: ReadonlyArray<SyncEntityChange>,
      ) => {
        await runtime.runPromise(catalog.issueInvoice(command, changes));
        for (const diff of diffFromChanges(changes))
          for (const listener of listeners) listener(diff);
      },
      waitForUploadDrain: async () => undefined,
      poke: async () => undefined,
      dispose: () => dbClient.cleanup(),
    };
    try {
      await Promise.all([
        inventory.categories.preload(),
        inventory.products.preload(),
        inventory.batches.preload(),
        inventory.invoices.preload(),
        inventory.invoiceItems.preload(),
        inventory.stockMovements.preload(),
      ]);
      const actions = makeInventoryActions(
        inventory,
        {
          apiBaseUrl: "https://inventory.example",
          authenticatedFetch: fetch,
          deviceId: actor.deviceId,
        },
        actor,
      );
      const result = await actions.issueInvoice({
        customerName: null,
        items: [
          {
            productId: product().id,
            batchId: null,
            quantity: 1,
            quantityType: "pack",
            salePrice: 50,
          },
        ],
      });
      expect(inventory.invoices.state.get(result.invoiceId)).toBeDefined();
      expect(inventory.batches.state.get(batch().id)?.packQuantity).toBe(1);
      const failure = await runtime.runPromise(Queue.take(catalog.failures));
      expect(failure.error.reason).toBe("unauthenticated");
      await runtime.dispose();
      const reopened = ManagedRuntime.make(layer);
      try {
        const saved = await reopened.runPromise(
          Effect.gen(function* () {
            return yield* (yield* Catalog).snapshot;
          }),
        );
        expect(saved.rows.invoice).toEqual([
          expect.objectContaining({ id: result.invoiceId, invoiceNumber: 1, total: 50 }),
        ]);
        expect(saved.rows.batch).toEqual([
          expect.objectContaining({ id: batch().id, packQuantity: 1 }),
        ]);
        expect(saved.outbox).toHaveLength(1);
        expect(saved.outbox[0]?.id).toBe(result.invoiceId);
      } finally {
        await reopened.dispose();
      }
    } finally {
      await dbClient.cleanup();
      await runtime.dispose();
    }
  });
});
