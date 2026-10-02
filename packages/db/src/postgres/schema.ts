import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

const epochMilliseconds = (name: string) => bigint(name, { mode: "number" });

const timestamps = {
  createdAt: epochMilliseconds("created_at").notNull(),
  updatedAt: epochMilliseconds("updated_at").notNull(),
};

const softDeleteTimestamps = {
  ...timestamps,
  deletedAt: epochMilliseconds("deleted_at"),
};

const tenantId = (name = "organization_id") => text(name).notNull();

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
    uniqueIndex("categories_organization_id_name_uidx").on(table.organizationId, table.name),
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
    ...softDeleteTimestamps,
    ...mutableMetadata,
  },
  (table) => [
    primaryKey({
      name: "products_organization_id_id_pk",
      columns: [table.organizationId, table.id],
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
    ...softDeleteTimestamps,
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

export const suppliers = pgTable(
  "suppliers",
  {
    id: entityId(),
    name: text("name").notNull(),
    phone: text("phone"),
    note: text("note"),
    ...timestamps,
    ...mutableMetadata,
  },
  (table) => [
    primaryKey({
      name: "suppliers_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("suppliers_organization_id_name_uidx").on(table.organizationId, table.name),
    index("suppliers_organization_id_updated_at_idx").on(table.organizationId, table.updatedAt),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: entityId(),
    orderNumber: integer("order_number").notNull(),
    supplierId: text("supplier_id").notNull(),
    status: text("status")
      .$type<"draft" | "sent" | "closed" | "cancelled">()
      .notNull()
      .default("draft"),
    note: text("note"),
    sentAt: epochMilliseconds("sent_at"),
    expectedAt: epochMilliseconds("expected_at"),
    total: integer("total").notNull().default(0),
    ...timestamps,
    ...mutableMetadata,
  },
  (table) => [
    primaryKey({
      name: "purchase_orders_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    foreignKey({
      name: "purchase_orders_organization_supplier_fk",
      columns: [table.organizationId, table.supplierId],
      foreignColumns: [suppliers.organizationId, suppliers.id],
    }),
    uniqueIndex("purchase_orders_organization_id_order_number_uidx").on(
      table.organizationId,
      table.orderNumber,
    ),
    index("purchase_orders_organization_id_supplier_id_idx").on(
      table.organizationId,
      table.supplierId,
    ),
    index("purchase_orders_organization_id_status_created_at_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    check("purchase_orders_order_number_positive", sql`${table.orderNumber} > 0`),
    check(
      "purchase_orders_status",
      sql`${table.status} in ('draft', 'sent', 'closed', 'cancelled')`,
    ),
  ],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: entityId(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    quantityType: text("quantity_type").$type<"unit" | "pack">().notNull().default("pack"),
    baseUnitQuantity: integer("base_unit_quantity").notNull(),
    packCost: integer("pack_cost"),
    receivedBaseUnits: integer("received_base_units").notNull().default(0),
    ...timestamps,
    ...mutableMetadata,
  },
  (table) => [
    primaryKey({
      name: "purchase_order_items_organization_id_id_pk",
      columns: [table.organizationId, table.id],
    }),
    foreignKey({
      name: "purchase_order_items_organization_purchase_order_fk",
      columns: [table.organizationId, table.purchaseOrderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
    }),
    foreignKey({
      name: "purchase_order_items_organization_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    index("purchase_order_items_organization_id_purchase_order_id_idx").on(
      table.organizationId,
      table.purchaseOrderId,
    ),
    index("purchase_order_items_organization_id_product_id_idx").on(
      table.organizationId,
      table.productId,
    ),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: entityId(),
    productId: text("product_id").notNull(),
    batchId: text("batch_id").notNull(),
    invoiceId: text("invoice_id"),
    purchaseOrderId: text("purchase_order_id"),
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
    foreignKey({
      name: "stock_movements_organization_purchase_order_fk",
      columns: [table.organizationId, table.purchaseOrderId],
      foreignColumns: [purchaseOrders.organizationId, purchaseOrders.id],
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
    index("stock_movements_organization_id_purchase_order_id_idx")
      .on(table.organizationId, table.purchaseOrderId)
      .where(sql`${table.purchaseOrderId} is not null`),
  ],
);

const numericDecimalString = (name: string) =>
  numeric(name, { precision: 20, scale: 0, mode: "string" }).notNull();

export const inventoryState = pgTable(
  "inventory_state",
  {
    organizationId: tenantId(),
    incarnation: text("incarnation").notNull(),
    epoch: text("epoch").notNull(),
    commitSequence: numericDecimalString("commit_sequence"),
    retentionFloor: numericDecimalString("retention_floor"),
    maintainedAt: epochMilliseconds("maintained_at"),
  },
  (table) => [
    primaryKey({
      name: "inventory_state_organization_id_pk",
      columns: [table.organizationId],
    }),
    index("inventory_state_maintained_at_organization_id_idx").on(
      table.maintainedAt,
      table.organizationId,
    ),
    check(
      "inventory_state_sequences_nonnegative",
      sql`${table.commitSequence} >= 0 and ${table.retentionFloor} >= 0`,
    ),
    check("inventory_state_epoch_digits", sql`${table.epoch} ~ '^[0-9]+$'`),
  ],
);

export const replicas = pgTable(
  "replicas",
  {
    organizationId: tenantId(),
    replicaId: text("replica_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    deviceLabel: text("device_label"),
    lastClientSequence: numericDecimalString("last_client_sequence"),
    processedThroughClientSequence: numericDecimalString("processed_through_client_sequence"),
    registeredAt: epochMilliseconds("registered_at").notNull(),
    lastSeenAt: epochMilliseconds("last_seen_at").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    schemaVersionAt: epochMilliseconds("schema_version_at"),
  },
  (table) => [
    primaryKey({
      name: "replicas_organization_id_replica_id_pk",
      columns: [table.organizationId, table.replicaId],
    }),
    check(
      "replicas_sequences_nonnegative",
      sql`${table.lastClientSequence} >= 0 and ${table.processedThroughClientSequence} >= 0`,
    ),
  ],
);

export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    organizationId: tenantId(),
    commitSequence: numericDecimalString("commit_sequence"),
    operationId: text("operation_id").notNull(),
    decision: text("decision").$type<"accepted" | "rejected">().notNull(),
    epoch: text("epoch").notNull(),
    byteLength: integer("byte_length").notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_transactions_organization_commit_pk",
      columns: [table.organizationId, table.commitSequence],
    }),
    index("inventory_transactions_organization_epoch_commit_idx").on(
      table.organizationId,
      table.epoch,
      table.commitSequence,
    ),
    index("inventory_transactions_organization_operation_idx").on(
      table.organizationId,
      table.operationId,
    ),
    check("inventory_transactions_decision", sql`${table.decision} in ('accepted', 'rejected')`),
    check("inventory_transactions_epoch_digits", sql`${table.epoch} ~ '^[0-9]+$'`),
    check("inventory_transactions_commit_sequence_positive", sql`${table.commitSequence} > 0`),
    check("inventory_transactions_byte_length_positive", sql`${table.byteLength} > 0`),
  ],
);

export const commandReceipts = pgTable(
  "command_receipts",
  {
    organizationId: tenantId(),
    operationId: text("operation_id").notNull(),
    replicaId: text("replica_id").notNull(),
    clientSequence: numericDecimalString("client_sequence"),
    payloadHash: text("payload_hash").notNull(),
    decision: text("decision").$type<"accepted" | "rejected">().notNull(),
    commitSequence: numericDecimalString("commit_sequence"),
    resultJson: text("result_json").notNull(),
    receivedAt: epochMilliseconds("received_at").notNull(),
    attempts: integer("attempts").notNull().default(1),
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
    foreignKey({
      name: "command_receipts_replica_fk",
      columns: [table.organizationId, table.replicaId],
      foreignColumns: [replicas.organizationId, replicas.replicaId],
    }),
    check("command_receipts_decision", sql`${table.decision} in ('accepted', 'rejected')`),
    check("command_receipts_client_sequence_positive", sql`${table.clientSequence} > 0`),
    check("command_receipts_attempts_positive", sql`${table.attempts} > 0`),
  ],
);

export const inventoryChanges = pgTable(
  "inventory_changes",
  {
    organizationId: tenantId(),
    commitSequence: numericDecimalString("commit_sequence"),
    ordinal: integer("ordinal").notNull(),
    entity: text("entity").notNull(),
    action: text("action").$type<"upsert" | "delete">().notNull(),
    entityId: text("entity_id").notNull(),
    rowVersion: integer("row_version").notNull(),
    rowJson: text("row_json").notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_changes_organization_commit_ordinal_pk",
      columns: [table.organizationId, table.commitSequence, table.ordinal],
    }),
    foreignKey({
      name: "inventory_changes_transaction_fk",
      columns: [table.organizationId, table.commitSequence],
      foreignColumns: [inventoryTransactions.organizationId, inventoryTransactions.commitSequence],
    }),
    check("inventory_changes_action", sql`${table.action} in ('upsert', 'delete')`),
    check("inventory_changes_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check("inventory_changes_row_version_positive", sql`${table.rowVersion} > 0`),
  ],
);

export const snapshotJobs = pgTable(
  "snapshot_jobs",
  {
    organizationId: tenantId(),
    snapshotId: text("snapshot_id").notNull(),
    subscription: text("subscription").notNull(),
    horizon: numericDecimalString("horizon"),
    entityCountsJson: text("entity_counts_json").notNull(),
    publishedAt: epochMilliseconds("published_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "snapshot_jobs_organization_id_snapshot_id_pk",
      columns: [table.organizationId, table.snapshotId],
    }),
    index("snapshot_jobs_organization_id_horizon_idx").on(table.organizationId, table.horizon),
  ],
);

export const downloadLeases = pgTable(
  "download_leases",
  {
    organizationId: tenantId(),
    replicaId: text("replica_id").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    pinnedHorizon: numericDecimalString("pinned_horizon"),
    expiresAt: epochMilliseconds("expires_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "download_leases_organization_id_replica_id_pk",
      columns: [table.organizationId, table.replicaId],
    }),
    foreignKey({
      name: "download_leases_snapshot_fk",
      columns: [table.organizationId, table.snapshotId],
      foreignColumns: [snapshotJobs.organizationId, snapshotJobs.snapshotId],
    }),
    index("download_leases_organization_id_horizon_idx").on(
      table.organizationId,
      table.pinnedHorizon,
    ),
  ],
);

export const snapshotParts = pgTable(
  "snapshot_parts",
  {
    organizationId: tenantId(),
    snapshotId: text("snapshot_id").notNull(),
    partNumber: integer("part_number").notNull(),
    byteLength: integer("byte_length").notNull(),
    sha256: text("sha256").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [
    primaryKey({
      name: "snapshot_parts_pk",
      columns: [table.organizationId, table.snapshotId, table.partNumber],
    }),
    foreignKey({
      name: "snapshot_parts_job_fk",
      columns: [table.organizationId, table.snapshotId],
      foreignColumns: [snapshotJobs.organizationId, snapshotJobs.snapshotId],
    }),
    check("snapshot_parts_part_number_positive", sql`${table.partNumber} > 0`),
    check("snapshot_parts_byte_length_nonnegative", sql`${table.byteLength} >= 0`),
  ],
);

export const importParts = pgTable(
  "import_parts",
  {
    organizationId: tenantId(),
    importId: text("import_id").notNull(),
    partNumber: integer("part_number").notNull(),
    byteLength: integer("byte_length").notNull(),
    sha256: text("sha256").notNull(),
    frames: jsonb("frames").notNull(),
    receivedAt: epochMilliseconds("received_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "import_parts_pk",
      columns: [table.organizationId, table.importId, table.partNumber],
    }),
    index("import_parts_received_at_idx").on(table.receivedAt),
    check("import_parts_part_number_positive", sql`${table.partNumber} > 0`),
    check("import_parts_byte_length_positive", sql`${table.byteLength} > 0`),
  ],
);

export const catalogImports = pgTable(
  "catalog_imports",
  {
    organizationId: tenantId(),
    importId: text("import_id").notNull(),
    committedByUserId: text("committed_by_user_id").notNull(),
    committedAt: epochMilliseconds("committed_at").notNull(),
    resultJson: text("result_json").notNull(),
  },
  (table) => [
    primaryKey({
      name: "catalog_imports_organization_id_pk",
      columns: [table.organizationId],
    }),
  ],
);
