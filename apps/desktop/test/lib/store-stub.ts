import type { Store } from "@/lib/store";

export const storeStub = (overrides: Partial<Store> = {}): Store => {
  const unstubbed = (method: string) => () =>
    Promise.reject(new Error(`storeStub: ${method} was called but not stubbed`));

  return {
    listCategories: unstubbed("listCategories"),
    createCategory: unstubbed("createCategory"),
    updateCategory: unstubbed("updateCategory"),
    deleteCategory: unstubbed("deleteCategory"),
    listProducts: unstubbed("listProducts"),
    listProductSuggestions: unstubbed("listProductSuggestions"),
    searchProducts: unstubbed("searchProducts"),
    getProduct: unstubbed("getProduct"),
    createProduct: unstubbed("createProduct"),
    updateProduct: unstubbed("updateProduct"),
    deleteProduct: unstubbed("deleteProduct"),
    createBatch: unstubbed("createBatch"),
    updateBatch: unstubbed("updateBatch"),
    importInventory: unstubbed("importInventory"),
    listStockMovements: unstubbed("listStockMovements"),
    listInvoices: unstubbed("listInvoices"),
    getInvoice: unstubbed("getInvoice"),
    createInvoice: unstubbed("createInvoice"),
    getDashboardAnalytics: unstubbed("getDashboardAnalytics"),
    getSyncStatus: unstubbed("getSyncStatus"),
    onSyncStatusChange: () => () => {},
    sync: unstubbed("sync"),
    ...overrides,
  } as Store;
};
