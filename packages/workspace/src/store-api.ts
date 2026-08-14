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

export type StoreMethod = Exclude<keyof OfflineStoreApi, "onSyncStatusChange">;

type OfflineStoreShape = Effect.Success<typeof OfflineStore>;

const withStore = <A, E>(f: (store: OfflineStoreShape) => Effect.Effect<A, E>) =>
  Effect.flatMap(OfflineStore, f);

const decoding =
  <S extends Schema.Top, A, E, R>(schema: S, run: (input: S["Type"]) => Effect.Effect<A, E, R>) =>
  (input: unknown) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(Effect.flatMap(run));

export const storeHandlers: {
  [K in StoreMethod]: (input: unknown) => Effect.Effect<unknown, unknown, OfflineStore>;
} = {
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

export const withStoreEffect = withStore;

export const makeOfflineStoreApi = (input: {
  readonly run: <A, E>(effect: Effect.Effect<A, E, OfflineStore>) => Promise<A>;
  readonly onSyncStatusChange: (listener: (status: SyncStatus) => void) => () => void;
}): OfflineStoreApi => {
  const requestMethods = Object.fromEntries(
    (Object.keys(storeHandlers) as Array<StoreMethod>).map((method) => [
      method,
      (value?: unknown) => input.run(storeHandlers[method](value)),
    ]),
  ) as Omit<OfflineStoreApi, "onSyncStatusChange">;

  return {
    ...requestMethods,
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
