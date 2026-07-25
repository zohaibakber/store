import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { epochMilliseconds, tenantId } from "../shared/store.schema";
import type { SyncEntityChangePayload } from "../shared/sync";

export const syncOutbox = sqliteTable(
  "sync_outbox",
  {
    operationId: text().primaryKey(),
    organizationId: tenantId(),
    deviceId: text().notNull(),
    actorUserId: text().notNull(),
    // Never hard-delete outbox rows; sequence numbers must not be reused.
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

export const syncState = sqliteTable("sync_state", {
  organizationId: tenantId().primaryKey(),
  cursor: epochMilliseconds().notNull().default(0),
  lastSuccessAt: epochMilliseconds(),
  lastAttemptAt: epochMilliseconds(),
  lastError: text(),
});
