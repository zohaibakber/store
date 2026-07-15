import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";

export const epochMilliseconds = () => bigint({ mode: "number" });

const timestamps = {
  createdAt: epochMilliseconds().notNull(),
  updatedAt: epochMilliseconds().notNull(),
  deletedAt: epochMilliseconds(),
};

export const tenantId = () => text().notNull();

const entityId = () =>
  text()
    .notNull()
    .$defaultFn(() => nanoid());

const mutableSyncMetadata = {
  organizationId: tenantId(),
  createdByUserId: text().notNull(),
  updatedByUserId: text().notNull(),
  deviceId: text().notNull(),
  operationId: text().notNull(),
  rowVersion: epochMilliseconds().notNull().default(1),
};

export const categories = pgTable(
  "categories",
  {
    id: entityId(),
    name: text().notNull(),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "categories_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("categories_organization_id_name_uidx").on(table.organizationId, table.name),
    index("categories_organization_id_updated_at_idx").on(table.organizationId, table.updatedAt),
  ],
);

export const products = pgTable(
  "products",
  {
    id: entityId(),
    name: text().notNull(),
    categoryId: text().notNull().default("general"),
    aisle: text(),
    composition: text(),
    strength: text(),
    unitsPerPack: integer().notNull().default(1),
    packPrice: integer(),
    unitPrice: integer(),
    visible: boolean().notNull().default(true),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "products_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    foreignKey({
      name: "products_organization_category_fk",
      columns: [table.organizationId, table.categoryId],
      foreignColumns: [categories.organizationId, categories.id],
    }),
    index("products_organization_id_category_id_idx").on(table.organizationId, table.categoryId),
    index("products_organization_id_updated_at_idx").on(table.organizationId, table.updatedAt),
  ],
);

export const batches = pgTable(
  "batches",
  {
    id: entityId(),
    productId: text().notNull(),
    batchNumber: text(),
    expiresAt: epochMilliseconds(),
    packQuantity: integer().notNull().default(0),
    unitQuantity: integer().notNull().default(0),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "batches_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    foreignKey({
      name: "batches_organization_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    index("batches_organization_id_product_id_idx").on(table.organizationId, table.productId),
    index("batches_organization_id_product_expiry_idx").on(
      table.organizationId,
      table.productId,
      table.expiresAt,
    ),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: entityId(),
    invoiceNumber: integer().notNull(),
    customerName: text(),
    total: integer().notNull().default(0),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "invoices_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("invoices_organization_id_invoice_number_uidx").on(
      table.organizationId,
      table.invoiceNumber,
    ),
    uniqueIndex("invoices_organization_id_operation_id_uidx").on(
      table.organizationId,
      table.operationId,
    ),
    index("invoices_organization_id_created_at_idx").on(table.organizationId, table.createdAt),
    check("invoices_invoice_number_positive", sql`${table.invoiceNumber} > 0`),
  ],
);

// The counter is internal database state rather than a synced entity. Updating
// one row per organization makes invoice allocation atomic within a database.
export const invoiceCounters = pgTable(
  "invoice_counters",
  {
    organizationId: tenantId().primaryKey(),
    lastInvoiceNumber: integer().notNull().default(0),
  },
  (table) => [
    check("invoice_counters_last_invoice_number_nonnegative", sql`${table.lastInvoiceNumber} >= 0`),
  ],
);

// Line items snapshot the product name, batch number, sale unit, and price at
// the time of sale so invoices stay accurate when the catalog changes later. A
// sale line that spans several batches is stored as one row per batch taken from.
export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: entityId(),
    invoiceId: text().notNull(),
    productId: text().notNull(),
    batchId: text().notNull(),
    productName: text().notNull(),
    batchNumber: text(),
    quantity: integer().notNull(),
    quantityType: text().$type<"unit" | "pack">().notNull().default("unit"),
    baseUnitQuantity: integer().notNull(),
    salePrice: integer().notNull(),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "invoice_items_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    foreignKey({
      name: "invoice_items_organization_invoice_fk",
      columns: [table.organizationId, table.invoiceId],
      foreignColumns: [invoices.organizationId, invoices.id],
    }),
    foreignKey({
      name: "invoice_items_organization_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      name: "invoice_items_organization_batch_fk",
      columns: [table.organizationId, table.batchId],
      foreignColumns: [batches.organizationId, batches.id],
    }),
    index("invoice_items_organization_id_invoice_id_idx").on(table.organizationId, table.invoiceId),
  ],
);

// Stock movements are append-only ledger facts. Several movements can share an
// operation id (for example, opening a pack and selling loose units), so the
// operation id is intentionally indexed but not unique here.
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: entityId(),
    productId: text().notNull(),
    batchId: text().notNull(),
    invoiceId: text(),
    type: text().$type<"stock_in" | "sale" | "open_pack" | "adjustment">().notNull(),
    packDelta: integer().notNull().default(0),
    unitDelta: integer().notNull().default(0),
    note: text(),
    organizationId: tenantId(),
    actorUserId: text().notNull(),
    deviceId: text().notNull(),
    operationId: text().notNull(),
    createdAt: epochMilliseconds().notNull(),
  },
  (table) => [
    primaryKey({
      name: "stock_movements_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    foreignKey({
      name: "stock_movements_organization_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    foreignKey({
      name: "stock_movements_organization_batch_fk",
      columns: [table.organizationId, table.batchId],
      foreignColumns: [batches.organizationId, batches.id],
    }),
    foreignKey({
      name: "stock_movements_organization_invoice_fk",
      columns: [table.organizationId, table.invoiceId],
      foreignColumns: [invoices.organizationId, invoices.id],
    }),
    index("stock_movements_organization_id_product_id_idx").on(
      table.organizationId,
      table.productId,
    ),
    index("stock_movements_organization_id_batch_id_idx").on(table.organizationId, table.batchId),
    index("stock_movements_organization_id_invoice_id_idx").on(
      table.organizationId,
      table.invoiceId,
    ),
    index("stock_movements_organization_id_operation_id_idx").on(
      table.organizationId,
      table.operationId,
    ),
  ],
);
