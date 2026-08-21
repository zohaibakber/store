import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/store.schema";
import { createInsertSchema, createSelectSchema } from "drizzle-orm/effect-schema";
import * as Schema from "effect/Schema";

import { BatchId, CategoryId, InvoiceId, InvoiceItemId, ProductId } from "../ids";
import { omitManaged } from "../sync/managed-columns";

const productRow = createSelectSchema(products, {
  id: ProductId,
  categoryId: CategoryId,
});
const productInsert = createInsertSchema(products, {
  id: ProductId,
});
const categoryRow = createSelectSchema(categories, { id: CategoryId });

const { deletedAt: _categoryDeletedAt, ...categoryFields } = categoryRow.fields;
export const Category = Schema.Struct(categoryFields);
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

const batchRow = createSelectSchema(batches, {
  id: BatchId,
  productId: ProductId,
});
const batchInsert = createInsertSchema(batches, {
  id: BatchId,
});

const { deletedAt: _batchDeletedAt, ...batchFields } = batchRow.fields;
export const Batch = Schema.Struct(batchFields);
export type Batch = typeof Batch.Type;

const createBatchFields = omitManaged(batchInsert.fields);
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

const { deletedAt: _productDeletedAt, ...productFields } = productRow.fields;
export const Product = Schema.Struct({
  ...productFields,
  category: Category,
  batches: Schema.Array(Batch),
});
export type Product = typeof Product.Type;

const createProductFields = omitManaged(productInsert.fields);
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
  packPrice: createProductFields.packPrice,
  ...batchLineFields,
});
export type ImportInventoryLine = typeof ImportInventoryLine.Type;

export const ImportInventoryInput = Schema.Struct({
  categoryId: CategoryId,
  lines: Schema.Array(ImportInventoryLine),
});
export type ImportInventoryInput = typeof ImportInventoryInput.Type;

export const ImportInventoryResult = Schema.Struct({
  createdProducts: Schema.Number,
  createdBatches: Schema.Number,
});
export type ImportInventoryResult = typeof ImportInventoryResult.Type;

export const ProductIdInput = Schema.Struct({ id: ProductId });
export type ProductIdInput = typeof ProductIdInput.Type;

export const SearchProductsInput = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
});
export type SearchProductsInput = typeof SearchProductsInput.Type;

const invoiceRow = createSelectSchema(invoices, { id: InvoiceId });
const invoiceItemRow = createSelectSchema(invoiceItems, {
  id: InvoiceItemId,
  invoiceId: InvoiceId,
  productId: ProductId,
  batchId: BatchId,
});

const { deletedAt: _invoiceItemDeletedAt, ...invoiceItemFields } = invoiceItemRow.fields;
export const InvoiceItem = Schema.Struct(invoiceItemFields);
export type InvoiceItem = typeof InvoiceItem.Type;

const { deletedAt: _invoiceDeletedAt, ...invoiceFields } = invoiceRow.fields;
export const Invoice = Schema.Struct({ ...invoiceFields, items: Schema.Array(InvoiceItem) });
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

export const InvoiceIdInput = Schema.Struct({ id: InvoiceId });
export type InvoiceIdInput = typeof InvoiceIdInput.Type;

const stockMovementRow = createSelectSchema(stockMovements, {
  productId: ProductId,
  batchId: BatchId,
});
export const StockMovement = Schema.Struct(stockMovementRow.fields);
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
