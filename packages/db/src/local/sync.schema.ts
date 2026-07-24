import { bigserial, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { epochMilliseconds, tenantId } from "../shared/store.schema";
import type { SyncEntityChangePayload } from "../shared/sync";

// A row represents one atomic offline business operation and contains every
// entity mutation produced by the local database transaction.
export const syncOutbox = pgTable(
  "sync_outbox",
  {
    operationId: text().primaryKey(),
    organizationId: tenantId(),
    deviceId: text().notNull(),
    actorUserId: text().notNull(),
    clientSequence: bigserial({ mode: "number" }).notNull(),
    occurredAt: epochMilliseconds().notNull(),
    payload: jsonb().$type<ReadonlyArray<SyncEntityChangePayload>>().notNull(),
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
export const syncState = pgTable("sync_state", {
  organizationId: tenantId().primaryKey(),
  cursor: epochMilliseconds().notNull().default(0),
  lastSuccessAt: epochMilliseconds(),
  lastAttemptAt: epochMilliseconds(),
  lastError: text(),
});
