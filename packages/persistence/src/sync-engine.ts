import {
  MAX_SYNC_CHANGES_PER_OPERATION,
  MAX_SYNC_CHANGES_PER_REQUEST,
  MAX_SYNC_OPERATIONS_PER_REQUEST,
  type SyncEntityChange,
  type SyncOperation,
  type SyncRequest,
  type SyncStatus,
} from "@store/contracts";
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
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { MutationContext, PersistenceConfig } from "./config";
import type { StoreDatabase, StoreTransaction } from "./database";
import { PersistenceError, mapPersistenceError } from "./errors";

export interface SyncEngine {
  readonly signal: Effect.Effect<void>;
  readonly status: Effect.Effect<SyncStatus>;
  readonly statusChanges: Stream.Stream<SyncStatus>;
  readonly sync: Effect.Effect<SyncStatus, PersistenceError>;
}

const CategoryRow = createSelectSchema(categories);
const ProductRow = createSelectSchema(products);
const BatchRow = createSelectSchema(batches);
const InvoiceRow = createSelectSchema(invoices);
const InvoiceItemRow = createSelectSchema(invoiceItems, {
  quantityType: Schema.Literals(["unit", "pack"]),
});
const StockMovementRow = createSelectSchema(stockMovements, {
  type: Schema.Literals(["stock_in", "sale", "open_pack", "adjustment"]),
});

const invalidResponse = (message: string) =>
  PersistenceError.make({ operation: "apply sync response", message });

// Backoff for operations that keep failing after the in-request transport
// retry (see Effect.retry below) is exhausted. Pure and deterministic on
// purpose: jitter belongs only to the transport retry, not to a persisted
// deadline, or tests that manipulate `nextAttemptAt` directly become flaky.
const RETRY_BASE_MILLIS = 1_000;
const RETRY_CAP_MILLIS = 5 * 60 * 1_000;

export const retryDelayMillis = (attemptCount: number): number =>
  Math.min(RETRY_BASE_MILLIS * 2 ** Math.max(attemptCount - 1, 0), RETRY_CAP_MILLIS);

// An operation that has failed this many consecutive attempts is treated as
// stuck rather than merely retrying. Computed at read time from
// `attemptCount` — no schema change needed.
export const QUARANTINE_ATTEMPTS = 10;

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

