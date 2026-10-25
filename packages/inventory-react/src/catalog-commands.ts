import type {
  CreateBatchInput,
  CreateCategoryInput,
  CreateInvoiceInput,
  CreateProductInput,
  ImportInventoryCommandResult,
  InvoiceId,
  IssueInvoiceResult,
  ReplicaBatchRow,
  ReplicaCategoryRow,
  ReplicaProductRow,
  ReplicaPurchaseOrderRow,
  ReplicaSupplierRow,
  UpdateBatchInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "@store/contracts";
import type {
  CreatedProductWithBatch,
  CreateProductWithBatchInput,
  ImportInventoryRequest,
  ReceivedDelivery,
  ReceiveDeliveryInput as ReceiveDeliverySchema,
  ReceiveDeliveryLineInput as ReceiveDeliveryLineSchema,
  SaveOrderDraftInput as SaveOrderDraftSchema,
  SavedPurchaseOrder,
  SaveSupplierInput as SaveSupplierSchema,
} from "@store/contracts/replica";

export type SaveSupplierInput = typeof SaveSupplierSchema.Encoded;
export type SaveOrderDraftInput = typeof SaveOrderDraftSchema.Encoded;
export type ReceiveDeliveryInput = typeof ReceiveDeliverySchema.Encoded;
export type ReceiveDeliveryLineInput = typeof ReceiveDeliveryLineSchema.Encoded;

export interface CatalogCommands {
  readonly createCategory: (input: CreateCategoryInput) => Promise<ReplicaCategoryRow>;
  readonly updateCategory: (input: UpdateCategoryInput) => Promise<ReplicaCategoryRow>;
  readonly deleteCategory: (id: UpdateCategoryInput["id"]) => Promise<void>;
  readonly createProduct: (input: CreateProductInput) => Promise<ReplicaProductRow>;
  readonly createProductWithBatch: (
    input: CreateProductWithBatchInput,
  ) => Promise<CreatedProductWithBatch>;
  readonly updateProduct: (input: UpdateProductInput) => Promise<ReplicaProductRow>;
  readonly deleteProduct: (id: UpdateProductInput["id"]) => Promise<void>;
  readonly createBatch: (input: CreateBatchInput) => Promise<ReplicaBatchRow>;
  readonly receiveBatch: (input: CreateBatchInput) => Promise<ReplicaBatchRow>;
  readonly updateBatch: (input: UpdateBatchInput) => Promise<ReplicaBatchRow>;
  readonly importInventory: (
    input: ImportInventoryRequest,
  ) => Promise<ImportInventoryCommandResult>;
  readonly issueInvoice: (
    input: CreateInvoiceInput,
    invoiceId?: InvoiceId,
  ) => Promise<IssueInvoiceResult>;
  readonly saveSupplier: (input: SaveSupplierInput) => Promise<ReplicaSupplierRow>;
  readonly deleteSupplier: (id: string) => Promise<void>;
  readonly saveOrderDraft: (input: SaveOrderDraftInput) => Promise<SavedPurchaseOrder>;
  readonly sendOrder: (id: string) => Promise<ReplicaPurchaseOrderRow>;
  readonly closeOrder: (id: string) => Promise<ReplicaPurchaseOrderRow>;
  readonly cancelOrder: (id: string) => Promise<ReplicaPurchaseOrderRow>;
  readonly receiveDelivery: (input: ReceiveDeliveryInput) => Promise<ReceivedDelivery>;
}
