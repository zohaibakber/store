import type {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  InventoryCommandQueries,
  InventorySyncStatus,
  ProductRow,
  StockMovementRow,
} from "@store/client-db";
import type {
  CreateBatchInput,
  CreateCategoryInput,
  CreateInvoiceInput,
  CreateProductInput,
  ImportInventoryCommandResult,
  ImportInventoryInput,
  IssueInvoiceResult,
  UpdateBatchInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "@store/contracts";
import type {
  StockSnapshot,
  StockReport,
  StockRecommendationError,
} from "@store/services/stock-recommendations";
import type { Collection, DbClient } from "@tanstack/react-db";
import type { Result } from "effect";

export type InventoryCollection<Row extends { readonly id: string }> = Collection<Row, string>;

export type Inventory = {
  readonly recommendStock: (
    snapshot: Omit<StockSnapshot, "organizationId">,
    signal: AbortSignal,
  ) => Promise<Result.Result<StockReport, StockRecommendationError>>;
  readonly batches: InventoryCollection<BatchRow>;
  readonly categories: InventoryCollection<CategoryRow>;
  readonly dbClient: DbClient;
  readonly invoiceItems: InventoryCollection<InvoiceItemRow>;
  readonly invoices: InventoryCollection<InvoiceRow>;
  readonly products: InventoryCollection<ProductRow>;
  readonly stockMovements: InventoryCollection<StockMovementRow>;
  readonly actions: InventoryActions;
  readonly commands: InventoryCommandQueries;
  readonly sync: InventorySyncStatus;
  readonly observeSync: (listener: (status: InventorySyncStatus) => void) => () => void;
  readonly dispose: () => Promise<void>;
};

export type InventoryActor = {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
};

export interface InventoryActions {
  readonly createCategory: (input: CreateCategoryInput) => Promise<CategoryRow>;
  readonly updateCategory: (input: UpdateCategoryInput) => Promise<CategoryRow>;
  readonly deleteCategory: (id: UpdateCategoryInput["id"]) => Promise<void>;
  readonly createProduct: (input: CreateProductInput) => Promise<ProductRow>;
  readonly updateProduct: (input: UpdateProductInput) => Promise<ProductRow>;
  readonly deleteProduct: (id: UpdateProductInput["id"]) => Promise<void>;
  readonly createBatch: (input: CreateBatchInput) => Promise<BatchRow>;
  readonly updateBatch: (input: UpdateBatchInput) => Promise<BatchRow>;
  readonly importInventory: (input: ImportInventoryInput) => Promise<ImportInventoryCommandResult>;
  readonly issueInvoice: (input: CreateInvoiceInput) => Promise<IssueInvoiceResult>;
}

export type InventoryState =
  | { readonly _tag: "Opening" }
  | { readonly _tag: "Ready"; readonly inventory: Inventory; readonly actions: InventoryActions }
  | { readonly _tag: "Error"; readonly error: string };
