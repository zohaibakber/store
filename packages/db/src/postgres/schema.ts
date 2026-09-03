import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
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

export const catalogChangeLog = pgTable(
  "catalog_change_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    organizationId: tenantId(),
    entity: text("entity").notNull(),
    action: text("action").notNull(),
    entityId: text("entity_id").notNull(),
    rowVersion: epochMilliseconds("row_version").notNull(),
    row: jsonb("row"),
    recordedAt: epochMilliseconds("recorded_at").notNull(),
  },
  (table) => [
    index("catalog_change_log_organization_id_id_idx").on(table.organizationId, table.id),
    index("catalog_change_log_organization_entity_idx").on(
      table.organizationId,
      table.entity,
      table.entityId,
    ),
  ],
);

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
    purchasePrice: integer("purchase_price"),
    retailPrice: integer("retail_price"),
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
