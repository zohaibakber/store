import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { epochMilliseconds, tenantId } from "../shared/store.schema";
import type { SyncEntityChangePayload } from "../shared/sync";

// A row represents one atomic offline business operation and contains every
// entity mutation produced by the local database transaction.
export const syncOutbox = sqliteTable(
  "sync_outbox",
  {
    operationId: text().primaryKey(),
    organizationId: tenantId(),
    deviceId: text().notNull(),
    actorUserId: text().notNull(),
    // Was `bigserial` under Postgres. SQLite's AUTOINCREMENT only applies to an
    // INTEGER PRIMARY KEY, which `operationId` already occupies, so this is
    // assigned by the application inside the enqueue transaction (see
    // packages/persistence/src/outbox.ts) as max+1 per organization+device.
    //
    // INVARIANT: outbox rows must never be hard-deleted. Acknowledgement sets
    // `acknowledgedAt`; it does not remove the row. Pruning acknowledged rows
    // would let a sequence number be reused and silently corrupt sync ordering.
    // If pruning is ever needed, move this counter into its own table first
    // (see `invoiceCounters` for the established pattern).
    clientSequence: integer({ mode: "number" }).notNull(),
    occurredAt: epochMilliseconds().notNull(),
    payload: text({ mode: "json" }).$type<ReadonlyArray<SyncEntityChangePayload>>().notNull(),
    payloadHash: text().notNull(),
    attemptCount: integer().notNull().default(0),
    nextAttemptAt: epochMilliseconds(),
    lastError: text(),
    acknowledgedAt: epochMilliseconds(),
  },
  (table) => [
    uniqueIndex("sync_outbox_organization_device_sequence_uidx").on(
      table.organizationId,
      table.deviceId,
      table.clientSequence,
    ),
    index("sync_outbox_pending_idx").on(
      table.organizationId,
      table.acknowledgedAt,
      table.nextAttemptAt,
      table.clientSequence,
    ),
  ],
);

// Pull application and this cursor update are committed in one local transaction.
export const syncState = sqliteTable("sync_state", {
  organizationId: tenantId().primaryKey(),
  cursor: epochMilliseconds().notNull().default(0),
  lastSuccessAt: epochMilliseconds(),
  lastAttemptAt: epochMilliseconds(),
  lastError: text(),
});
