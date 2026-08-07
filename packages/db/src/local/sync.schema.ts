import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { epochMilliseconds, tenantId } from "../shared/store.schema";
import type { SyncEntityChangePayload } from "../shared/sync";

export const syncOutbox = sqliteTable(
  "sync_outbox",
  {
    operationId: text().primaryKey(),
    organizationId: tenantId(),
    deviceId: text().notNull(),
    actorUserId: text().notNull(),
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

/** Sequence allocation survives acknowledged outbox pruning. */
export const syncDeviceState = sqliteTable(
  "sync_device_state",
  {
    organizationId: tenantId(),
    deviceId: text().notNull(),
    nextClientSequence: integer({ mode: "number" }).notNull().default(1),
  },
  (table) => [
    primaryKey({
      name: "sync_device_state_organization_device_pk",
      columns: [table.organizationId, table.deviceId],
    }),
  ],
);

export const syncState = sqliteTable("sync_state", {
  organizationId: tenantId().primaryKey(),
  cursor: epochMilliseconds().notNull().default(0),
  lastSuccessAt: epochMilliseconds(),
  lastAttemptAt: epochMilliseconds(),
  lastError: text(),
});