const upsertRemoteChange = (
  transaction: StoreTransaction,
  actor: MutationContext,
  change: SyncEntityChange,
) =>
  Effect.gen(function* () {
    switch (change.entity) {
      case "category": {
        const row = yield* decodeRow(CategoryRow, change.row, change.entity);
        yield* ensureIdentity(row, actor, change);
        const current = yield* transaction.query.categories.findFirst({
          where: { organizationId: actor.organizationId, id: row.id },
        });
        if (current && current.rowVersion > change.rowVersion) return;
        const { id: _id, organizationId: _organizationId, ...set } = row;
        yield* transaction
          .insert(categories)
          .values(row)
          .onConflictDoUpdate({ target: [categories.organizationId, categories.id], set });
        return;
      }
      case "product": {
        const row = yield* decodeRow(ProductRow, change.row, change.entity);
        yield* ensureIdentity(row, actor, change);
        const current = yield* transaction.query.products.findFirst({
          where: { organizationId: actor.organizationId, id: row.id },
        });
        if (current && current.rowVersion > change.rowVersion) return;
        const { id: _id, organizationId: _organizationId, ...set } = row;
        yield* transaction
          .insert(products)
          .values(row)
          .onConflictDoUpdate({ target: [products.organizationId, products.id], set });
        return;
      }
      case "batch": {
        const row = yield* decodeRow(BatchRow, change.row, change.entity);
        yield* ensureIdentity(row, actor, change);
        const current = yield* transaction.query.batches.findFirst({
          where: { organizationId: actor.organizationId, id: row.id },
        });
        if (current && current.rowVersion > change.rowVersion) return;
        const { id: _id, organizationId: _organizationId, ...set } = row;
        yield* transaction
          .insert(batches)
          .values(row)
          .onConflictDoUpdate({ target: [batches.organizationId, batches.id], set });
        return;
      }
      case "invoice": {
        const row = yield* decodeRow(InvoiceRow, change.row, change.entity);
        yield* ensureIdentity(row, actor, change);
        const current = yield* transaction.query.invoices.findFirst({
          where: { organizationId: actor.organizationId, id: row.id },
        });
        if (current && current.rowVersion > change.rowVersion) return;
        const { id: _id, organizationId: _organizationId, ...set } = row;
        yield* transaction
          .insert(invoices)
          .values(row)
          .onConflictDoUpdate({ target: [invoices.organizationId, invoices.id], set });
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
        const row = yield* decodeRow(InvoiceItemRow, change.row, change.entity);
        yield* ensureIdentity(row, actor, change);
        const current = yield* transaction.query.invoiceItems.findFirst({
          where: { organizationId: actor.organizationId, id: row.id },
        });
        if (current && current.rowVersion > change.rowVersion) return;
        const { id: _id, organizationId: _organizationId, ...set } = row;
        yield* transaction
          .insert(invoiceItems)
          .values(row)
          .onConflictDoUpdate({ target: [invoiceItems.organizationId, invoiceItems.id], set });
        return;
      }
      case "stockMovement": {
        const row = yield* decodeRow(StockMovementRow, change.row, change.entity);
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
          // `occurredAt` is a plain integer column under SQLite and libSQL is
          // configured with intMode "number", so min() arrives as a number.
          // Under Postgres this was a bigint that the driver returned as a
          // string, which had to be converted; that hazard is gone.
          oldestPendingAt: sql<number | null>`min(${syncOutbox.occurredAt})`,
          // Postgres expressed this as
          // `(array_agg(... order by ...) filter (where ...))[1]`. SQLite has
          // neither array_agg nor array subscripting, so take the most recent
          // non-null error with an ordered subquery instead. It is not
          // correlated — every term is either a bound parameter or a constant —
          // so re-opening sync_outbox inside the aggregate is unambiguous.
          lastError: sql<string | null>`(
            select ${syncOutbox.lastError} from ${syncOutbox}
            where ${syncOutbox.organizationId} = ${currentActor.organizationId}
              and ${syncOutbox.acknowledgedAt} is null
              and ${syncOutbox.lastError} is not null
            order by ${syncOutbox.clientSequence} desc
            limit 1
          )`,
          // SQLite has no bool_or. max() is equivalent here because
          // attemptCount is non-negative, and it shares bool_or's null-over-
          // zero-rows behaviour, so the coalesce is still required: count(*)
          // returns a row even when the outbox is empty, which means the
          // `?? localOnlyOutboxHealth` fallback below never fires for it.
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
              // SQLite has no boolean type, so the comparison above returns 0
              // or 1, and a raw sql`` bypasses drizzle's column mapper.
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
      if (!transport) return false;
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
      const selected: typeof pending = [];
      let requestChangeCount = 0;
      for (const queued of pending) {
        if (selected.length >= MAX_SYNC_OPERATIONS_PER_REQUEST) break;
        if (queued.payload.length === 0)
          return yield* PersistenceError.make({
            operation: "build sync request",
            message: `Queued operation ${queued.operationId} contains no changes`,
          });
        if (queued.payload.length > MAX_SYNC_CHANGES_PER_OPERATION)
          return yield* PersistenceError.make({
            operation: "build sync request",
            message: `Queued operation ${queued.operationId} contains ${queued.payload.length} changes; the supported maximum is ${MAX_SYNC_CHANGES_PER_OPERATION}`,
          });
        if (
          selected.length > 0 &&
          requestChangeCount + queued.payload.length > MAX_SYNC_CHANGES_PER_REQUEST
        )
          break;
        selected.push(queued);
        requestChangeCount += queued.payload.length;
      }
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
                    lte(
                      syncOutbox.clientSequence,
                      selected[selected.length - 1]?.clientSequence ?? 0,
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
      return response.hasMore || pending.length > selected.length;
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
            let continueSync = true;
            let rounds = 0;
            while (continueSync && rounds < 100) {
              continueSync = yield* exchangeOnce();
              rounds += 1;
            }
            if (continueSync)
              return yield* PersistenceError.make({
                operation: "sync",
                message: "The sync server returned too many consecutive pages",
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
                // Backoff is uniform across the whole unacknowledged queue for
                // this org: it is driven by the head-of-line operation's
                // attempt count (already incremented before the exchange was
                // attempted), and the same deadline is written to every
                // pending row. A per-row deadline computed from each row's own
                // attemptCount would let a later, less-tried operation become
                // due before the head-of-line operation it is causally behind
                // — reintroducing the skip-ahead this plan deliberately avoids.
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
