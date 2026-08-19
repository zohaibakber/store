import {
  type SyncEntityChange,
  type SyncOperation,
  type SyncRequest,
  type SyncStatus,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { categories, invoiceCounters, stockMovements, syncState } from "@store/db/local/schema";
import { makeSyncClientRuntime } from "@store/sync-client";
import { and, eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { PersistenceConfig, Workspace } from "../config";
import type { StoreDatabase, StoreTransaction } from "../database/client";
import { PersistenceError, SyncTransportError, mapPersistenceError } from "../errors";
import { emptyOutboxHealth, makeOutbox } from "./outbox";
import { makeSyncSocketSession } from "./session";

export { QUARANTINE_ATTEMPTS, retryDelayMillis } from "./outbox";

export interface SyncEngine {
  readonly signal: Effect.Effect<void>;
  readonly status: Effect.Effect<SyncStatus>;
  readonly statusChanges: Stream.Stream<SyncStatus>;
  readonly sync: Effect.Effect<SyncStatus, PersistenceError>;
}

const invalidResponse = (message: string) =>
  PersistenceError.make({ operation: "apply sync response", message });

const ensureIdentity = (
  row: { readonly organizationId: string; readonly id: string },
  workspace: Workspace,
  change: SyncEntityChange,
) =>
  row.organizationId === workspace.organizationId && row.id === change.entityId
    ? Effect.void
    : Effect.fail(invalidResponse(`Remote ${change.entity} change has invalid identity`));

const decodeRow = <S extends Schema.Top, Row>(schema: S, row: Row, entity: string) =>
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
  // SAFETY: Every versioned registry table exposes the managed identity/version
  // columns used here; its entity-specific row was decoded before this call.
  const table = syncEntityRows[change.entity].table as typeof categories;
  const { id: _id, organizationId: _organizationId, ...set } = row;
  // SAFETY: The decoded registry row corresponds to the selected registry table.
  const insertRow = row as typeof categories.$inferInsert;
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
      .values(insertRow)
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
              // SQLite has no `greatest`; two-argument `max` is its scalar equivalent.
              lastInvoiceNumber: sql`max(${invoiceCounters.lastInvoiceNumber}, ${row.invoiceNumber})`,
            },
          });
        return;
      }
      case "category":
      case "product":
      case "batch":
      case "invoiceItem": {
        const row = yield* decodeRow(
          syncEntityRows[change.entity].schema,
          change.row,
          change.entity,
        );
        yield* ensureIdentity(row, workspace, change);
        yield* upsertVersionedRow(transaction, workspace, change, row);
        return;
      }
      default: {
        const _exhaustive: never = change.entity;
        return _exhaustive;
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
    if (configured) {
      yield* outbox.migratePendingActor;
      yield* outbox.recoverAuthenticationFailures;
    }
    const initialHealth = configured ? yield* outbox.health : emptyOutboxHealth;
    const initialStatus: SyncStatus = {
      phase: configured ? "starting" : "local-only",
      lastSyncedAt: initialState?.lastSuccessAt ?? null,
      message: configured ? "Starting synchronization…" : "Cloud sync is not configured",
      ...initialHealth,
    };

    const session = config.syncTransport?.openLive
      ? yield* makeSyncSocketSession({
          open: config.syncTransport.openLive,
          httpExchange: config.syncTransport.exchange,
        })
      : undefined;
    const exchange = session?.exchange ?? config.syncTransport?.exchange;

    const exchangeOnce = Effect.fn("OfflineStore.exchangeOnce")(function* () {
      if (!exchange)
        return { cursor: initialState?.cursor ?? 0, hasMore: false, moreLocalWork: false };
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
      const baseRequest = {
        protocolVersion: 2,
        organizationId: workspace.organizationId,
        deviceId: workspace.deviceId,
        cursor,
        operations,
      } satisfies SyncRequest;
      const platformRequest = config.clientPlatform
        ? { ...baseRequest, clientPlatform: config.clientPlatform }
        : baseRequest;
      const request: SyncRequest = config.clientVersion
        ? { ...platformRequest, clientVersion: config.clientVersion }
        : platformRequest;
      const attemptedAt = Date.now();
      yield* database
        .update(syncState)
        .set({ lastAttemptAt: attemptedAt })
        .where(eq(syncState.organizationId, workspace.organizationId))
        .pipe(mapPersistenceError("record sync attempt"));

      const response = yield* Effect.suspend(() => exchange(request)).pipe(
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
      if (
        response.protocolVersion !== 2 ||
        response.organizationId !== workspace.organizationId ||
        response.cursor !== response.nextCursor ||
        response.nextCursor < cursor ||
        response.headCursor < response.nextCursor
      )
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
              if (
                serverChange.cursor <= previousCursor ||
                serverChange.cursor > response.nextCursor
              )
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
                cursor: response.nextCursor,
                lastSuccessAt: completedAt,
                lastAttemptAt: completedAt,
                lastError: null,
              })
              .where(eq(syncState.organizationId, workspace.organizationId));
          }),
        )
        .pipe(mapPersistenceError("apply sync response"));
      return {
        cursor: response.nextCursor,
        hasMore: response.hasMore,
        moreLocalWork: batch.moreDue,
      };
    });

    const completedStatus = Effect.gen(function* () {
      if (!configured) return initialStatus;
      const state = yield* database.query.syncState
        .findFirst({ where: { organizationId: workspace.organizationId } })
        .pipe(mapPersistenceError("load completed sync state"));
      const health = yield* outbox.health;
      return {
        phase: health.quarantined ? "blocked" : "idle",
        lastSyncedAt: state?.lastSuccessAt ?? Date.now(),
        message: health.quarantined
          ? "Synchronization is blocked by a quarantined operation"
          : "Local and cloud data are in sync",
        ...health,
      } satisfies SyncStatus;
    });

    const failureStatus = Effect.fn("OfflineStore.syncFailureStatus")(function* (
      error: PersistenceError,
    ) {
      const recorded = yield* Effect.gen(function* () {
        yield* Effect.all(
          [
            database
              .update(syncState)
              .set({ lastAttemptAt: Date.now(), lastError: error.message })
              .where(eq(syncState.organizationId, workspace.organizationId)),
            outbox.markFailure(error.message, {
              incrementAttempts: !(
                error.cause instanceof SyncTransportError && error.cause.retryable
              ),
            }),
          ],
          { concurrency: 1, discard: true },
        );
      }).pipe(mapPersistenceError("record sync failure"), Effect.result);
      if (recorded._tag === "Failure")
        yield* Effect.logWarning("Could not persist sync failure status", recorded.failure);
      const health = yield* Effect.result(outbox.health);
      const currentHealth = health._tag === "Success" ? health.success : initialHealth;
      return {
        ...initialStatus,
        ...currentHealth,
        phase: currentHealth.quarantined ? "blocked" : "error",
        message: error.message,
      } satisfies SyncStatus;
    });

    const runtime = yield* makeSyncClientRuntime({
      initialStatus,
      adapter: {
        exchangeOnce: exchangeOnce(),
        completedStatus,
        failureStatus,
        retryable: (error) => error.cause instanceof SyncTransportError && error.cause.retryable,
        tooManyRounds: (maximumRounds) =>
          PersistenceError.make({
            operation: "sync",
            message: `Synchronization did not drain after ${maximumRounds} exchanges`,
          }),
      },
      live: session ? { events: session.events } : undefined,
      safetyPollIntervalMillis: config.resyncIntervalMillis ?? (session ? 300_000 : 3_000),
      exchangeRetryBaseMillis: config.exchangeRetryBaseMillis,
    });

    if (configured) yield* runtime.start.pipe(Effect.forkScoped);

    return {
      signal: configured ? runtime.signal("local-commit") : Effect.void,
      status: runtime.status,
      statusChanges: runtime.statusChanges,
      sync: configured ? runtime.requestSync("manual") : runtime.status,
    } satisfies SyncEngine;
  });
