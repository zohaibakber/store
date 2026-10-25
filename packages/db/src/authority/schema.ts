export {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  suppliers,
} from "../shared/store.schema";

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const epochMilliseconds = () => integer({ mode: "number" });

const sequence = () => integer({ mode: "number" });

export const authorityState = sqliteTable(
  "authority_state",
  {
    id: integer({ mode: "number" }).primaryKey().notNull(),
    organizationId: text().notNull(),
    incarnation: text().notNull(),
    epoch: text().notNull(),
    commitSequence: sequence().notNull(),
    retentionFloor: sequence().notNull(),
    createdAt: epochMilliseconds().notNull(),
    maintainedAt: epochMilliseconds(),
    adoptedFrom: text(),
  },
  (table) => [
    check("authority_state_singleton", sql`${table.id} = 1`),
    check("authority_state_epoch", sql`${table.epoch} glob '[0-9]*'`),
    check(
      "authority_state_sequences",
      sql`${table.commitSequence} >= 0 and ${table.retentionFloor} >= 0`,
    ),
  ],
);

export const authorityTransactions = sqliteTable(
  "authority_transactions",
  {
    commitSequence: sequence().primaryKey().notNull(),
    operationId: text().notNull(),
    decision: text({ enum: ["accepted", "rejected"] }).notNull(),
    epoch: text().notNull(),
    byteLength: integer({ mode: "number" }).notNull(),
  },
  (table) => [
    index("authority_transactions_operation_idx").on(table.operationId),
    index("authority_transactions_epoch_commit_idx").on(table.epoch, table.commitSequence),
    check("authority_transactions_decision", sql`${table.decision} in ('accepted', 'rejected')`),
  ],
);

export const authorityChanges = sqliteTable(
  "authority_changes",
  {
    commitSequence: sequence().notNull(),
    ordinal: integer({ mode: "number" }).notNull(),
    entity: text().notNull(),
    action: text({ enum: ["upsert", "delete"] }).notNull(),
    entityId: text().notNull(),
    rowVersion: integer({ mode: "number" }).notNull(),
    rowJson: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: "authority_changes_commit_ordinal_pk",
      columns: [table.commitSequence, table.ordinal],
    }),
    check("authority_changes_action", sql`${table.action} in ('upsert', 'delete')`),
  ],
);

export const commandReceipts = sqliteTable(
  "command_receipts",
  {
    operationId: text().primaryKey().notNull(),
    replicaId: text().notNull(),
    clientSequence: sequence().notNull(),
    payloadHash: text().notNull(),
    decision: text({ enum: ["accepted", "rejected"] }).notNull(),
    commitSequence: sequence().notNull(),
    resultJson: text().notNull(),
    receivedAt: epochMilliseconds().notNull(),
    attempts: integer({ mode: "number" }).notNull().default(1),
  },
  (table) => [
    uniqueIndex("command_receipts_replica_sequence_uidx").on(table.replicaId, table.clientSequence),
    check("command_receipts_decision", sql`${table.decision} in ('accepted', 'rejected')`),
  ],
);

export const replicas = sqliteTable("replicas", {
  replicaId: text().primaryKey().notNull(),
  ownerUserId: text().notNull(),
  deviceLabel: text(),
  lastClientSequence: sequence().notNull(),
  processedThroughClientSequence: sequence().notNull(),
  registeredAt: epochMilliseconds().notNull(),
  lastSeenAt: epochMilliseconds().notNull(),
  schemaVersion: integer({ mode: "number" }).notNull().default(1),
  schemaVersionAt: epochMilliseconds(),
  ignoredAt: epochMilliseconds(),
  removedAt: epochMilliseconds(),
});

export const snapshots = sqliteTable(
  "snapshots",
  {
    snapshotId: text().primaryKey().notNull(),
    subscription: text({ enum: ["operational"] }).notNull(),
    horizon: sequence().notNull(),
    publishedAt: epochMilliseconds().notNull(),
    entityCountsJson: text().notNull(),
  },
  (table) => [index("snapshots_horizon_idx").on(table.horizon)],
);

export const snapshotParts = sqliteTable(
  "snapshot_parts",
  {
    snapshotId: text().notNull(),
    partNumber: integer({ mode: "number" }).notNull(),
    byteLength: integer({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    payloadJson: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: "snapshot_parts_pk",
      columns: [table.snapshotId, table.partNumber],
    }),
  ],
);

export const downloadLeases = sqliteTable(
  "download_leases",
  {
    replicaId: text().primaryKey().notNull(),
    snapshotId: text().notNull(),
    pinnedHorizon: sequence().notNull(),
    expiresAt: epochMilliseconds().notNull(),
  },
  (table) => [
    index("download_leases_snapshot_idx").on(table.snapshotId),
    index("download_leases_horizon_idx").on(table.pinnedHorizon),
  ],
);

export const importParts = sqliteTable(
  "import_parts",
  {
    importId: text().notNull(),
    partNumber: integer({ mode: "number" }).notNull(),
    byteLength: integer({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    framesJson: text().notNull(),
    receivedAt: epochMilliseconds().notNull(),
  },
  (table) => [
    primaryKey({ name: "import_parts_pk", columns: [table.importId, table.partNumber] }),
    index("import_parts_received_at_idx").on(table.receivedAt),
  ],
);

export const catalogImport = sqliteTable(
  "catalog_import",
  {
    id: integer({ mode: "number" }).primaryKey().notNull(),
    importId: text().notNull(),
    committedByUserId: text().notNull(),
    committedAt: epochMilliseconds().notNull(),
    resultJson: text().notNull(),
  },
  (table) => [check("catalog_import_singleton", sql`${table.id} = 1`)],
);
