export {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "../shared/store.schema";

import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const replicaState = sqliteTable("replica_state", {
  id: text().primaryKey().notNull(),
  organizationId: text().notNull(),
  userId: text().notNull(),
  replicaId: text().notNull(),
  epoch: text().notNull(),
  appliedCommitSequence: text().notNull(),
  nextClientSequence: text().notNull(),
  localCommitVersion: integer({ mode: "number" }).notNull(),
});

export const commandOutbox = sqliteTable("command_outbox", {
  operationId: text().primaryKey().notNull(),
  status: text({
    enum: ["pending", "sending", "accepted_awaiting_integration", "integrated", "rejected"],
  }).notNull(),
  envelopeJson: text().notNull(),
  receiptJson: text(),
  clientSequence: text().notNull(),
  createdAt: integer({ mode: "number" }).notNull(),
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
