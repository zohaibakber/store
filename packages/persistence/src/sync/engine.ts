import {
  type SyncEntityChange,
  type SyncOperation,
  type SyncRequest,
  type SyncStatus,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { categories, invoiceCounters, stockMovements, syncState } from "@store/db/local/schema";
import { and, eq, sql } from "drizzle-orm";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { PersistenceConfig, Workspace } from "../config";
import type { StoreDatabase, StoreTransaction } from "../database/client";
import { PersistenceError, mapPersistenceError } from "../errors";
import { emptyOutboxHealth, exchangeOutcome, makeOutbox, type ExchangeOutcome } from "./outbox";

export { QUARANTINE_ATTEMPTS, retryDelayMillis } from "./outbox";

export interface SyncEngine {
  readonly signal: Effect.Effect<void>;
  readonly status: Effect.Effect<SyncStatus>;
  readonly statusChanges: Stream.Stream<SyncStatus>;
  readonly sync: Effect.Effect<SyncStatus, PersistenceError>;
}

const invalidResponse = (message: string) =>
  PersistenceError.make({ operation: "apply sync response", message });

const MAX_EXCHANGE_ROUNDS = 100;

const ensureIdentity = (
  row: { readonly organizationId: string; readonly id: string },
  workspace: Workspace,
  change: SyncEntityChange,
) =>
  row.organizationId === workspace.organizationId && row.id === change.entityId
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

const applyIfRemoteWins = <A, E, R>(
  change: SyncEntityChange,
  current: Effect.Effect<{ readonly rowVersion: number } | undefined, E, R>,
  upsert: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    if (!remoteChangeWins(yield* current, change)) return false;
    yield* upsert;
    return true;
  });

/** A decoded remote row: every synced table carries this identity triple. */
interface RemoteRow {
  readonly id: string;
  readonly organizationId: string;
  readonly rowVersion: number;
}

/**
 * Last-writer-wins upsert keyed on `(organizationId, id)`. Every versioned
 * entity applies the identical shape, so the table comes from the entity
 * registry rather than a per-entity branch.
 */
const upsertVersionedRow = (
  transaction: StoreTransaction,
  workspace: Workspace,
  change: SyncEntityChange,
  row: RemoteRow,
) => {
  // The registry maps each entity to its table; drizzle cannot narrow the
  // resulting union, so the column handles are read through a shared shape.
  const table = syncEntityRows[change.entity].table as unknown as typeof categories;
  const { id: _id, organizationId: _organizationId, ...set } = row;
  return applyIfRemoteWins(
    change,
    transaction
      .select({ rowVersion: table.rowVersion })
      .from(table)
      .where(and(eq(table.organizationId, workspace.organizationId), eq(table.id, row.id)))
      .limit(1)
      .pipe(Effect.map((rows) => rows[0])),
    transaction
      .insert(table)
      .values(row as typeof categories.$inferInsert)
      .onConflictDoUpdate({ target: [table.organizationId, table.id], set }),
  );
};

