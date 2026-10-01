import type {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
  ReceivedDelivery,
  ReceiveDeliveryInput,
  SavedPurchaseOrder,
  SaveOrderDraftInput,
  SaveSupplierInput,
  StockMovementRow,
  SupplierRow,
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
import type { Collection, DbClient } from "@tanstack/react-db";

import type { WorkspaceAtoms } from "./atoms";

type InventoryCollection<Row extends { readonly id: string }> = Collection<Row, string>;

export type Inventory = {
  readonly batches: InventoryCollection<BatchRow>;
  readonly categories: InventoryCollection<CategoryRow>;
  readonly dbClient: DbClient;
  readonly invoiceItems: InventoryCollection<InvoiceItemRow>;
  readonly invoices: InventoryCollection<InvoiceRow>;
  readonly products: InventoryCollection<ProductRow>;
  readonly purchaseOrderItems: InventoryCollection<PurchaseOrderItemRow>;
  readonly purchaseOrders: InventoryCollection<PurchaseOrderRow>;
  readonly stockMovements: InventoryCollection<StockMovementRow>;
  readonly suppliers: InventoryCollection<SupplierRow>;
  readonly actions: InventoryActions;
  readonly atoms: WorkspaceAtoms;
  readonly dispose: () => Promise<void>;
};

export type InventoryActor = {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
};

type CreateProductWithBatchInput = {
  readonly product: CreateProductInput;
  readonly batch: Omit<CreateBatchInput, "productId">;
};

type CreatedProductWithBatch = {
  readonly product: ProductRow;
  readonly batch: BatchRow;
};

export interface InventoryActions {
  readonly retrySync: () => Promise<void>;
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
  readonly importInventory: (input: ImportInventoryInput) => Promise<ImportInventoryCommandResult>;
  readonly issueInvoice: (input: CreateInvoiceInput) => Promise<IssueInvoiceResult>;
  readonly saveSupplier: (input: SaveSupplierInput) => Promise<SupplierRow>;
  readonly deleteSupplier: (id: string) => Promise<void>;
  readonly saveOrderDraft: (input: SaveOrderDraftInput) => Promise<SavedPurchaseOrder>;
  readonly sendOrder: (id: string) => Promise<PurchaseOrderRow>;
  readonly closeOrder: (id: string) => Promise<PurchaseOrderRow>;
  readonly cancelOrder: (id: string) => Promise<PurchaseOrderRow>;
  readonly receiveDelivery: (input: ReceiveDeliveryInput) => Promise<ReceivedDelivery>;
  readonly syncNow: () => void;
}

export type InventoryState =
  | { readonly _tag: "Opening" }
  | { readonly _tag: "Ready"; readonly inventory: Inventory; readonly actions: InventoryActions }
  | { readonly _tag: "Error"; readonly error: string; readonly retry: () => void };
