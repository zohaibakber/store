import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { PurchaseOrderQuantityType } from "../catalog/write";
import {
  CategoryId,
  InvoiceId,
  ProductId,
  PurchaseOrderId,
  PurchaseOrderItemId,
  SupplierId,
} from "../ids";
import {
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
} from "../store/schema";
import {
  BatchRow,
  CategoryRow,
  ProductRow,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
  SupplierRow,
} from "../sync/entity-rows";
import { CommandStatus } from "../sync/replica-model";
import { SyncEntity } from "../sync/schema";
import { CommandFailure, ReadFailure } from "./errors";
import { CommitNotice, Stamp } from "./notices";
import { ReplicaSyncActivity, SyncHealth } from "./sync-status";

export const BatchDraft = Schema.Struct(Struct.omit(CreateBatchInput.fields, ["productId"]));
export type BatchDraft = typeof BatchDraft.Type;

export const CreateProductWithBatchInput = Schema.Struct({
  product: CreateProductInput,
  batch: BatchDraft,
});
export type CreateProductWithBatchInput = typeof CreateProductWithBatchInput.Type;

export const ImportIntoNewCategoryInput = Schema.Struct({
  newCategory: CreateCategoryInput,
  lines: ImportInventoryInput.fields.lines,
});
export type ImportIntoNewCategoryInput = typeof ImportIntoNewCategoryInput.Type;

export const ImportInventoryRequest = Schema.Union([
  ImportInventoryInput,
  ImportIntoNewCategoryInput,
]);
export type ImportInventoryRequest = typeof ImportInventoryRequest.Type;

export const SaveSupplierInput = Schema.Struct({
  id: Schema.optional(SupplierId),
  name: Schema.String,
  phone: Schema.optional(Schema.NullOr(Schema.String)),
  note: Schema.optional(Schema.NullOr(Schema.String)),
});
export type SaveSupplierInput = typeof SaveSupplierInput.Type;

export const PurchaseOrderLineInput = Schema.Struct({
  id: Schema.optional(PurchaseOrderItemId),
  productId: ProductId,
  quantity: Schema.Number,
  quantityType: PurchaseOrderQuantityType,
  packCost: Schema.optional(Schema.NullOr(Schema.Number)),
});
export type PurchaseOrderLineInput = typeof PurchaseOrderLineInput.Type;

export const SaveOrderDraftInput = Schema.Struct({
  id: Schema.optional(PurchaseOrderId),
  supplierId: SupplierId,
  note: Schema.optional(Schema.NullOr(Schema.String)),
  expectedAt: Schema.optional(Schema.NullOr(Schema.Number)),
  lines: Schema.Array(PurchaseOrderLineInput),
  send: Schema.optional(Schema.Boolean),
});
export type SaveOrderDraftInput = typeof SaveOrderDraftInput.Type;

export const ReceiveDeliveryLineInput = Schema.Struct({
  purchaseOrderItemId: PurchaseOrderItemId,
  batchNumber: Schema.optional(Schema.NullOr(Schema.String)),
  expiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
  packQuantity: Schema.optional(Schema.Number),
  unitQuantity: Schema.optional(Schema.Number),
  purchasePrice: Schema.optional(Schema.NullOr(Schema.Number)),
  retailPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  unitPrice: Schema.optional(Schema.NullOr(Schema.Number)),
});
export type ReceiveDeliveryLineInput = typeof ReceiveDeliveryLineInput.Type;

export const ReceiveDeliveryInput = Schema.Struct({
  orderId: PurchaseOrderId,
  lines: Schema.Array(ReceiveDeliveryLineInput),
  note: Schema.optional(Schema.NullOr(Schema.String)),
  close: Schema.optional(Schema.Boolean),
});
export type ReceiveDeliveryInput = typeof ReceiveDeliveryInput.Type;

export const CreatedProductWithBatch = Schema.Struct({ product: ProductRow, batch: BatchRow });
export type CreatedProductWithBatch = typeof CreatedProductWithBatch.Type;

export const SavedPurchaseOrder = Schema.Struct({
  order: PurchaseOrderRow,
  lines: Schema.Array(PurchaseOrderItemRow),
});
export type SavedPurchaseOrder = typeof SavedPurchaseOrder.Type;

export const ReceivedDelivery = Schema.Struct({
  order: PurchaseOrderRow,
  batches: Schema.Array(BatchRow),
});
export type ReceivedDelivery = typeof ReceivedDelivery.Type;

