import type {
  Batch,
  Category,
  CreateBatchInput,
  CreateCategoryInput,
  CreateInvoiceInput,
  CreateProductInput,
  DashboardAnalytics,
  ImportInventoryInput,
  ImportInventoryResult,
  Invoice,
  Product,
  SearchProductsInput,
  StockMovement,
  SyncStatus,
  UpdateProductInput,
} from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";
import { initializeDatabase } from "./bootstrap";
import type { PersistenceConfig } from "./config";
import { mutationContextFrom } from "./config";
import { clientLayer, ensureLocalSearchIndexes, makeDatabase } from "./database";
import {
  InvoiceNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  type StoreError,
} from "./errors";
import { makeAnalyticsStore } from "./analytics-store";
import { makeInvoiceStore } from "./invoice-store";
import { makeProductStore } from "./product-store";
import { makeSyncEngine } from "./sync-engine";

export class OfflineStore extends Context.Service<
  OfflineStore,
  {
    readonly listCategories: Effect.Effect<ReadonlyArray<Category>, PersistenceError>;
    readonly createCategory: (
      input: CreateCategoryInput,
    ) => Effect.Effect<Category, PersistenceError>;
    readonly listProducts: Effect.Effect<ReadonlyArray<Product>, PersistenceError>;
    readonly searchProducts: (
      input: SearchProductsInput,
    ) => Effect.Effect<ReadonlyArray<Product>, PersistenceError>;
    readonly getProduct: (id: string) => Effect.Effect<Product, StoreError>;
    readonly createProduct: (input: CreateProductInput) => Effect.Effect<Product, PersistenceError>;
    readonly updateProduct: (input: UpdateProductInput) => Effect.Effect<Product, StoreError>;
    readonly deleteProduct: (id: string) => Effect.Effect<void, StoreError>;
    readonly createBatch: (input: CreateBatchInput) => Effect.Effect<Batch, StoreError>;
    readonly importInventory: (
      input: ImportInventoryInput,
    ) => Effect.Effect<ImportInventoryResult, StoreError>;
    readonly listStockMovements: (
      productId: string,
    ) => Effect.Effect<ReadonlyArray<StockMovement>, PersistenceError>;
    readonly listInvoices: Effect.Effect<ReadonlyArray<Invoice>, PersistenceError>;
    readonly getInvoice: (id: string) => Effect.Effect<Invoice, StoreError>;
    readonly createInvoice: (input: CreateInvoiceInput) => Effect.Effect<Invoice, PersistenceError>;
    readonly getDashboardAnalytics: Effect.Effect<DashboardAnalytics, PersistenceError>;
    readonly getSyncStatus: Effect.Effect<SyncStatus>;
    readonly syncStatusChanges: Stream.Stream<SyncStatus>;
    readonly sync: Effect.Effect<SyncStatus, PersistenceError>;
  }
>()("@store/persistence/OfflineStore") {}

const make = (config: PersistenceConfig) =>
  Effect.gen(function* () {
    const mutationContext = mutationContextFrom(config);
    const database = yield* makeDatabase(config.migrationsFolder);
    yield* ensureLocalSearchIndexes(database);
    yield* initializeDatabase(database, mutationContext());
    const syncEngine = yield* makeSyncEngine(database, config, mutationContext);
    const productStore = makeProductStore(database, mutationContext, syncEngine.signal);
    const invoiceStore = makeInvoiceStore(database, mutationContext, syncEngine.signal);
    const analyticsStore = makeAnalyticsStore(database, mutationContext);

    return OfflineStore.of({
      ...productStore,
      ...invoiceStore,
      ...analyticsStore,
      getSyncStatus: syncEngine.status,
      syncStatusChanges: syncEngine.statusChanges,
      sync: syncEngine.sync,
    });
  });

export const layer = (config: PersistenceConfig) =>
  Layer.effect(OfflineStore, make(config)).pipe(Layer.provide(clientLayer(config)));

// Keep the error classes referenced by the public service shape available to
// generated declaration tools even when consumers import only this module.
export type PublicStoreErrors = PersistenceError | ProductNotFoundError | InvoiceNotFoundError;
