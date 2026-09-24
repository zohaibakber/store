import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
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
};

const softDeleteTimestamps = {
  ...timestamps,
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

/**
 * Exact non-negative integer stored as PostgreSQL `numeric`.
 *
 * Commit sequences and replica sequences must survive beyond
 * `Number.MAX_SAFE_INTEGER`. Callers pass and read canonical decimal strings;
 * comparison and ordering stay in PostgreSQL.
 */
const decimalCounter = (name: string) =>
  numeric(name, { precision: 20, scale: 0, mode: "string" }).notNull();

/**
 * One row per organization. Inventory writers lock this row with
 * `SELECT ... FOR UPDATE` before reading stock, so concurrent commands in one
 * organization observe each other's committed outcome.
 */
export const inventoryState = pgTable(
  "inventory_state",
  {
    organizationId: tenantId(),
    status: text("status").$type<"importing" | "ready">().notNull(),
    importId: text("import_id").notNull(),
    releaseId: text("release_id"),
    incarnation: text("incarnation").notNull(),
    epoch: text("epoch").notNull(),
    commitSequence: decimalCounter("commit_sequence"),
    retentionFloor: decimalCounter("retention_floor"),
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
    check("inventory_state_status", sql`${table.status} in ('importing', 'ready')`),
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
    lastClientSequence: decimalCounter("last_client_sequence"),
    processedThroughClientSequence: decimalCounter("processed_through_client_sequence"),
    registeredAt: epochMilliseconds("registered_at").notNull(),
    lastSeenAt: epochMilliseconds("last_seen_at").notNull(),
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
    commitSequence: decimalCounter("commit_sequence"),
    operationId: text("operation_id").notNull(),
    decision: text("decision").$type<"accepted" | "rejected">().notNull(),
    epoch: text("epoch").notNull(),
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
  ],
);

/**
 * Durable decision for one command identity.
 *
 * An identical retry returns this row. A different payload under the same
 * operation id is rejected. The commit sequence is the log position the
 * replica must apply before the command is locally integrated.
 *
 * No foreign key points at `inventory_transactions`: retention deletes log
 * history below the retained floor while receipts keep the per-replica
 * processed watermark, so a receipt outlives the transaction group it names.
 */
export const commandReceipts = pgTable(
  "command_receipts",
  {
    organizationId: tenantId(),
    operationId: text("operation_id").notNull(),
    replicaId: text("replica_id").notNull(),
    clientSequence: decimalCounter("client_sequence"),
    payloadHash: text("payload_hash").notNull(),
    decision: text("decision").$type<"accepted" | "rejected">().notNull(),
    commitSequence: decimalCounter("commit_sequence"),
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
    commitSequence: decimalCounter("commit_sequence"),
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

/**
 * Leased snapshot build. A fencing token stops a timed-out worker from
 * publishing after another worker takes the job.
 */
export const snapshotJobs = pgTable(
  "snapshot_jobs",
  {
    organizationId: tenantId(),
    snapshotId: text("snapshot_id").notNull(),
    subscription: text("subscription").notNull(),
    stage: text("stage")
      .$type<"copying" | "repairing" | "frozen" | "exporting" | "published" | "failed">()
      .notNull(),
    fence: integer("fence").notNull(),
    ownerToken: text("owner_token"),
    startedAtCommitSequence: decimalCounter("started_at_commit_sequence"),
    horizon: numeric("horizon", { precision: 20, scale: 0, mode: "string" }),
    copyEntity: text("copy_entity"),
    copyCursor: text("copy_cursor"),
    stepDueAt: epochMilliseconds("step_due_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "snapshot_jobs_organization_id_snapshot_id_pk",
      columns: [table.organizationId, table.snapshotId],
    }),
    index("snapshot_jobs_organization_id_stage_idx").on(table.organizationId, table.stage),
    index("snapshot_jobs_organization_id_step_due_at_idx").on(
      table.organizationId,
      table.stepDueAt,
    ),
    check(
      "snapshot_jobs_stage",
      sql`${table.stage} in ('copying', 'repairing', 'frozen', 'exporting', 'published', 'failed')`,
    ),
    check("snapshot_jobs_fence_nonnegative", sql`${table.fence} >= 0`),
  ],
);

export const downloadLeases = pgTable(
  "download_leases",
  {
    organizationId: tenantId(),
    replicaId: text("replica_id").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    pinnedHorizon: decimalCounter("pinned_horizon"),
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

/**
 * Staged entity rows while a snapshot job is copying/repairing.
 * Readers never see these until the job publishes and clients activate.
 */
export const snapshotStagedRows = pgTable(
  "snapshot_staged_rows",
  {
    organizationId: tenantId(),
    snapshotId: text("snapshot_id").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    rowVersion: integer("row_version").notNull(),
    rowJson: text("row_json").notNull(),
  },
  (table) => [
    primaryKey({
      name: "snapshot_staged_rows_pk",
      columns: [table.organizationId, table.snapshotId, table.entity, table.entityId],
    }),
    foreignKey({
      name: "snapshot_staged_rows_job_fk",
      columns: [table.organizationId, table.snapshotId],
      foreignColumns: [snapshotJobs.organizationId, snapshotJobs.snapshotId],
    }),
    check("snapshot_staged_rows_row_version_positive", sql`${table.rowVersion} > 0`),
  ],
);

/**
 * Immutable snapshot parts. Payload lives in Postgres (`payload_json`) because
 * this stage has no R2 binding; objectKey remains the stable part identity.
 */
export const snapshotParts = pgTable(
  "snapshot_parts",
  {
    organizationId: tenantId(),
    snapshotId: text("snapshot_id").notNull(),
    partNumber: integer("part_number").notNull(),
    objectKey: text("object_key").notNull(),
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

export const consumedTickets = pgTable(
  "consumed_tickets",
  {
    organizationId: tenantId(),
    nonceHash: text("nonce_hash").notNull(),
    expiresAt: epochMilliseconds("expires_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "consumed_tickets_organization_id_nonce_hash_pk",
      columns: [table.organizationId, table.nonceHash],
    }),
    index("consumed_tickets_organization_id_expires_at_idx").on(
      table.organizationId,
      table.expiresAt,
    ),
  ],
);