export const Commit = Schema.Struct({
  operationId: Schema.NonEmptyString,
  status: CommandStatus,
  stamp: Stamp,
});
export type Commit = typeof Commit.Type;

export const Committed = <Result extends Schema.Top>(result: Result) =>
  Schema.Struct({ ...Commit.fields, result });

export const UploadWake = Schema.Struct({ drained: Schema.Boolean, drainCount: Schema.Natural });
export type UploadWake = typeof UploadWake.Type;

export class InventoryStore extends RpcGroup.make(
  Rpc.make("CreateCategory", {
    payload: CreateCategoryInput,
    success: Committed(CategoryRow),
    error: CommandFailure,
  }),
  Rpc.make("UpdateCategory", {
    payload: UpdateCategoryInput,
    success: Committed(CategoryRow),
    error: CommandFailure,
  }),
  Rpc.make("DeleteCategory", {
    payload: { id: CategoryId },
    success: Commit,
    error: CommandFailure,
  }),
  Rpc.make("CreateProduct", {
    payload: CreateProductInput,
    success: Committed(ProductRow),
    error: CommandFailure,
  }),
  Rpc.make("CreateProductWithBatch", {
    payload: CreateProductWithBatchInput,
    success: Committed(CreatedProductWithBatch),
    error: CommandFailure,
  }),
  Rpc.make("UpdateProduct", {
    payload: UpdateProductInput,
    success: Committed(ProductRow),
    error: CommandFailure,
  }),
  Rpc.make("DeleteProduct", {
    payload: { id: ProductId },
    success: Commit,
    error: CommandFailure,
  }),
  Rpc.make("CreateBatch", {
    payload: CreateBatchInput,
    success: Committed(BatchRow),
    error: CommandFailure,
  }),
  Rpc.make("ReceiveBatch", {
    payload: CreateBatchInput,
    success: Committed(BatchRow),
    error: CommandFailure,
  }),
  Rpc.make("UpdateBatch", {
    payload: UpdateBatchInput,
    success: Committed(BatchRow),
    error: CommandFailure,
  }),
  Rpc.make("ImportInventory", {
    payload: ImportInventoryRequest,
    success: Committed(ImportInventoryCommandResult),
    error: CommandFailure,
  }),
  Rpc.make("IssueInvoice", {
    payload: { input: CreateInvoiceInput, invoiceId: Schema.optionalKey(InvoiceId) },
    success: Committed(IssueInvoiceResult),
    error: CommandFailure,
  }),
  Rpc.make("SaveSupplier", {
    payload: SaveSupplierInput,
    success: Committed(SupplierRow),
    error: CommandFailure,
  }),
  Rpc.make("DeleteSupplier", {
    payload: { id: SupplierId },
    success: Commit,
    error: CommandFailure,
  }),
  Rpc.make("SaveOrderDraft", {
    payload: SaveOrderDraftInput,
    success: Committed(SavedPurchaseOrder),
    error: CommandFailure,
  }),
  Rpc.make("SendOrder", {
    payload: { id: PurchaseOrderId },
    success: Committed(PurchaseOrderRow),
    error: CommandFailure,
  }),
  Rpc.make("CloseOrder", {
    payload: { id: PurchaseOrderId },
    success: Committed(PurchaseOrderRow),
    error: CommandFailure,
  }),
  Rpc.make("CancelOrder", {
    payload: { id: PurchaseOrderId },
    success: Committed(PurchaseOrderRow),
    error: CommandFailure,
  }),
  Rpc.make("ReceiveDelivery", {
    payload: ReceiveDeliveryInput,
    success: Committed(ReceivedDelivery),
    error: CommandFailure,
  }),
  Rpc.make("Commits", {
    payload: { after: Schema.optionalKey(Stamp) },
    success: CommitNotice,
    error: ReadFailure,
    stream: true,
  }),
  Rpc.make("Health", { success: SyncHealth, stream: true }),
  Rpc.make("Stamp", { success: Stamp, error: ReadFailure }),
  Rpc.make("SyncActivity", { success: ReplicaSyncActivity, error: ReadFailure }),
  Rpc.make("PendingRows", {
    payload: { entity: SyncEntity },
    success: Schema.Array(Schema.String),
    error: ReadFailure,
  }),
  Rpc.make("WakeSyncUpload", { success: UploadWake, error: ReadFailure }),
) {}
