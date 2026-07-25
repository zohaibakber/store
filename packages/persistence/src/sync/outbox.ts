import {
  MAX_SYNC_CHANGES_PER_OPERATION,
  MAX_SYNC_CHANGES_PER_REQUEST,
  MAX_SYNC_OPERATIONS_PER_REQUEST,
  type SyncEntityChange,
  type SyncOperation,
} from "@store/contracts";
import { operationPayloadHash } from "@store/contracts/operation-hash";
import { syncOutbox } from "@store/db/local/schema";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { MutationContext } from "../config";
import type { StoreDatabase, StoreTransaction } from "../database/client";
import { mapPersistenceError, PersistenceError } from "../errors";

export interface QueuedOperation {
  readonly operationId: string;
  readonly payload: ReadonlyArray<unknown>;
}

export type BatchSelection<T extends QueuedOperation> =
  | {
      readonly _tag: "Selected";
      readonly operations: ReadonlyArray<T>;
      readonly changeCount: number;
      readonly moreDue: boolean;
    }
  | { readonly _tag: "Unsendable"; readonly operationId: string; readonly reason: string };

export const selectBatch = <T extends QueuedOperation>(
  due: ReadonlyArray<T>,
): BatchSelection<T> => {
  const operations: T[] = [];
  let changeCount = 0;

  for (const queued of due) {
    if (operations.length >= MAX_SYNC_OPERATIONS_PER_REQUEST) break;
    if (queued.payload.length === 0)
      return {
        _tag: "Unsendable",
        operationId: queued.operationId,
        reason: `Queued operation ${queued.operationId} contains no changes`,
      };
    if (queued.payload.length > MAX_SYNC_CHANGES_PER_OPERATION)
      return {
        _tag: "Unsendable",
        operationId: queued.operationId,
        reason: `Queued operation ${queued.operationId} contains ${queued.payload.length} changes; the supported maximum is ${MAX_SYNC_CHANGES_PER_OPERATION}`,
      };
    if (operations.length > 0 && changeCount + queued.payload.length > MAX_SYNC_CHANGES_PER_REQUEST)
      break;
    operations.push(queued);
    changeCount += queued.payload.length;
  }

  return {
    _tag: "Selected",
    operations,
    changeCount,
    moreDue: due.length > operations.length,
  };
};

export type ExchangeOutcome =
  | { readonly _tag: "Drained" }
  | { readonly _tag: "MorePending"; readonly reason: "server-pages" | "held-back" };

export const exchangeOutcome = (input: {
  readonly hasMore: boolean;
  readonly moreDue: boolean;
}): ExchangeOutcome =>
  input.hasMore
    ? { _tag: "MorePending", reason: "server-pages" }
    : input.moreDue
      ? { _tag: "MorePending", reason: "held-back" }
      : { _tag: "Drained" };

export interface OutboxHealth {
  readonly pendingOperations: number;
  readonly oldestPendingAt: number | null;
  readonly lastError: string | null;
  readonly quarantined: boolean;
}

export const emptyOutboxHealth: OutboxHealth = {
  pendingOperations: 0,
  oldestPendingAt: null,
  lastError: null,
  quarantined: false,
};

const RETRY_BASE_MILLIS = 1_000;
const RETRY_CAP_MILLIS = 5 * 60 * 1_000;

export const retryDelayMillis = (attemptCount: number): number =>
  Math.min(RETRY_BASE_MILLIS * 2 ** Math.max(attemptCount - 1, 0), RETRY_CAP_MILLIS);

export const QUARANTINE_ATTEMPTS = 10;

export const enqueueOperation = Effect.fn("Outbox.enqueue")(function* (
  transaction: StoreTransaction,
  actor: MutationContext,
  operationId: string,
  occurredAt: number,
  changes: ReadonlyArray<SyncEntityChange>,
): Effect.fn.Return<void, PersistenceError> {
  const [highest] = yield* transaction
    .select({ last: sql<number | null>`max(${syncOutbox.clientSequence})` })
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.organizationId, actor.organizationId),
        eq(syncOutbox.deviceId, actor.deviceId),
      ),
    )
    .pipe(mapPersistenceError("read outbox sequence"));
  const clientSequence = (highest?.last ?? 0) + 1;

  const [queued] = yield* transaction
    .insert(syncOutbox)
    .values({
      operationId,
      organizationId: actor.organizationId,
      deviceId: actor.deviceId,
      actorUserId: actor.userId,
      clientSequence,
      occurredAt,
      payload: changes,
      payloadHash: "",
    })
    .returning({ clientSequence: syncOutbox.clientSequence })
    .pipe(mapPersistenceError("enqueue sync operation"));
  if (!queued)
    return yield* PersistenceError.make({
      operation: "enqueue sync operation",
      message: "The sync operation could not be queued",
    });
  const unhashed = {
    operationId,
    organizationId: actor.organizationId,
    deviceId: actor.deviceId,
    actorUserId: actor.userId,
    clientSequence: queued.clientSequence,
    occurredAt,
    changes,
  } satisfies Omit<SyncOperation, "payloadHash">;
  yield* transaction
    .update(syncOutbox)
    .set({ payloadHash: operationPayloadHash(unhashed) })
    .where(eq(syncOutbox.operationId, operationId))
    .pipe(mapPersistenceError("hash sync operation"));
});

