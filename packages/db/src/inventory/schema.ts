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

import { tenantId } from "../shared/store.schema";

export {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "../shared/store.schema";

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

export const wakeState = sqliteTable(
  "wake_state",
  {
    organizationId: tenantId(),
    armedDueAt: integer({ mode: "number" }).notNull(),
    reason: text({
      enum: ["delivery", "leaseExpiry", "snapshotStep", "retention"],
    }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "wake_state_organization_id_pk",
      columns: [table.organizationId],
    }),
  ],
);

export const liveSessions = sqliteTable(
  "live_sessions",
  {
    organizationId: tenantId(),
    sessionId: text().notNull(),
    replicaId: text().notNull(),
    ownerUserId: text().notNull(),
    subscription: text().notNull(),
    deliveredThroughCommitSequence: text().notNull(),
    leaseExpiresAt: integer({ mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "live_sessions_organization_id_session_id_pk",
      columns: [table.organizationId, table.sessionId],
    }),
    index("live_sessions_organization_id_replica_id_idx").on(table.organizationId, table.replicaId),
    index("live_sessions_organization_id_lease_idx").on(table.organizationId, table.leaseExpiresAt),
  ],
);

export const consumedTickets = sqliteTable(
  "consumed_tickets",
  {
    organizationId: tenantId(),
    nonceHash: text().notNull(),
    expiresAt: integer({ mode: "number" }).notNull(),
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

export const snapshotJobs = sqliteTable(
  "snapshot_jobs",
  {
    organizationId: tenantId(),
    snapshotId: text().notNull(),
    subscription: text().notNull(),
    stage: text({
      enum: ["copying", "repairing", "frozen", "exporting", "published", "failed"],
    }).notNull(),
    fence: integer({ mode: "number" }).notNull(),
    startedAtCommitSequence: text().notNull(),
    horizon: text(),
    copyEntity: text(),
    copyCursor: text(),
    stepDueAt: integer({ mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "snapshot_jobs_organization_id_snapshot_id_pk",
      columns: [table.organizationId, table.snapshotId],
    }),
    index("snapshot_jobs_organization_id_stage_idx").on(table.organizationId, table.stage),
  ],
);

export const snapshotStagedRows = sqliteTable(
  "snapshot_staged_rows",
  {
    organizationId: tenantId(),
    snapshotId: text().notNull(),
    entity: text().notNull(),
    entityId: text().notNull(),
    rowVersion: integer({ mode: "number" }).notNull(),
    rowJson: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: "snapshot_staged_rows_pk",
      columns: [table.organizationId, table.snapshotId, table.entity, table.entityId],
    }),
  ],
);

export const snapshotParts = sqliteTable(
  "snapshot_parts",
  {
    organizationId: tenantId(),
    snapshotId: text().notNull(),
    partNumber: integer({ mode: "number" }).notNull(),
    objectKey: text().notNull(),
    byteLength: integer({ mode: "number" }).notNull(),
    sha256: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: "snapshot_parts_pk",
      columns: [table.organizationId, table.snapshotId, table.partNumber],
    }),
  ],
);

export const downloadLeases = sqliteTable(
  "download_leases",
  {
    organizationId: tenantId(),
    replicaId: text().notNull(),
    snapshotId: text().notNull(),
    pinnedHorizon: text().notNull(),
    expiresAt: integer({ mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "download_leases_organization_id_replica_id_pk",
      columns: [table.organizationId, table.replicaId],
    }),
    index("download_leases_organization_id_horizon_idx").on(
      table.organizationId,
      table.pinnedHorizon,
    ),
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

export const inventoryTransactions = sqliteTable(
  "inventory_transactions",
  {
    organizationId: tenantId(),
    commitSequence: text().notNull(),
    operationId: text().notNull(),
    decision: text({ enum: ["accepted", "rejected"] }).notNull(),
    epoch: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_transactions_organization_commit_pk",
      columns: [table.organizationId, table.commitSequence],
    }),
    index("inventory_transactions_organization_operation_idx").on(
      table.organizationId,
      table.operationId,
    ),
    check(
      "inventory_transactions_commit_sequence_digits",
      sql`${table.commitSequence} glob '[0-9]*'`,
    ),
  ],
);

export const inventoryChanges = sqliteTable(
  "inventory_changes",
  {
    organizationId: tenantId(),
    commitSequence: text().notNull(),
    ordinal: integer({ mode: "number" }).notNull(),
    entity: text().notNull(),
    action: text({ enum: ["upsert", "delete"] }).notNull(),
    entityId: text().notNull(),
    rowVersion: integer({ mode: "number" }).notNull(),
    rowJson: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: "inventory_changes_organization_commit_ordinal_pk",
      columns: [table.organizationId, table.commitSequence, table.ordinal],
    }),
  ],
);
