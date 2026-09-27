import { epochMilliseconds, tenantId } from "@store/db/store.schema";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";

const timestamps = {
  createdAt: epochMilliseconds().notNull(),
  updatedAt: epochMilliseconds().notNull(),
  deletedAt: epochMilliseconds(),
};

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

export const categories = sqliteTable(
  "categories",
  {
    id: entityId(),
    name: text().notNull(),
    tracksPacks: integer({ mode: "boolean" }).notNull().default(true),
    ...timestamps,
    ...mutableSyncMetadata,
  },
  (table) => [
    primaryKey({
      name: "categories_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("categories_organization_id_name_uidx")
      .on(table.organizationId, table.name)
      .where(sql`${table.deletedAt} is null`),
    index("categories_organization_id_updated_at_idx").on(table.organizationId, table.updatedAt),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: entityId(),
    name: text().notNull(),
    categoryId: text().notNull().default("general"),
    aisle: text(),
    composition: text(),
    strength: text(),
    unitsPerPack: integer().notNull().default(1),
    purchasePrice: integer(),
    retailPrice: integer(),
    unitPrice: integer(),
    visible: integer({ mode: "boolean" }).notNull().default(true),
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

export const batches = sqliteTable(
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

export const invoices = sqliteTable(
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

export const invoiceItems = sqliteTable(
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

export const stockMovements = sqliteTable(
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

export const inventoryState = sqliteTable(
  "inventory_state",
  {
    organizationId: tenantId(),
    status: text({ enum: ["importing", "ready"] }).notNull(),
    importId: text().notNull(),
    releaseId: text(),
    incarnation: text().notNull(),
    epoch: text().notNull(),
    commitSequence: text().notNull(),
    retentionFloor: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_state_organization_id_pk",
      columns: [table.organizationId],
    }),
  ],
);

export const replicas = sqliteTable(
  "replicas",
  {
    organizationId: tenantId(),
    replicaId: text().notNull(),
    ownerUserId: text().notNull(),
    deviceLabel: text(),
    lastClientSequence: text().notNull(),
    processedThroughClientSequence: text().notNull(),
    registeredAt: integer({ mode: "number" }).notNull(),
    lastSeenAt: integer({ mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "replicas_organization_id_replica_id_pk",
      columns: [table.organizationId, table.replicaId],
    }),
  ],
);

export const commandReceipts = sqliteTable(
  "command_receipts",
  {
    organizationId: tenantId(),
    operationId: text().notNull(),
    replicaId: text().notNull(),
    clientSequence: text().notNull(),
    payloadHash: text().notNull(),
    decision: text({ enum: ["accepted", "rejected"] }).notNull(),
    commitSequence: text().notNull(),
    resultJson: text().notNull(),
    receivedAt: integer({ mode: "number" }).notNull(),
    attempts: integer({ mode: "number" }).notNull().default(1),
  },
  (table) => [
    primaryKey({
      name: "command_receipts_organization_operation_pk",
      columns: [table.organizationId, table.operationId],
    }),
    uniqueIndex("command_receipts_organization_replica_sequence_uidx").on(
      table.organizationId,
      table.replicaId,
      table.clientSequence,
    ),
  ],
);