const upsertRemoteChange = (
  transaction: StoreTransaction,
  workspace: Workspace,
  change: SyncEntityChange,
) =>
  Effect.gen(function* () {
    switch (change.entity) {
      // Stock movements are append-only: an existing row is never rewritten.
      case "stockMovement": {
        const row = yield* decodeRow(
          syncEntityRows.stockMovement.schema,
          change.row,
          change.entity,
        );
        yield* ensureIdentity(row, workspace, change);
        yield* transaction.insert(stockMovements).values(row).onConflictDoNothing();
        return;
      }
      // Invoices additionally advance the organization's invoice counter.
      case "invoice": {
        const row = yield* decodeRow(syncEntityRows.invoice.schema, change.row, change.entity);
        yield* ensureIdentity(row, workspace, change);
        if (!(yield* upsertVersionedRow(transaction, workspace, change, row))) return;
        yield* transaction
          .insert(invoiceCounters)
          .values({
            organizationId: workspace.organizationId,
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
      default: {
        const row = yield* decodeRow(
          syncEntityRows[change.entity].schema,
          change.row,
          change.entity,
        );
        yield* ensureIdentity(row, workspace, change);
        yield* upsertVersionedRow(transaction, workspace, change, row);
      }
    }
  });

export const makeSyncEngine = (
  database: StoreDatabase,
  config: PersistenceConfig,
  workspace: Workspace,
) =>
  Effect.gen(function* () {
    const outbox = makeOutbox(database, workspace);

    const initialState = yield* database.query.syncState
      .findFirst({ where: { organizationId: workspace.organizationId } })
      .pipe(mapPersistenceError("load sync state"));
    const configured = config.syncTransport !== undefined;
    const initialHealth = configured ? yield* outbox.health : emptyOutboxHealth;
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
      const localState = yield* database.query.syncState
        .findFirst({ where: { organizationId: workspace.organizationId } })
        .pipe(mapPersistenceError("load sync state"));
      const cursor = localState?.cursor ?? 0;
      const batch = yield* outbox.nextBatch;
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
        organizationId: workspace.organizationId,
        deviceId: workspace.deviceId,
        cursor,
        operations,
      };
      const attemptedAt = Date.now();
      yield* Effect.all(
        [
          database
            .update(syncState)
            .set({ lastAttemptAt: attemptedAt })
            .where(eq(syncState.organizationId, workspace.organizationId)),
          outbox.markAttempt(selected.map((queued) => queued.operationId)),
        ],
        { concurrency: 1, discard: true },
      ).pipe(mapPersistenceError("record sync attempt"));

      const response = yield* Effect.suspend(() => transport.exchange(request)).pipe(
        Effect.retry({
          schedule: Schedule.exponential(
            Duration.millis(config.exchangeRetryBaseMillis ?? 500),
          ).pipe(Schedule.jittered),
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
      if (response.organizationId !== workspace.organizationId || response.cursor < cursor)
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
              yield* upsertRemoteChange(transaction, workspace, serverChange.change);
            }
            const completedAt = Date.now();
            yield* outbox.acknowledge(
              transaction,
              response.acknowledgements.map((acknowledgement) => acknowledgement.operationId),
              completedAt,
            );
            yield* transaction
              .update(syncState)
              .set({
                cursor: response.cursor,
                lastSuccessAt: completedAt,
                lastAttemptAt: completedAt,
                lastError: null,
              })
              .where(eq(syncState.organizationId, workspace.organizationId));
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
              .findFirst({ where: { organizationId: workspace.organizationId } })
              .pipe(mapPersistenceError("load completed sync state"));
            const health = yield* outbox.health;
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
              const recorded = yield* Effect.gen(function* () {
                yield* Effect.all(
                  [
                    database
                      .update(syncState)
                      .set({ lastAttemptAt: Date.now(), lastError: error.message })
                      .where(eq(syncState.organizationId, workspace.organizationId)),
                    outbox.markFailure(error.message),
                  ],
                  { concurrency: 1, discard: true },
                );
              }).pipe(mapPersistenceError("record sync failure"), Effect.result);
              if (recorded._tag === "Failure")
                yield* Effect.logWarning("Could not persist sync failure status", recorded.failure);
              const health = yield* Effect.result(outbox.health);
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
      yield* Stream.fromQueue(signals).pipe(
        Stream.runForEach(() =>
          sync().pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Background synchronization failed", error),
            ),
            Effect.ignore,
          ),
        ),
        Effect.forkScoped,
      );
      const resyncInterval = config.resyncIntervalMillis ?? 300_000;
      yield* Queue.offer(signals, undefined).pipe(
        Effect.repeat(Schedule.spaced(resyncInterval)),
        Effect.forkScoped,
      );
    }

    return {
      signal: configured ? Queue.offer(signals, undefined).pipe(Effect.asVoid) : Effect.void,
      status: SubscriptionRef.get(status),
      statusChanges: SubscriptionRef.changes(status),
      sync: sync(),
    } satisfies SyncEngine;
  });
