import type {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "@store/client-db";
import type { IssueInvoiceCommand } from "@store/contracts";
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
import type { Collection, DbClient } from "@tanstack/react-db";

export type InventoryCollection<Row extends object> = Collection<Row, string>;

export type Inventory = {
  readonly batches: InventoryCollection<BatchRow>;
  readonly categories: InventoryCollection<CategoryRow>;
  readonly dbClient: DbClient;
  readonly invoiceItems: InventoryCollection<InvoiceItemRow>;
  readonly invoices: InventoryCollection<InvoiceRow>;
  readonly products: InventoryCollection<ProductRow>;
  readonly stockMovements: InventoryCollection<StockMovementRow>;
  readonly waitForUploadDrain: () => Promise<void>;
  readonly enqueueInvoice: (command: IssueInvoiceCommand) => Promise<void>;
  readonly poke: () => Promise<void>;
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
