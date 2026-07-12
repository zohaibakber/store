import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";

const timestamps = {
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
  deletedAt: integer(),
};

const primaryId = text()
  .primaryKey()
  .$defaultFn(() => nanoid());

export const categories = sqliteTable(
  "categories",
  {
    id: primaryId,
    name: text().notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("categories_name_idx").on(table.name)],
);

export const products = sqliteTable(
  "products",
  {
    id: primaryId,
    name: text().notNull(),
    categoryId: text()
      .notNull()
      .default("general")
      .references(() => categories.id),
    aisle: text(),
    composition: text(),
    strength: text(),
    unitsPerPack: integer().notNull().default(1),
    packPrice: integer(),
    unitPrice: integer(),
    visible: integer({ mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [index("products_category_id_idx").on(table.categoryId)],
);

export const batches = sqliteTable(
  "batches",
  {
    id: primaryId,
    productId: text()
      .notNull()
      .references(() => products.id),
    batchNumber: text(),
    expiresAt: integer(),
    packQuantity: integer().notNull().default(0),
    unitQuantity: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [index("batches_product_id_idx").on(table.productId)],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: primaryId,
    invoiceNumber: integer().notNull(),
    customerName: text(),
    total: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex("invoices_invoice_number_idx").on(table.invoiceNumber)],
);

// Line items snapshot the product name, batch number, sale unit, and price at
// the time of sale so invoices stay accurate when the catalog changes later. A
// sale line that spans several batches is stored as one row per batch taken from.
export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: primaryId,
    invoiceId: text()
      .notNull()
      .references(() => invoices.id),
    productId: text()
      .notNull()
      .references(() => products.id),
    batchId: text()
      .notNull()
      .references(() => batches.id),
    productName: text().notNull(),
    batchNumber: text(),
    quantity: integer().notNull(),
    quantityType: text({ enum: ["unit", "pack"] })
      .notNull()
      .default("unit"),
    baseUnitQuantity: integer().notNull(),
    salePrice: integer().notNull(),
    ...timestamps,
  },
  (table) => [index("invoice_items_invoice_id_idx").on(table.invoiceId)],
);

export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: primaryId,
    productId: text()
      .notNull()
      .references(() => products.id),
    batchId: text()
      .notNull()
      .references(() => batches.id),
    invoiceId: text().references(() => invoices.id),
    type: text({ enum: ["stock_in", "sale", "open_pack", "adjustment"] }).notNull(),
    packDelta: integer().notNull().default(0),
    unitDelta: integer().notNull().default(0),
    note: text(),
    createdAt: integer().notNull(),
  },
  (table) => [
    index("stock_movements_product_id_idx").on(table.productId),
    index("stock_movements_batch_id_idx").on(table.batchId),
    index("stock_movements_invoice_id_idx").on(table.invoiceId),
  ],
);
