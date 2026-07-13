import type {
  Batch,
  Category,
  CreateBatchInput,
  CreateInvoiceInput,
  CreateProductInput,
  Invoice,
  Product,
  StockMovement,
  SyncStatus,
  UpdateProductInput,
} from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { initializeDatabase } from "./bootstrap";
import type { PersistenceConfig } from "./config";
import { mutationContextFrom } from "./config";
import { clientLayer, makeDatabase } from "./database";
import {
  InvoiceNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  type StoreError,
} from "./errors";
import { makeInvoiceStore } from "./invoice-store";
import { makeProductStore } from "./product-store";
import { makeSyncEngine } from "./sync-engine";

export class OfflineStore extends Context.Service<
  OfflineStore,
  {
    readonly listCategories: Effect.Effect<ReadonlyArray<Category>, PersistenceError>;
    readonly listProducts: Effect.Effect<ReadonlyArray<Product>, PersistenceError>;
    readonly getProduct: (id: string) => Effect.Effect<Product, StoreError>;
    readonly createProduct: (input: CreateProductInput) => Effect.Effect<Product, PersistenceError>;
    readonly updateProduct: (input: UpdateProductInput) => Effect.Effect<Product, StoreError>;
    readonly deleteProduct: (id: string) => Effect.Effect<void, StoreError>;
    readonly createBatch: (input: CreateBatchInput) => Effect.Effect<Batch, StoreError>;
    readonly listStockMovements: (
      productId: string,
    ) => Effect.Effect<ReadonlyArray<StockMovement>, PersistenceError>;
    readonly listInvoices: Effect.Effect<ReadonlyArray<Invoice>, PersistenceError>;
    readonly getInvoice: (id: string) => Effect.Effect<Invoice, StoreError>;
    readonly createInvoice: (input: CreateInvoiceInput) => Effect.Effect<Invoice, PersistenceError>;
    readonly getSyncStatus: Effect.Effect<SyncStatus>;
    readonly sync: Effect.Effect<SyncStatus, PersistenceError>;
  }
>()("@store/persistence/OfflineStore") {}

const make = (config: PersistenceConfig) =>
  Effect.gen(function* () {
    const mutationContext = mutationContextFrom(config);
    const database = yield* makeDatabase(config.migrationsFolder);
    yield* initializeDatabase(database, mutationContext());
    const syncEngine = yield* makeSyncEngine(database, config, mutationContext);
    const productStore = makeProductStore(database, mutationContext, syncEngine.signal);
    const invoiceStore = makeInvoiceStore(database, mutationContext, syncEngine.signal);

    return OfflineStore.of({
      ...productStore,
      ...invoiceStore,
      getSyncStatus: syncEngine.status,
      sync: syncEngine.sync,
    });
  });

export const layer = (config: PersistenceConfig) =>
  Layer.effect(OfflineStore, make(config)).pipe(Layer.provide(clientLayer(config)));

export const program = {
  listCategories: Effect.flatMap(OfflineStore, (store) => store.listCategories),
  listProducts: Effect.flatMap(OfflineStore, (store) => store.listProducts),
  getProduct: (id: string) => Effect.flatMap(OfflineStore, (store) => store.getProduct(id)),
  createProduct: (input: CreateProductInput) =>
    Effect.flatMap(OfflineStore, (store) => store.createProduct(input)),
  updateProduct: (input: UpdateProductInput) =>
    Effect.flatMap(OfflineStore, (store) => store.updateProduct(input)),
  deleteProduct: (id: string) => Effect.flatMap(OfflineStore, (store) => store.deleteProduct(id)),
  createBatch: (input: CreateBatchInput) =>
    Effect.flatMap(OfflineStore, (store) => store.createBatch(input)),
  listStockMovements: (productId: string) =>
    Effect.flatMap(OfflineStore, (store) => store.listStockMovements(productId)),
  listInvoices: Effect.flatMap(OfflineStore, (store) => store.listInvoices),
  getInvoice: (id: string) => Effect.flatMap(OfflineStore, (store) => store.getInvoice(id)),
  createInvoice: (input: CreateInvoiceInput) =>
    Effect.flatMap(OfflineStore, (store) => store.createInvoice(input)),
  getSyncStatus: Effect.flatMap(OfflineStore, (store) => store.getSyncStatus),
  sync: Effect.flatMap(OfflineStore, (store) => store.sync),
};

// Keep the error classes referenced by the public service shape available to
// generated declaration tools even when consumers import only this module.
export type PublicStoreErrors = PersistenceError | ProductNotFoundError | InvoiceNotFoundError;
