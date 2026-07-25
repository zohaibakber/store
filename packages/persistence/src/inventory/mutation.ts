import { orderSyncEntityChanges, type SyncEntityChange } from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { MutationContext } from "../config";
import type { StoreDatabase, StoreTransaction } from "../database/client";
import { PersistenceError, persistenceError } from "../errors";
import { enqueueOperation } from "../sync/outbox";

export class MutationIds extends Context.Service<
  MutationIds,
  { readonly next: Effect.Effect<string> }
>()("@store/persistence/MutationIds") {
  static readonly live = Layer.succeed(
    MutationIds,
    MutationIds.of({ next: Effect.sync(() => crypto.randomUUID()) }),
  );
}

export interface InventoryMutationScope {
  readonly organizationId: string;
  readonly occurredAt: number;
  readonly operationId: string;
  readonly nextId: Effect.Effect<string>;
  readonly reserve: (changeCount: number) => Effect.Effect<void, PersistenceError>;
  readonly capture: (
    changes: SyncEntityChange | ReadonlyArray<SyncEntityChange>,
  ) => Effect.Effect<void, PersistenceError>;
  readonly createVersioned: (id: string) => {
    readonly id: string;
    readonly organizationId: string;
    readonly createdByUserId: string;
    readonly updatedByUserId: string;
    readonly deviceId: string;
    readonly operationId: string;
    readonly rowVersion: 1;
    readonly createdAt: number;
    readonly updatedAt: number;
  };
  readonly updateVersioned: (rowVersion: number) => {
    readonly updatedByUserId: string;
    readonly deviceId: string;
    readonly operationId: string;
    readonly rowVersion: number;
    readonly updatedAt: number;
  };
  readonly createMovement: (id: string) => {
    readonly id: string;
    readonly organizationId: string;
    readonly actorUserId: string;
    readonly deviceId: string;
    readonly operationId: string;
    readonly createdAt: number;
  };
}

export interface InventoryMutation {
  readonly run: <A, E, R>(
    operation: string,
    write: (transaction: StoreTransaction, scope: InventoryMutationScope) => Effect.Effect<A, E, R>,
    options?: { readonly maxChangesPerOperation?: number },
  ) => Effect.Effect<A, E | PersistenceError, R>;
}

interface PendingOperation {
  readonly operationId: string;
  readonly changes: SyncEntityChange[];
}

export const makeInventoryMutation = (
  database: StoreDatabase,
  mutationContext: () => MutationContext,
  signalSync: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const ids = yield* MutationIds;

    const run: InventoryMutation["run"] = (operation, write, options) =>
      Effect.gen(function* () {
        const actor = mutationContext();
        const occurredAt = yield* Clock.currentTimeMillis;
        const maxChanges = options?.maxChangesPerOperation ?? Number.MAX_SAFE_INTEGER;
        let current: PendingOperation = { operationId: yield* ids.next, changes: [] };
        const operations: PendingOperation[] = [current];

        const reserve = Effect.fn("InventoryMutation.reserve")(function* (changeCount: number) {
          if (!Number.isSafeInteger(changeCount) || changeCount < 0 || changeCount > maxChanges)
            return yield* PersistenceError.make({
              operation,
              message: `A mutation group cannot contain ${changeCount} changes`,
            });
          if (current.changes.length > 0 && current.changes.length + changeCount > maxChanges) {
            current = { operationId: yield* ids.next, changes: [] };
            operations.push(current);
          }
        });

        const capture = Effect.fn("InventoryMutation.capture")(function* (
          captured: SyncEntityChange | ReadonlyArray<SyncEntityChange>,
        ) {
          const changes = Array.isArray(captured) ? captured : [captured];
          if (current.changes.length + changes.length > maxChanges)
            return yield* PersistenceError.make({
              operation,
              message: `A mutation group exceeds the supported maximum of ${maxChanges} changes`,
            });
          current.changes.push(...changes);
        });

        const scope: InventoryMutationScope = {
          organizationId: actor.organizationId,
          occurredAt,
          get operationId() {
            return current.operationId;
          },
          nextId: ids.next,
          reserve,
          capture,
          createVersioned: (id) => ({
            id,
            organizationId: actor.organizationId,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
            deviceId: actor.deviceId,
            operationId: current.operationId,
            rowVersion: 1,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          }),
          updateVersioned: (rowVersion) => ({
            updatedByUserId: actor.userId,
            deviceId: actor.deviceId,
            operationId: current.operationId,
            rowVersion,
            updatedAt: occurredAt,
          }),
          createMovement: (id) => ({
            id,
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            deviceId: actor.deviceId,
            operationId: current.operationId,
            createdAt: occurredAt,
          }),
        };

        const committed = yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const value = yield* write(transaction, scope);
              const queued = operations.filter((pending) => pending.changes.length > 0);
              for (const pending of queued)
                yield* enqueueOperation(
                  transaction,
                  actor,
                  pending.operationId,
                  occurredAt,
                  orderSyncEntityChanges(pending.changes),
                );
              return { value, changed: queued.length > 0 };
            }),
          )
          .pipe(
            Effect.catchTag("SqlError", (cause) => Effect.fail(persistenceError(operation, cause))),
          );
        if (committed.changed) yield* signalSync;
        return committed.value;
      }).pipe(Effect.withSpan("InventoryMutation.run"));

    return { run } satisfies InventoryMutation;
  });
