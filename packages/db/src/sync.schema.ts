import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { epochMilliseconds, tenantId } from "./store.schema";

export const syncEntities = [
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "stockMovement",
] as const;
export type SyncEntity = (typeof syncEntities)[number];

export const syncActions = ["upsert", "delete"] as const;
export type SyncAction = (typeof syncActions)[number];

export interface SyncEntityChangePayload {
  readonly entity: SyncEntity;
  readonly action: SyncAction;
  readonly entityId: string;
  readonly rowVersion: number;
  readonly row: unknown;
}

// Local-only durable queue. A row represents one atomic business operation and
// contains every entity mutation produced by the local database transaction.
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

// Local checkpoint for the remote change-log cursor. Pull application and this
// cursor update must be committed in the same local transaction.
export const syncState = pgTable("sync_state", {
  organizationId: tenantId().primaryKey(),
  cursor: epochMilliseconds().notNull().default(0),
  lastSuccessAt: epochMilliseconds(),
  lastAttemptAt: epochMilliseconds(),
  lastError: text(),
});

// Server-side operation receipt. The payload hash makes retries idempotent and
// allows the API to reject reuse of an operation id with different content.
export const syncInbox = pgTable(
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

// Server-side append-only feed. Cursors are server generated and only have
// meaning when filtered by organization id.
export const syncChangeLog = pgTable(
  "sync_change_log",
  {
    cursor: bigserial({ mode: "number" }).primaryKey(),
    organizationId: tenantId(),
    operationId: text().notNull(),
    ordinal: integer().notNull(),
    entity: text().$type<SyncEntity>().notNull(),
    action: text().$type<SyncAction>().notNull(),
    entityId: text().notNull(),
    rowVersion: epochMilliseconds().notNull(),
    payload: jsonb().$type<SyncEntityChangePayload>().notNull(),
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
