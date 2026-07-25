import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { epochMilliseconds, tenantId } from "../shared/store.schema";
import type { SyncEntity, SyncEntityChangePayload } from "../shared/sync";

// Server-side operation receipt. The payload hash makes retries idempotent and
// rejects operation-id reuse with different content.
//
// Under Postgres this was additionally guarded by `pg_advisory_xact_lock`. A
// Durable Object executes one request at a time, so the primary key below is
// sufficient on its own — see plans/021-dead-code-register.md.
export const syncInbox = sqliteTable(
  "sync_inbox",
  {
    organizationId: tenantId(),
    operationId: text().notNull(),
    deviceId: text().notNull(),
    actorUserId: text().notNull(),
    clientSequence: epochMilliseconds().notNull(),
    payloadHash: text().notNull(),
    appliedCursor: epochMilliseconds().notNull(),
    receivedAt: epochMilliseconds().notNull(),
  },
  (table) => [
    primaryKey({
      name: "sync_inbox_organization_operation_pk",
      columns: [table.organizationId, table.operationId],
    }),
    uniqueIndex("sync_inbox_organization_device_sequence_uidx").on(
      table.organizationId,
      table.deviceId,
      table.clientSequence,
    ),
  ],
);

// Server-side append-only feed. Cursors are scoped to an organization.
export const syncChangeLog = sqliteTable(
  "sync_change_log",
  {
    // Was `bigserial` under Postgres. Here the cursor IS the primary key, so
    // SQLite's INTEGER PRIMARY KEY AUTOINCREMENT applies directly — unlike the
    // client outbox, where `operationId` occupies the primary key and the
    // sequence has to be assigned by the application.
    cursor: integer().primaryKey({ autoIncrement: true }),
    organizationId: tenantId(),
    operationId: text().notNull(),
    ordinal: integer().notNull(),
    entity: text().$type<SyncEntity>().notNull(),
    action: text().$type<SyncEntityChangePayload["action"]>().notNull(),
    entityId: text().notNull(),
    rowVersion: epochMilliseconds().notNull(),
    payload: text({ mode: "json" }).$type<SyncEntityChangePayload>().notNull(),
    changedAt: epochMilliseconds().notNull(),
  },
  (table) => [
    uniqueIndex("sync_change_log_organization_operation_ordinal_uidx").on(
      table.organizationId,
      table.operationId,
      table.ordinal,
    ),
    index("sync_change_log_organization_cursor_idx").on(table.organizationId, table.cursor),
    index("sync_change_log_organization_entity_idx").on(
      table.organizationId,
      table.entity,
      table.entityId,
    ),
  ],
);
