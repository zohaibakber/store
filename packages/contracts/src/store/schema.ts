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

import { omitManaged } from "../sync/managed-columns";

const productRow = createSelectSchema(products);
const productInsert = createInsertSchema(products);
const categoryRow = createSelectSchema(categories);

const { deletedAt: _categoryDeletedAt, ...categoryFields } = categoryRow.fields;
export const Category = Schema.Struct(categoryFields);
export type Category = typeof Category.Type;

export const CreateCategoryInput = Schema.Struct({ name: Schema.String });
export type CreateCategoryInput = typeof CreateCategoryInput.Type;

const batchRow = createSelectSchema(batches);
const batchInsert = createInsertSchema(batches);

const { deletedAt: _batchDeletedAt, ...batchFields } = batchRow.fields;
export const Batch = Schema.Struct(batchFields);
export type Batch = typeof Batch.Type;

const createBatchFields = omitManaged(batchInsert.fields);
export const CreateBatchInput = Schema.Struct(createBatchFields);
export type CreateBatchInput = typeof CreateBatchInput.Type;

// Quantities stay out: stock only moves through batch creation, sales and
// adjustments, each of which records a stock movement.
export const UpdateBatchInput = Schema.Struct({
  id: Schema.String,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
});
export type UpdateBatchInput = typeof UpdateBatchInput.Type;

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
  id: Schema.String,
  ...createProductFields,
});
export type UpdateProductInput = typeof UpdateProductInput.Type;

const { productId: _batchLineProductId, ...batchLineFields } = createBatchFields;
export const ImportInventoryLine = Schema.Struct({
  productId: Schema.NullOr(Schema.String),
  name: createProductFields.name,
  unitsPerPack: createProductFields.unitsPerPack,
  packPrice: createProductFields.packPrice,
  ...batchLineFields,
});
export type ImportInventoryLine = typeof ImportInventoryLine.Type;

export const ImportInventoryInput = Schema.Struct({
  categoryId: Schema.String,
  lines: Schema.Array(ImportInventoryLine),
});
export type ImportInventoryInput = typeof ImportInventoryInput.Type;

export const ImportInventoryResult = Schema.Struct({
  createdProducts: Schema.Number,
  createdBatches: Schema.Number,
});
export type ImportInventoryResult = typeof ImportInventoryResult.Type;

export const ProductIdInput = Schema.Struct({ id: Schema.String });
export type ProductIdInput = typeof ProductIdInput.Type;

export const SearchProductsInput = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
});
export type SearchProductsInput = typeof SearchProductsInput.Type;

const invoiceRow = createSelectSchema(invoices);
const invoiceItemRow = createSelectSchema(invoiceItems);

const { deletedAt: _invoiceItemDeletedAt, ...invoiceItemFields } = invoiceItemRow.fields;
export const InvoiceItem = Schema.Struct(invoiceItemFields);
export type InvoiceItem = typeof InvoiceItem.Type;

const { deletedAt: _invoiceDeletedAt, ...invoiceFields } = invoiceRow.fields;
export const Invoice = Schema.Struct({ ...invoiceFields, items: Schema.Array(InvoiceItem) });
export type Invoice = typeof Invoice.Type;

export const CreateInvoiceLineInput = Schema.Struct({
  productId: Schema.String,
  batchId: Schema.NullOr(Schema.String),
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

export const InvoiceIdInput = Schema.Struct({ id: Schema.String });
export type InvoiceIdInput = typeof InvoiceIdInput.Type;

const stockMovementRow = createSelectSchema(stockMovements);
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
      productId: Schema.String,
      productName: Schema.String,
      unitsSold: Schema.Number,
      revenue: Schema.Number,
    }),
  ),
  expiringBatches: Schema.Array(
    Schema.Struct({
      productId: Schema.String,
      productName: Schema.String,
      batchNumber: Schema.NullOr(Schema.String),
      expiresAt: Schema.Number,
      packQuantity: Schema.Number,
      unitQuantity: Schema.Number,
    }),
  ),
  lowStock: Schema.Array(
    Schema.Struct({
      productId: Schema.String,
      productName: Schema.String,
      packQuantity: Schema.Number,
      unitQuantity: Schema.Number,
    }),
  ),
  recentInvoices: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      invoiceNumber: Schema.Number,
      customerName: Schema.NullOr(Schema.String),
      total: Schema.Number,
      createdAt: Schema.Number,
    }),
  ),
});
export type DashboardAnalytics = typeof DashboardAnalytics.Type;