export const makeOutbox = (database: StoreDatabase, mutationContext: () => MutationContext) => {
  const health = Effect.fn("Outbox.health")(function* () {
    const actor = mutationContext();
    const [row] = yield* database
      .select({
        pendingOperations: sql<number>`count(*)`,
        oldestPendingAt: sql<number | null>`min(${syncOutbox.occurredAt})`,
        lastError: sql<string | null>`(
          select ${syncOutbox.lastError} from ${syncOutbox}
          where ${syncOutbox.organizationId} = ${actor.organizationId}
            and ${syncOutbox.acknowledgedAt} is null
            and ${syncOutbox.lastError} is not null
          order by ${syncOutbox.clientSequence} desc
          limit 1
        )`,
        quarantined: sql<number>`coalesce(max(${syncOutbox.attemptCount}), 0) >= ${QUARANTINE_ATTEMPTS}`,
      })
      .from(syncOutbox)
      .where(
        and(eq(syncOutbox.organizationId, actor.organizationId), isNull(syncOutbox.acknowledgedAt)),
      )
      .pipe(mapPersistenceError("read outbox health"));
    return row === undefined
      ? emptyOutboxHealth
      : {
          pendingOperations: row.pendingOperations,
          oldestPendingAt: row.oldestPendingAt,
          lastError: row.lastError,
          quarantined: row.quarantined === 1,
        };
  });

  const nextBatch = Effect.fn("Outbox.nextBatch")(function* () {
    const actor = mutationContext();
    const pending = yield* database
      .select()
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.organizationId, actor.organizationId),
          isNull(syncOutbox.acknowledgedAt),
          or(isNull(syncOutbox.nextAttemptAt), lte(syncOutbox.nextAttemptAt, Date.now())),
        ),
      )
      .orderBy(asc(syncOutbox.clientSequence))
      .limit(MAX_SYNC_OPERATIONS_PER_REQUEST + 1)
      .pipe(mapPersistenceError("load pending sync operations"));
    return selectBatch(pending);
  });

  const markAttempt = Effect.fn("Outbox.markAttempt")(function* (
    operationIds: ReadonlyArray<string>,
  ) {
    if (operationIds.length === 0) return;
    const actor = mutationContext();
    yield* database
      .update(syncOutbox)
      .set({ attemptCount: sql`${syncOutbox.attemptCount} + 1`, lastError: null })
      .where(
        and(
          eq(syncOutbox.organizationId, actor.organizationId),
          inArray(syncOutbox.operationId, operationIds),
          isNull(syncOutbox.acknowledgedAt),
        ),
      )
      .pipe(mapPersistenceError("record outbox attempt"));
  });

  const acknowledge = Effect.fn("Outbox.acknowledge")(function* (
    transaction: StoreTransaction,
    operationIds: ReadonlyArray<string>,
    completedAt: number,
  ) {
    if (operationIds.length === 0) return;
    const actor = mutationContext();
    yield* transaction
      .update(syncOutbox)
      .set({ acknowledgedAt: completedAt, lastError: null, nextAttemptAt: null })
      .where(
        and(
          eq(syncOutbox.organizationId, actor.organizationId),
          inArray(syncOutbox.operationId, operationIds),
        ),
      );
  });

  const markFailure = Effect.fn("Outbox.markFailure")(function* (message: string) {
    const actor = mutationContext();
    const [head] = yield* database
      .select({ attemptCount: syncOutbox.attemptCount })
      .from(syncOutbox)
      .where(
        and(eq(syncOutbox.organizationId, actor.organizationId), isNull(syncOutbox.acknowledgedAt)),
      )
      .orderBy(asc(syncOutbox.clientSequence))
      .limit(1)
      .pipe(mapPersistenceError("read outbox head for backoff"));
    const nextAttemptAt =
      head === undefined ? null : Date.now() + retryDelayMillis(head.attemptCount);
    yield* database
      .update(syncOutbox)
      .set({ lastError: message, nextAttemptAt })
      .where(
        and(eq(syncOutbox.organizationId, actor.organizationId), isNull(syncOutbox.acknowledgedAt)),
      )
      .pipe(mapPersistenceError("record outbox failure"));
  });

  return { health: health(), nextBatch: nextBatch(), markAttempt, acknowledge, markFailure };
};
