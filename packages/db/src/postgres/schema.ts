import { sql } from "drizzle-orm";
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
import { nanoid } from "nanoid";

export const epochMilliseconds = (name: string) => bigint(name, { mode: "number" });

const timestamps = {
  createdAt: epochMilliseconds("created_at").notNull(),
  updatedAt: epochMilliseconds("updated_at").notNull(),
  deletedAt: epochMilliseconds("deleted_at"),
};

export const tenantId = (name = "organization_id") => text(name).notNull();

const entityId = () =>
  text("id")
    .notNull()
    .$defaultFn(() => nanoid());

const mutableMetadata = {
  organizationId: tenantId(),
  createdByUserId: text("created_by_user_id").notNull(),
  updatedByUserId: text("updated_by_user_id").notNull(),
  deviceId: text("device_id").notNull(),
  operationId: text("operation_id").notNull(),
  rowVersion: epochMilliseconds("row_version").notNull().default(1),
};

/**
 * Durable acknowledgement for an inventory command.
 *
 * A client can lose the HTTP response after Postgres commits and replay the
 * same operation after a restart. The payload hash rejects an operation-id
 * collision, while the stored transaction id makes that replay an
 * acknowledgement instead of applying the domain changes twice.
 */
export const inventoryMutationReceipts = pgTable(
  "inventory_mutation_receipts",
  {
    organizationId: tenantId(),
    operationId: text("operation_id").notNull(),
    deviceId: text("device_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    clientSequence: epochMilliseconds("client_sequence").notNull(),
    payloadHash: text("payload_hash").notNull(),
    transactionId: epochMilliseconds("transaction_id").notNull(),
    receivedAt: epochMilliseconds("received_at").notNull(),
    commandResult: text("command_result"),
  },
  (table) => [
    primaryKey({
      name: "inventory_mutation_receipts_organization_operation_pk",
      columns: [table.organizationId, table.operationId],
    }),
  ],
);

export const legacyCatalogMigrationJobs = pgTable(
  "legacy_catalog_migration_jobs",
  {
    id: text("id").notNull(),
    organizationId: tenantId(),
    requestId: text("request_id").notNull(),
    requestedByUserId: text("requested_by_user_id").notNull(),
    deviceId: text("device_id").notNull(),
    status: text("status").$type<"queued" | "migrating" | "succeeded" | "failed">().notNull(),
    phase: text("phase")
      .$type<
        | "queued"
        | "categories"
        | "products"
        | "batches"
        | "invoices"
        | "invoice-items"
        | "stock-movements"
        | "reconcile"
        | "complete"
      >()
      .notNull(),
    progress: integer("progress").notNull().default(0),
    processedRows: integer("processed_rows").notNull().default(0),
    totalRows: integer("total_rows").notNull(),
    importedRows: integer("imported_rows").notNull().default(0),
    skippedRows: integer("skipped_rows").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    payload: text("payload").notNull(),
    error: text("error"),
    createdAt: epochMilliseconds("created_at").notNull(),
    updatedAt: epochMilliseconds("updated_at").notNull(),
    completedAt: epochMilliseconds("completed_at"),
  },
  (table) => [
    primaryKey({
      name: "legacy_catalog_migration_jobs_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("legacy_catalog_migration_jobs_organization_request_uidx").on(
      table.organizationId,
      table.requestId,
    ),
    index("legacy_catalog_migration_jobs_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
    check(
      "legacy_catalog_migration_jobs_progress_range",
      sql`${table.progress} >= 0 and ${table.progress} <= 100`,
    ),
    check(
      "legacy_catalog_migration_jobs_counts_nonnegative",
      sql`${table.processedRows} >= 0 and ${table.totalRows} >= 0 and ${table.importedRows} >= 0 and ${table.skippedRows} >= 0 and ${table.attempts} >= 0`,
    ),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: entityId(),
    name: text("name").notNull(),
    tracksPacks: boolean("tracks_packs").notNull().default(true),
    ...timestamps,
    ...mutableMetadata,
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

export const products = pgTable(
  "products",
  {
    id: entityId(),
    name: text("name").notNull(),
    categoryId: text("category_id").notNull().default("general"),
    aisle: text("aisle"),
    composition: text("composition"),
    strength: text("strength"),
    unitsPerPack: integer("units_per_pack").notNull().default(1),
    packPrice: integer("pack_price"),
    unitPrice: integer("unit_price"),
    visible: boolean("visible").notNull().default(true),
    ...timestamps,
    ...mutableMetadata,
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
    productId: text("product_id").notNull(),
    batchNumber: text("batch_number"),
    expiresAt: epochMilliseconds("expires_at"),
    packQuantity: integer("pack_quantity").notNull().default(0),
    unitQuantity: integer("unit_quantity").notNull().default(0),
    ...timestamps,
    ...mutableMetadata,
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
    invoiceNumber: integer("invoice_number").notNull(),
    customerName: text("customer_name"),
    total: integer("total").notNull().default(0),
    ...timestamps,
    ...mutableMetadata,
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

export const invoiceCounters = pgTable(
  "invoice_counters",
  {
    organizationId: tenantId().primaryKey(),
    lastInvoiceNumber: integer("last_invoice_number").notNull().default(0),
  },
  (table) => [
    check("invoice_counters_last_invoice_number_nonnegative", sql`${table.lastInvoiceNumber} >= 0`),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: entityId(),
    invoiceId: text("invoice_id").notNull(),
    productId: text("product_id").notNull(),
    batchId: text("batch_id").notNull(),
    productName: text("product_name").notNull(),
    batchNumber: text("batch_number"),
    quantity: integer("quantity").notNull(),
    quantityType: text("quantity_type").$type<"unit" | "pack">().notNull().default("unit"),
    baseUnitQuantity: integer("base_unit_quantity").notNull(),
    salePrice: integer("sale_price").notNull(),
    ...timestamps,
    ...mutableMetadata,
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

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: entityId(),
    productId: text("product_id").notNull(),
    batchId: text("batch_id").notNull(),
    invoiceId: text("invoice_id"),
    type: text("type").$type<"stock_in" | "sale" | "open_pack" | "adjustment">().notNull(),
    packDelta: integer("pack_delta").notNull().default(0),
    unitDelta: integer("unit_delta").notNull().default(0),
    note: text("note"),
    organizationId: tenantId(),
    actorUserId: text("actor_user_id").notNull(),
    deviceId: text("device_id").notNull(),
    operationId: text("operation_id").notNull(),
    createdAt: epochMilliseconds("created_at").notNull(),
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
