import * as Schema from "effect/Schema";

import { BatchId, CategoryId, InvoiceId, InvoiceItemId, ProductId } from "../ids";

const mutableEntityFields = {
  organizationId: Schema.String,
  createdByUserId: Schema.String,
  updatedByUserId: Schema.String,
  deviceId: Schema.String,
  operationId: Schema.String,
  rowVersion: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
};

export const Category = Schema.Struct({
  id: CategoryId,
  name: Schema.String,
  tracksPacks: Schema.Boolean,
  ...mutableEntityFields,
});
export type Category = typeof Category.Type;

export const CreateCategoryInput = Schema.Struct({
  name: Schema.String,
  tracksPacks: Schema.optional(Schema.Boolean),
});
export type CreateCategoryInput = typeof CreateCategoryInput.Type;

export const UpdateCategoryInput = Schema.Struct({
  id: CategoryId,
  name: Schema.String,
  tracksPacks: Schema.Boolean,
});
export type UpdateCategoryInput = typeof UpdateCategoryInput.Type;

export const CategoryIdInput = Schema.Struct({ id: CategoryId });
export type CategoryIdInput = typeof CategoryIdInput.Type;

export const Batch = Schema.Struct({
  id: BatchId,
  productId: ProductId,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  packQuantity: Schema.Number,
  unitQuantity: Schema.Number,
  ...mutableEntityFields,
});
export type Batch = typeof Batch.Type;

const createBatchFields = {
  productId: Schema.String,
  batchNumber: Schema.optional(Schema.NullOr(Schema.String)),
  expiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
  packQuantity: Schema.optional(Schema.Number),
  unitQuantity: Schema.optional(Schema.Number),
};
export const CreateBatchInput = Schema.Struct(createBatchFields);
export type CreateBatchInput = typeof CreateBatchInput.Type;

// Quantities are optional: leaving them out edits the batch's details alone,
// while sending them corrects the count, which records an adjustment movement,
// so stock still only ever moves through the movement log.
export const UpdateBatchInput = Schema.Struct({
  id: BatchId,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  packQuantity: Schema.optional(Schema.Number),
  unitQuantity: Schema.optional(Schema.Number),
});
export type UpdateBatchInput = typeof UpdateBatchInput.Type;

export const ProductSuggestions = Schema.Struct({
  names: Schema.Array(Schema.String),
  aisles: Schema.Array(Schema.String),
  compositions: Schema.Array(Schema.String),
});
export type ProductSuggestions = typeof ProductSuggestions.Type;

export const Product = Schema.Struct({
  id: ProductId,
  name: Schema.String,
  categoryId: CategoryId,
  aisle: Schema.NullOr(Schema.String),
  composition: Schema.NullOr(Schema.String),
  strength: Schema.NullOr(Schema.String),
  unitsPerPack: Schema.Number,
  purchasePrice: Schema.NullOr(Schema.Number),
  retailPrice: Schema.NullOr(Schema.Number),
  unitPrice: Schema.NullOr(Schema.Number),
  visible: Schema.Boolean,
  ...mutableEntityFields,
  category: Category,
  batches: Schema.Array(Batch),
});
export type Product = typeof Product.Type;

const createProductFields = {
  name: Schema.String,
  categoryId: Schema.optional(Schema.String),
  aisle: Schema.optional(Schema.NullOr(Schema.String)),
  composition: Schema.optional(Schema.NullOr(Schema.String)),
  strength: Schema.optional(Schema.NullOr(Schema.String)),
  unitsPerPack: Schema.optional(Schema.Number),
  purchasePrice: Schema.optional(Schema.NullOr(Schema.Number)),
  retailPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  unitPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  visible: Schema.optional(Schema.Boolean),
};
export const CreateProductInput = Schema.Struct(createProductFields);
export type CreateProductInput = typeof CreateProductInput.Type;

export const UpdateProductInput = Schema.Struct({
  id: ProductId,
  ...createProductFields,
});
export type UpdateProductInput = typeof UpdateProductInput.Type;

const { productId: _batchLineProductId, ...batchLineFields } = createBatchFields;
export const ImportInventoryLine = Schema.Struct({
  productId: Schema.NullOr(ProductId),
  name: createProductFields.name,
  unitsPerPack: createProductFields.unitsPerPack,
  purchasePrice: createProductFields.purchasePrice,
  ...batchLineFields,
});
export type ImportInventoryLine = typeof ImportInventoryLine.Type;

export const ImportInventoryInput = Schema.Struct({
  categoryId: CategoryId,
  lines: Schema.Array(ImportInventoryLine),
});
export type ImportInventoryInput = typeof ImportInventoryInput.Type;

export const ImportInventoryResult = Schema.Struct({
  createdProducts: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  createdBatches: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type ImportInventoryResult = typeof ImportInventoryResult.Type;

export const ProductIdInput = Schema.Struct({ id: ProductId });
export type ProductIdInput = typeof ProductIdInput.Type;

export const SearchProductsInput = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
});
export type SearchProductsInput = typeof SearchProductsInput.Type;

const InvoiceItemRow = Schema.Struct({
  id: InvoiceItemId,
  invoiceId: InvoiceId,
  productId: ProductId,
  batchId: BatchId,
  productName: Schema.String,
  batchNumber: Schema.NullOr(Schema.String),
  quantity: Schema.Number,
  quantityType: Schema.Literals(["unit", "pack"]),
  baseUnitQuantity: Schema.Number,
  salePrice: Schema.Number,
  ...mutableEntityFields,
});

