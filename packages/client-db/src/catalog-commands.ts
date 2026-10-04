import type {
  CreateBatchInput,
  CreateCategoryInput,
  CreateInvoiceInput,
  CreateProductInput,
  ImportInventoryCommandResult,
  ImportInventoryInput,
  InvoiceId,
  IssueInvoiceResult,
  UpdateBatchInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "@store/contracts";

import type {
  ReceivedDelivery,
  ReceiveDeliveryInput,
  SavedPurchaseOrder,
  SaveOrderDraftInput,
  SaveSupplierInput,
} from "./purchasing-projection";
import type { BatchRow, CategoryRow, ProductRow, PurchaseOrderRow, SupplierRow } from "./rows";

export type CommandExecution =
  | { readonly _tag: "accepting"; readonly operationId: string }
  | { readonly _tag: "pending"; readonly operationId: string; readonly status: string }
  | { readonly _tag: "failed"; readonly operationId: string; readonly message: string };

type CreateProductWithBatchInput = {
  readonly product: CreateProductInput;
  readonly batch: Omit<CreateBatchInput, "productId">;
};

type CreatedProductWithBatch = {
  readonly product: ProductRow;
  readonly batch: BatchRow;
};

type ImportIntoNewCategoryInput = {
  readonly newCategory: CreateCategoryInput;
  readonly lines: ImportInventoryInput["lines"];
};

export type ImportInventoryRequest = ImportInventoryInput | ImportIntoNewCategoryInput;

export interface CatalogCommands {
  readonly createCategory: (input: CreateCategoryInput) => Promise<CategoryRow>;
  readonly updateCategory: (input: UpdateCategoryInput) => Promise<CategoryRow>;
  readonly deleteCategory: (id: UpdateCategoryInput["id"]) => Promise<void>;
  readonly createProduct: (input: CreateProductInput) => Promise<ProductRow>;
  readonly createProductWithBatch: (
    input: CreateProductWithBatchInput,
  ) => Promise<CreatedProductWithBatch>;
  readonly updateProduct: (input: UpdateProductInput) => Promise<ProductRow>;
  readonly deleteProduct: (id: UpdateProductInput["id"]) => Promise<void>;
  readonly createBatch: (input: CreateBatchInput) => Promise<BatchRow>;
  readonly receiveBatch: (input: CreateBatchInput) => Promise<BatchRow>;
  readonly updateBatch: (input: UpdateBatchInput) => Promise<BatchRow>;
  readonly importInventory: (
    input: ImportInventoryRequest,
  ) => Promise<ImportInventoryCommandResult>;
  readonly issueInvoice: (
    input: CreateInvoiceInput,
    invoiceId?: InvoiceId,
  ) => Promise<IssueInvoiceResult>;
  readonly saveSupplier: (input: SaveSupplierInput) => Promise<SupplierRow>;
  readonly deleteSupplier: (id: string) => Promise<void>;
  readonly saveOrderDraft: (input: SaveOrderDraftInput) => Promise<SavedPurchaseOrder>;
  readonly sendOrder: (id: string) => Promise<PurchaseOrderRow>;
  readonly closeOrder: (id: string) => Promise<PurchaseOrderRow>;
  readonly cancelOrder: (id: string) => Promise<PurchaseOrderRow>;
  readonly receiveDelivery: (input: ReceiveDeliveryInput) => Promise<ReceivedDelivery>;
}
