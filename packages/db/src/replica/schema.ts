export {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "../shared/store.schema";

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const replicaState = sqliteTable("replica_state", {
  id: text().primaryKey().notNull(),
  organizationId: text().notNull(),
  userId: text().notNull(),
  replicaId: text().notNull(),
  epoch: text().notNull(),
  incarnation: text().notNull(),
  appliedCommitSequence: text().notNull(),
  nextClientSequence: text().notNull(),
  localCommitVersion: integer({ mode: "number" }).notNull(),
  activeGeneration: integer({ mode: "number" }).notNull().default(1),
});

export const commandOutbox = sqliteTable(
  "command_outbox",
  {
    operationId: text().primaryKey().notNull(),
    status: text({
      enum: [
        "pending",
        "sending",
        "accepted_awaiting_integration",
        "integrated",
        "rejected",
        "abandoned",
      ],
    }).notNull(),
    envelopeJson: text().notNull(),
    receiptJson: text(),
    clientSequence: text().notNull(),
    createdAt: integer({ mode: "number" }).notNull(),
    claimId: text(),
    claimedAt: integer({ mode: "number" }),
    attempts: integer({ mode: "number" }).notNull().default(0),
    outcomeUncertain: integer({ mode: "boolean" }).notNull().default(false),
    commitSequence: text(),
  },
  (table) => [
    index("command_outbox_status_client_sequence_idx").on(table.status, table.clientSequence),
  ],
);

export const replicaCoverage = sqliteTable("replica_coverage", {
  subscription: text().primaryKey().notNull(),
  state: text({ enum: ["awaiting_snapshot", "downloaded"] }).notNull(),
  throughCommitSequence: text(),
  digest: text(),
});

export const snapshotImports = sqliteTable("snapshot_imports", {
  snapshotId: text().primaryKey().notNull(),
  generation: integer({ mode: "number" }).notNull(),
  subscription: text().notNull(),
  horizon: text().notNull(),
  stage: text({ enum: ["importing", "caught_up", "activated", "failed"] }).notNull(),
  partsImported: integer({ mode: "number" }).notNull().default(0),
  partsTotal: integer({ mode: "number" }).notNull(),
});

export const stockOverlays = sqliteTable(
  "stock_overlays",
  {
    commandId: text().notNull(),
    batchId: text().notNull(),
    packDelta: integer({ mode: "number" }).notNull(),
    unitDelta: integer({ mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "stock_overlays_command_id_batch_id_pk",
      columns: [table.commandId, table.batchId],
    }),
    uniqueIndex("stock_overlays_command_id_batch_id_uidx").on(table.commandId, table.batchId),
  ],
);

export const snapshotStagedRows = sqliteTable(
  "snapshot_staged_rows",
  {
    snapshotId: text().notNull(),
    entity: text().notNull(),
    entityId: text().notNull(),
    rowVersion: integer({ mode: "number" }).notNull(),
    rowJson: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: "snapshot_staged_rows_pk",
      columns: [table.snapshotId, table.entity, table.entityId],
    }),
    index("snapshot_staged_rows_snapshot_id_idx").on(table.snapshotId),
  ],
);
