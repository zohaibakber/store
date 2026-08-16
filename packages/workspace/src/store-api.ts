import {
  CategoryIdInput,
  CreateBatchInput,
  CreateCategoryInput,
  CreateInvoiceInput,
  CreateProductInput,
  ImportInventoryInput,
  InvoiceIdInput,
  ProductIdInput,
  SearchProductsInput,
  UpdateBatchInput,
  UpdateCategoryInput,
  UpdateProductInput,
  type OfflineStoreApi,
  type SyncStatus,
} from "@store/contracts";
import { OfflineStore } from "@store/persistence/core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { JsonApiResponse } from "./workspace";

export type StoreMethod = Exclude<keyof OfflineStoreApi, "onSyncStatusChange">;

type OfflineStoreService = Effect.Success<typeof OfflineStore>;

const withStore = <A, E>(f: (store: OfflineStoreService) => Effect.Effect<A, E>) =>
  Effect.flatMap(OfflineStore, f);

const decoding =
  <S extends Schema.Top, A, E, R>(schema: S, run: (input: S["Type"]) => Effect.Effect<A, E, R>) =>
  <Input>(input: Input) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(Effect.flatMap(run));

export const storeHandlers = {
  listCategories: () => withStore((store) => store.listCategories),
  createCategory: decoding(CreateCategoryInput, (input) =>
    withStore((store) => store.createCategory(input)),
  ),
  updateCategory: decoding(UpdateCategoryInput, (input) =>
    withStore((store) => store.updateCategory(input)),
  ),
  deleteCategory: decoding(CategoryIdInput, ({ id }) =>
    withStore((store) => store.deleteCategory(id)),
  ),
  listProducts: () => withStore((store) => store.listProducts),
  listProductSuggestions: () => withStore((store) => store.listProductSuggestions),
  searchProducts: decoding(SearchProductsInput, (input) =>
    withStore((store) => store.searchProducts(input)),
  ),
  getProduct: decoding(ProductIdInput, ({ id }) => withStore((store) => store.getProduct(id))),
  createProduct: decoding(CreateProductInput, (input) =>
    withStore((store) => store.createProduct(input)),
  ),
  updateProduct: decoding(UpdateProductInput, (input) =>
    withStore((store) => store.updateProduct(input)),
  ),
  deleteProduct: decoding(ProductIdInput, ({ id }) =>
    withStore((store) => store.deleteProduct(id)),
  ),
  createBatch: decoding(CreateBatchInput, (input) =>
    withStore((store) => store.createBatch(input)),
  ),
  updateBatch: decoding(UpdateBatchInput, (input) =>
    withStore((store) => store.updateBatch(input)),
  ),
  importInventory: decoding(ImportInventoryInput, (input) =>
    withStore((store) => store.importInventory(input)),
  ),
  listStockMovements: decoding(ProductIdInput, ({ id }) =>
    withStore((store) => store.listStockMovements(id)),
  ),
  listInvoices: () => withStore((store) => store.listInvoices),
  getInvoice: decoding(InvoiceIdInput, ({ id }) => withStore((store) => store.getInvoice(id))),
  createInvoice: decoding(CreateInvoiceInput, (input) =>
    withStore((store) => store.createInvoice(input)),
  ),
  getDashboardAnalytics: () => withStore((store) => store.getDashboardAnalytics),
  getSyncStatus: () => withStore((store) => store.getSyncStatus),
  sync: () => withStore((store) => store.sync),
};

export const invokeStoreHandler = (
  method: StoreMethod,
  input: JsonApiResponse | undefined,
): Effect.Effect<unknown, unknown, OfflineStore> => {
  switch (method) {
    case "listCategories":
      return storeHandlers.listCategories();
    case "createCategory":
      return storeHandlers.createCategory(input);
    case "updateCategory":
      return storeHandlers.updateCategory(input);
    case "deleteCategory":
      return storeHandlers.deleteCategory(input);
    case "listProducts":
      return storeHandlers.listProducts();
    case "listProductSuggestions":
      return storeHandlers.listProductSuggestions();
    case "searchProducts":
      return storeHandlers.searchProducts(input);
    case "getProduct":
      return storeHandlers.getProduct(input);
    case "createProduct":
      return storeHandlers.createProduct(input);
    case "updateProduct":
      return storeHandlers.updateProduct(input);
    case "deleteProduct":
      return storeHandlers.deleteProduct(input);
    case "createBatch":
      return storeHandlers.createBatch(input);
    case "updateBatch":
      return storeHandlers.updateBatch(input);
    case "importInventory":
      return storeHandlers.importInventory(input);
    case "listStockMovements":
      return storeHandlers.listStockMovements(input);
    case "listInvoices":
      return storeHandlers.listInvoices();
    case "getInvoice":
      return storeHandlers.getInvoice(input);
    case "createInvoice":
      return storeHandlers.createInvoice(input);
    case "getDashboardAnalytics":
      return storeHandlers.getDashboardAnalytics();
    case "getSyncStatus":
      return storeHandlers.getSyncStatus();
    case "sync":
      return storeHandlers.sync();
  }
};

export const withStoreEffect = withStore;

export const makeOfflineStoreApi = (input: {
  readonly run: <A, E>(effect: Effect.Effect<A, E, OfflineStore>) => Promise<A>;
  readonly onSyncStatusChange: (listener: (status: SyncStatus) => void) => () => void;
}): OfflineStoreApi => {
  return {
    listCategories: () => input.run(storeHandlers.listCategories()),
    createCategory: (value) => input.run(storeHandlers.createCategory(value)),
    updateCategory: (value) => input.run(storeHandlers.updateCategory(value)),
    deleteCategory: (id) => input.run(storeHandlers.deleteCategory({ id })),
    listProducts: () => input.run(storeHandlers.listProducts()),
    listProductSuggestions: () => input.run(storeHandlers.listProductSuggestions()),
    searchProducts: (value) => input.run(storeHandlers.searchProducts(value)),
    getProduct: (id) => input.run(storeHandlers.getProduct({ id })),
    createProduct: (value) => input.run(storeHandlers.createProduct(value)),
    updateProduct: (value) => input.run(storeHandlers.updateProduct(value)),
    deleteProduct: (id) => input.run(storeHandlers.deleteProduct({ id })),
    createBatch: (value) => input.run(storeHandlers.createBatch(value)),
    updateBatch: (value) => input.run(storeHandlers.updateBatch(value)),
    importInventory: (value) => input.run(storeHandlers.importInventory(value)),
    listStockMovements: (id) => input.run(storeHandlers.listStockMovements({ id })),
    listInvoices: () => input.run(storeHandlers.listInvoices()),
    getInvoice: (id) => input.run(storeHandlers.getInvoice({ id })),
    createInvoice: (value) => input.run(storeHandlers.createInvoice(value)),
    getDashboardAnalytics: () => input.run(storeHandlers.getDashboardAnalytics()),
    getSyncStatus: () => input.run(storeHandlers.getSyncStatus()),
    sync: () => input.run(storeHandlers.sync()),
    onSyncStatusChange: input.onSyncStatusChange,
  };
};

export const subscribeSyncStatus = (
  runCallback: (effect: Effect.Effect<void, never, OfflineStore>) => () => void,
  listener: (status: SyncStatus) => void,
) =>
  runCallback(
    withStore((store) =>
      store.syncStatusChanges.pipe(
        Stream.runForEach((status) => Effect.sync(() => listener(status))),
      ),
    ),
  );
