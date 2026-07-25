import {
  MAX_SYNC_OPERATIONS_PER_REQUEST,
  type SyncEntityChange,
  type SyncOperation,
  type SyncRequest,
  type SyncStatus,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import {
  batches,
  categories,
  invoiceCounters,
  invoiceItems,
  invoices,
  products,
  stockMovements,
  syncOutbox,
  syncState,
} from "@store/db/local/schema";
import type { InferInsertModel } from "drizzle-orm";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { MutationContext, PersistenceConfig } from "../config";
import type { StoreDatabase, StoreTransaction } from "../database/client";
import { PersistenceError, mapPersistenceError } from "../errors";
import { exchangeOutcome, selectBatch, type ExchangeOutcome } from "./outbox-batch";

export interface SyncEngine {
  readonly signal: Effect.Effect<void>;
  readonly status: Effect.Effect<SyncStatus>;
  readonly statusChanges: Stream.Stream<SyncStatus>;
  readonly sync: Effect.Effect<SyncStatus, PersistenceError>;
}

const invalidResponse = (message: string) =>
  PersistenceError.make({ operation: "apply sync response", message });

// Persisted deadlines stay deterministic; only transport retries use jitter.
const RETRY_BASE_MILLIS = 1_000;
const RETRY_CAP_MILLIS = 5 * 60 * 1_000;

export const retryDelayMillis = (attemptCount: number): number =>
  Math.min(RETRY_BASE_MILLIS * 2 ** Math.max(attemptCount - 1, 0), RETRY_CAP_MILLIS);

export const QUARANTINE_ATTEMPTS = 10;

const MAX_EXCHANGE_ROUNDS = 100;

const ensureIdentity = (
  row: { readonly organizationId: string; readonly id: string },
  actor: MutationContext,
  change: SyncEntityChange,
) =>
  row.organizationId === actor.organizationId && row.id === change.entityId
    ? Effect.void
    : Effect.fail(invalidResponse(`Remote ${change.entity} change has invalid identity`));

const decodeRow = <S extends Schema.Top>(schema: S, row: unknown, entity: string) =>
  Schema.decodeUnknownEffect(schema)(row).pipe(
    Effect.mapError(() => invalidResponse(`Remote ${entity} change has an invalid row`)),
  );

export const remoteChangeWins = (
  local: { readonly rowVersion: number } | undefined,
  change: { readonly rowVersion: number },
) => local === undefined || local.rowVersion <= change.rowVersion;

type VersionedTable = SQLiteTable & {
  readonly id: SQLiteColumn;
  readonly organizationId: SQLiteColumn;
  readonly rowVersion: SQLiteColumn;
};

const upsertVersionedRow = <T extends VersionedTable>(
  transaction: StoreTransaction,
  actor: MutationContext,
  change: SyncEntityChange,
  concreteTable: T,
  decodedRow: InferInsertModel<T> & { readonly id: string },
) =>
  Effect.gen(function* () {
    // Drizzle's mutation builders cannot express the shared table shape.
    const table = concreteTable as unknown as typeof products;
    const row = decodedRow as unknown as typeof products.$inferInsert & { id: string };

    const [current] = yield* transaction
      .select({ rowVersion: table.rowVersion })
      .from(table)
      .where(and(eq(table.organizationId, actor.organizationId), eq(table.id, row.id)))
      .limit(1);
    if (!remoteChangeWins(current, change)) return false;

    const { id: _id, organizationId: _organizationId, ...set } = row;
    yield* transaction
      .insert(table)
      .values(row)
      .onConflictDoUpdate({ target: [table.organizationId, table.id], set });
    return true;
  });

const upsertRemoteChange = (
  transaction: StoreTransaction,
  actor: MutationContext,
  change: SyncEntityChange,
) =>
  Effect.gen(function* () {
    switch (change.entity) {
      case "category": {
        const row = yield* decodeRow(syncEntityRows.category.schema, change.row, change.entity);
        yield* ensureIdentity(row, actor, change);
        yield* upsertVersionedRow(transaction, actor, change, categories, row);
        return;
      }
      case "product": {
        const row = yield* decodeRow(syncEntityRows.product.schema, change.row, change.entity);
        yield* ensureIdentity(row, actor, change);
        yield* upsertVersionedRow(transaction, actor, change, products, row);
        return;
      }
      case "batch": {
        const row = yield* decodeRow(syncEntityRows.batch.schema, change.row, change.entity);
        yield* ensureIdentity(row, actor, change);
        yield* upsertVersionedRow(transaction, actor, change, batches, row);
        return;
      }
      case "invoice": {
        const row = yield* decodeRow(syncEntityRows.invoice.schema, change.row, change.entity);
        yield* ensureIdentity(row, actor, change);
        const applied = yield* upsertVersionedRow(transaction, actor, change, invoices, row);
        if (applied)
          yield* transaction
            .insert(invoiceCounters)
            .values({
              organizationId: actor.organizationId,
              lastInvoiceNumber: row.invoiceNumber,
            })
            .onConflictDoUpdate({
              target: invoiceCounters.organizationId,
              set: {
                lastInvoiceNumber: sql`greatest(${invoiceCounters.lastInvoiceNumber}, ${row.invoiceNumber})`,
              },
            });
        return;
      }
      case "invoiceItem": {
        const row = yield* decodeRow(syncEntityRows.invoiceItem.schema, change.row, change.entity);
        yield* ensureIdentity(row, actor, change);
        yield* upsertVersionedRow(transaction, actor, change, invoiceItems, row);
        return;
      }
      case "stockMovement": {
        const row = yield* decodeRow(
          syncEntityRows.stockMovement.schema,
          change.row,
          change.entity,
        );
        yield* ensureIdentity(row, actor, change);
        yield* transaction.insert(stockMovements).values(row).onConflictDoNothing();
      }
    }
  });

interface OutboxHealth {
  readonly pendingOperations: number;
  readonly oldestPendingAt: number | null;
  readonly lastError: string | null;
  readonly quarantined: boolean;
}

const localOnlyOutboxHealth: OutboxHealth = {
  pendingOperations: 0,
  oldestPendingAt: null,
  lastError: null,
  quarantined: false,
};

export const makeSyncEngine = (
  database: StoreDatabase,
  config: PersistenceConfig,
  mutationContext: () => MutationContext,
) =>
  Effect.gen(function* () {
    const actor = mutationContext();

    const readOutboxHealth = Effect.fn("OfflineStore.readOutboxHealth")(function* () {
      const currentActor = mutationContext();
      const [health] = yield* database
        .select({
          pendingOperations: sql<number>`count(*)`,
          oldestPendingAt: sql<number | null>`min(${syncOutbox.occurredAt})`,
          lastError: sql<string | null>`(
            select ${syncOutbox.lastError} from ${syncOutbox}
            where ${syncOutbox.organizationId} = ${currentActor.organizationId}
              and ${syncOutbox.acknowledgedAt} is null
              and ${syncOutbox.lastError} is not null
            order by ${syncOutbox.clientSequence} desc
            limit 1
          )`,
          quarantined: sql<number>`coalesce(max(${syncOutbox.attemptCount}), 0) >= ${QUARANTINE_ATTEMPTS}`,
        })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.organizationId, currentActor.organizationId),
            isNull(syncOutbox.acknowledgedAt),
          ),
        )
        .pipe(mapPersistenceError("read outbox health"));
      const result: OutboxHealth =
        health === undefined
          ? localOnlyOutboxHealth
          : {
              pendingOperations: health.pendingOperations,
              oldestPendingAt: health.oldestPendingAt,
              lastError: health.lastError,
              // Raw SQLite boolean expressions return 0 or 1.
              quarantined: health.quarantined === 1,
            };
      return result;
    });

    const initialState = yield* database.query.syncState
      .findFirst({ where: { organizationId: actor.organizationId } })
      .pipe(mapPersistenceError("load sync state"));
    const configured = config.syncTransport !== undefined;
    const initialHealth = configured ? yield* readOutboxHealth() : localOnlyOutboxHealth;
    const status = yield* SubscriptionRef.make<SyncStatus>({
      phase: configured ? "idle" : "local-only",
      configured,
      lastSyncedAt: initialState?.lastSuccessAt ?? null,
      message: configured ? "Ready to sync" : "Cloud sync is not configured",
      ...initialHealth,
    });
    const lock = yield* Semaphore.make(1);
    const signals = yield* Queue.sliding<void>(1);

    const exchangeOnce = Effect.fn("OfflineStore.exchangeOnce")(function* () {
      const transport = config.syncTransport;
      if (!transport) return { _tag: "Drained" } satisfies ExchangeOutcome;
      const currentActor = mutationContext();
      const localState = yield* database.query.syncState
        .findFirst({ where: { organizationId: currentActor.organizationId } })
        .pipe(mapPersistenceError("load sync state"));
      const cursor = localState?.cursor ?? 0;
      const now = Date.now();
      const pending = yield* database
        .select()
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.organizationId, currentActor.organizationId),
            isNull(syncOutbox.acknowledgedAt),
            or(isNull(syncOutbox.nextAttemptAt), lte(syncOutbox.nextAttemptAt, now)),
          ),
        )
        .orderBy(asc(syncOutbox.clientSequence))
        .limit(MAX_SYNC_OPERATIONS_PER_REQUEST + 1)
        .pipe(mapPersistenceError("load pending sync operations"));
      const batch = selectBatch(pending);
      if (batch._tag === "Unsendable")
        return yield* PersistenceError.make({
          operation: "build sync request",
          message: batch.reason,
        });
      const selected = batch.operations;
      const requestChangeCount = batch.changeCount;
      const operations: SyncOperation[] = selected.map((queued) => ({
        operationId: queued.operationId,
        organizationId: queued.organizationId,
        deviceId: queued.deviceId,
        actorUserId: queued.actorUserId,
        clientSequence: queued.clientSequence,
        occurredAt: queued.occurredAt,
        payloadHash: queued.payloadHash,
        changes: queued.payload,
      }));
      const request: SyncRequest = {
        organizationId: currentActor.organizationId,
        deviceId: currentActor.deviceId,
        cursor,
        operations,
      };
      const attemptedAt = Date.now();
      yield* Effect.all(
        [
          database
            .update(syncState)
            .set({ lastAttemptAt: attemptedAt })
            .where(eq(syncState.organizationId, currentActor.organizationId)),
          operations.length === 0
            ? Effect.void
            : database
                .update(syncOutbox)
                .set({ attemptCount: sql`${syncOutbox.attemptCount} + 1`, lastError: null })
                .where(
                  and(
                    eq(syncOutbox.organizationId, currentActor.organizationId),
                    inArray(
                      syncOutbox.operationId,
                      selected.map((queued) => queued.operationId),
                    ),
                    isNull(syncOutbox.acknowledgedAt),
                  ),
                ),
        ],
        { concurrency: 1, discard: true },
      ).pipe(mapPersistenceError("record sync attempt"));

      const response = yield* Effect.suspend(() => transport.exchange(request)).pipe(
        Effect.retry({
          schedule: Schedule.exponential("500 millis").pipe(Schedule.jittered),
          times: 3,
          while: (error) => error.retryable,
        }),
        Effect.tapError((error) =>
          Effect.logWarning("Sync exchange failed", error).pipe(
            Effect.annotateLogs({
              cursor,
              operationCount: operations.length,
              changeCount: requestChangeCount,
            }),
          ),
        ),
        Effect.mapError((error) =>
          PersistenceError.make({
            operation: "exchange sync changes",
            message: [
              error.code ? `[${error.code}]` : undefined,
              error.message,
              error.status ? `(HTTP ${error.status})` : undefined,
            ]
              .filter((part) => part !== undefined)
              .join(" "),
            cause: error,
          }),
        ),
      );
      if (response.organizationId !== currentActor.organizationId || response.cursor < cursor)
        return yield* invalidResponse("The sync response has an invalid organization or cursor");
      const acknowledgementIds = new Set(response.acknowledgements.map((ack) => ack.operationId));
      if (operations.some((operation) => !acknowledgementIds.has(operation.operationId)))
        return yield* invalidResponse(
          "The sync response did not acknowledge every submitted operation",
        );

      yield* database
        .transaction((transaction) =>
          Effect.gen(function* () {
            let previousCursor = cursor;
            for (const serverChange of response.changes) {
              if (serverChange.cursor <= previousCursor || serverChange.cursor > response.cursor)
                return yield* invalidResponse("Remote changes are not in strict cursor order");
              previousCursor = serverChange.cursor;
              yield* upsertRemoteChange(transaction, currentActor, serverChange.change);
            }
            const completedAt = Date.now();
            for (const acknowledgement of response.acknowledgements)
              yield* transaction
                .update(syncOutbox)
                .set({ acknowledgedAt: completedAt, lastError: null, nextAttemptAt: null })
                .where(
                  and(
                    eq(syncOutbox.organizationId, currentActor.organizationId),
                    eq(syncOutbox.operationId, acknowledgement.operationId),
                  ),
                );
            yield* transaction
              .update(syncState)
              .set({
                cursor: response.cursor,
                lastSuccessAt: completedAt,
                lastAttemptAt: completedAt,
                lastError: null,
              })
              .where(eq(syncState.organizationId, currentActor.organizationId));
          }),
        )
        .pipe(mapPersistenceError("apply sync response"));
      return exchangeOutcome({ hasMore: response.hasMore, moreDue: batch.moreDue });
    });

    const sync = (): Effect.Effect<SyncStatus, PersistenceError> => {
      if (!config.syncTransport) return SubscriptionRef.get(status);
      return lock
        .withPermit(
          Effect.gen(function* () {
            yield* SubscriptionRef.update(status, (current) => {
              const next: SyncStatus = {
                ...current,
                phase: "syncing",
                message: "Synchronizing local and cloud changes…",
              };
              return next;
            });
            let outcome: ExchangeOutcome = { _tag: "MorePending", reason: "held-back" };
            let rounds = 0;
            while (outcome._tag === "MorePending" && rounds < MAX_EXCHANGE_ROUNDS) {
              outcome = yield* exchangeOnce();
              rounds += 1;
            }
            if (outcome._tag === "MorePending")
              return yield* PersistenceError.make({
                operation: "sync",
                message:
                  outcome.reason === "server-pages"
                    ? `The sync server returned more than ${MAX_EXCHANGE_ROUNDS} consecutive pages`
                    : `The outbox still had work after ${MAX_EXCHANGE_ROUNDS} exchanges`,
              });
            const state = yield* database.query.syncState
              .findFirst({ where: { organizationId: mutationContext().organizationId } })
              .pipe(mapPersistenceError("load completed sync state"));
            const health = yield* readOutboxHealth();
            const next: SyncStatus = {
              phase: "idle",
              configured: true,
              lastSyncedAt: state?.lastSuccessAt ?? Date.now(),
              message: "Local and cloud data are in sync",
              ...health,
            };
            yield* SubscriptionRef.set(status, next);
            return next;
          }),
        )
        .pipe(
          Effect.tapError((error) =>
            Effect.gen(function* () {
              const currentActor = mutationContext();
              const recorded = yield* Effect.gen(function* () {
                // One deadline prevents later operations from skipping the failed head.
                const head = yield* database
                  .select({ attemptCount: syncOutbox.attemptCount })
                  .from(syncOutbox)
                  .where(
                    and(
                      eq(syncOutbox.organizationId, currentActor.organizationId),
                      isNull(syncOutbox.acknowledgedAt),
                    ),
                  )
                  .orderBy(asc(syncOutbox.clientSequence))
                  .limit(1)
                  .pipe(mapPersistenceError("read outbox head for backoff"));
                const nextAttemptAt =
                  head[0] === undefined
                    ? null
                    : Date.now() + retryDelayMillis(head[0].attemptCount);
                yield* Effect.all(
                  [
                    database
                      .update(syncState)
                      .set({ lastAttemptAt: Date.now(), lastError: error.message })
                      .where(eq(syncState.organizationId, currentActor.organizationId)),
                    database
                      .update(syncOutbox)
                      .set({ lastError: error.message, nextAttemptAt })
                      .where(
                        and(
                          eq(syncOutbox.organizationId, currentActor.organizationId),
                          isNull(syncOutbox.acknowledgedAt),
                        ),
                      ),
                  ],
                  { concurrency: 1, discard: true },
                );
              }).pipe(mapPersistenceError("record sync failure"), Effect.result);
              if (recorded._tag === "Failure")
                yield* Effect.logWarning("Could not persist sync failure status", recorded.failure);
              const health = yield* Effect.result(readOutboxHealth());
              yield* SubscriptionRef.update(status, (current) => {
                const next: SyncStatus = {
                  ...current,
                  ...(health._tag === "Success" ? health.success : {}),
                  phase: "error",
                  message: error.message,
                };
                return next;
              });
            }),
          ),
        );
    };

    if (configured) {
      yield* Effect.gen(function* () {
        while (true) {
          yield* Queue.take(signals);
          const result = yield* Effect.result(sync());
          if (result._tag === "Failure")
            yield* Effect.logWarning("Background synchronization failed", result.failure);
        }
      }).pipe(Effect.forkScoped);
      const resyncInterval = config.resyncIntervalMillis ?? 300_000;
      yield* Queue.offer(signals, undefined).pipe(
        Effect.delay(resyncInterval),
        Effect.forever,
        Effect.forkScoped,
      );
      yield* Queue.offer(signals, undefined);
    }

    return {
      signal: configured ? Queue.offer(signals, undefined).pipe(Effect.asVoid) : Effect.void,
      status: SubscriptionRef.get(status),
      statusChanges: SubscriptionRef.changes(status),
      sync: sync(),
    } satisfies SyncEngine;
  });