export const InvoiceItem = InvoiceItemRow;
export type InvoiceItem = typeof InvoiceItem.Type;

export const Invoice = Schema.Struct({
  id: InvoiceId,
  invoiceNumber: Schema.Number,
  customerName: Schema.NullOr(Schema.String),
  total: Schema.Number,
  ...mutableEntityFields,
  items: Schema.Array(InvoiceItem),
});
export type Invoice = typeof Invoice.Type;

export const CreateInvoiceLineInput = Schema.Struct({
  productId: ProductId,
  batchId: Schema.NullOr(BatchId),
  quantity: Schema.Number,
  quantityType: Schema.Literals(["unit", "pack"]),
  salePrice: Schema.Number,
});
export type CreateInvoiceLineInput = typeof CreateInvoiceLineInput.Type;

export const CreateInvoiceInput = Schema.Struct({
  customerName: Schema.NullOr(Schema.String),
  items: Schema.Array(CreateInvoiceLineInput),
});
export type CreateInvoiceInput = typeof CreateInvoiceInput.Type;

const CommandIdentifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const PositiveTimestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));

export const ImportInventoryCommand = Schema.Struct({
  commandId: CommandIdentifier,
  deviceId: CommandIdentifier,
  occurredAt: PositiveTimestamp,
  input: ImportInventoryInput,
});
export type ImportInventoryCommand = typeof ImportInventoryCommand.Type;

export const ImportInventoryCommandResult = Schema.Struct({
  ...ImportInventoryResult.fields,
  txid: PositiveTimestamp,
});
export type ImportInventoryCommandResult = typeof ImportInventoryCommandResult.Type;

export const InvoiceAllocation = Schema.Struct({
  invoiceItemId: InvoiceItemId,
  saleMovementId: Schema.String.check(Schema.isMinLength(1)),
  openPackMovementId: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  productId: ProductId,
  batchId: BatchId,
  quantity: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  quantityType: Schema.Literals(["unit", "pack"]),
  salePrice: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  packsOpened: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type InvoiceAllocation = typeof InvoiceAllocation.Type;

export const IssueInvoiceCommand = Schema.Struct({
  commandId: CommandIdentifier,
  deviceId: CommandIdentifier,
  occurredAt: PositiveTimestamp,
  invoiceId: InvoiceId,
  invoiceNumber: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  input: CreateInvoiceInput,
  allocations: Schema.Array(InvoiceAllocation).check(Schema.isMinLength(1)),
});
export type IssueInvoiceCommand = typeof IssueInvoiceCommand.Type;

export const IssueInvoiceResult = Schema.Struct({
  invoiceId: InvoiceId,
  invoiceNumber: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  txid: Schema.optionalKey(PositiveTimestamp),
});
export type IssueInvoiceResult = typeof IssueInvoiceResult.Type;

export const InvoiceIdInput = Schema.Struct({ id: InvoiceId });
export type InvoiceIdInput = typeof InvoiceIdInput.Type;

export const StockMovement = Schema.Struct({
  id: Schema.String,
  productId: ProductId,
  batchId: BatchId,
  invoiceId: Schema.NullOr(InvoiceId),
  type: Schema.Literals(["stock_in", "sale", "open_pack", "adjustment"]),
  packDelta: Schema.Number,
  unitDelta: Schema.Number,
  note: Schema.NullOr(Schema.String),
  organizationId: Schema.String,
  actorUserId: Schema.String,
  deviceId: Schema.String,
  operationId: Schema.String,
  createdAt: Schema.Number,
});
export type StockMovement = typeof StockMovement.Type;

export const DashboardAnalytics = Schema.Struct({
  totals: Schema.Struct({
    revenueToday: Schema.Number,
    revenue7d: Schema.Number,
    revenue30d: Schema.Number,
    invoicesToday: Schema.Number,
    invoices30d: Schema.Number,
    averageInvoice30d: Schema.Number,
    activeProducts: Schema.Number,
  }),
  revenueByDay: Schema.Array(
    Schema.Struct({
      date: Schema.String,
      revenue: Schema.Number,
      invoices: Schema.Number,
    }),
  ),
  topProducts: Schema.Array(
    Schema.Struct({
      productId: ProductId,
      productName: Schema.String,
      unitsSold: Schema.Number,
      revenue: Schema.Number,
    }),
  ),
  expiringBatches: Schema.Array(
    Schema.Struct({
      productId: ProductId,
      productName: Schema.String,
      batchNumber: Schema.NullOr(Schema.String),
      expiresAt: Schema.Number,
      packQuantity: Schema.Number,
      unitQuantity: Schema.Number,
    }),
  ),
  lowStock: Schema.Array(
    Schema.Struct({
      productId: ProductId,
      productName: Schema.String,
      packQuantity: Schema.Number,
      unitQuantity: Schema.Number,
    }),
  ),
  recentInvoices: Schema.Array(
    Schema.Struct({
      id: InvoiceId,
      invoiceNumber: Schema.Number,
      customerName: Schema.NullOr(Schema.String),
      total: Schema.Number,
      createdAt: Schema.Number,
    }),
  ),
});
export type DashboardAnalytics = typeof DashboardAnalytics.Type;
