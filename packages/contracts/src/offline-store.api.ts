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
  InvoiceIdInput,
  Product,
  ProductIdInput,
  SearchProductsInput,
  StockMovement,
  UpdateProductInput,
} from "./store.schema";
import type { SyncStatus } from "./sync.schema";

export interface OfflineStoreApi {
  readonly listCategories: () => Promise<ReadonlyArray<Category>>;
  readonly createCategory: (input: CreateCategoryInput) => Promise<Category>;
  readonly listProducts: () => Promise<ReadonlyArray<Product>>;
  readonly searchProducts: (input: SearchProductsInput) => Promise<ReadonlyArray<Product>>;
  readonly getProduct: (input: ProductIdInput) => Promise<Product>;
  readonly createProduct: (input: CreateProductInput) => Promise<Product>;
  readonly updateProduct: (input: UpdateProductInput) => Promise<Product>;
  readonly deleteProduct: (input: ProductIdInput) => Promise<void>;
  readonly createBatch: (input: CreateBatchInput) => Promise<Batch>;
  readonly importInventory: (input: ImportInventoryInput) => Promise<ImportInventoryResult>;
  readonly listStockMovements: (input: ProductIdInput) => Promise<ReadonlyArray<StockMovement>>;
  readonly listInvoices: () => Promise<ReadonlyArray<Invoice>>;
  readonly getInvoice: (input: InvoiceIdInput) => Promise<Invoice>;
  readonly createInvoice: (input: CreateInvoiceInput) => Promise<Invoice>;
  readonly getDashboardAnalytics: () => Promise<DashboardAnalytics>;
  readonly getSyncStatus: () => Promise<SyncStatus>;
  readonly onSyncStatusChange: (callback: (status: SyncStatus) => void) => () => void;
  readonly sync: () => Promise<SyncStatus>;
}
