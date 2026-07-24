import type { SyncEntityChange, SyncOperation } from "@store/contracts";
import { syncOutbox } from "@store/db/local/schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { MutationContext } from "./config";
import type { StoreTransaction } from "./database";
import { PersistenceError } from "./errors";
import { operationPayloadHash } from "./hash";

export const enqueueOperation = (
  transaction: StoreTransaction,
  actor: MutationContext,
  operationId: string,
  occurredAt: number,
  changes: ReadonlyArray<SyncEntityChange>,
) =>
  Effect.gen(function* () {
    const [queued] = yield* transaction
      .insert(syncOutbox)
      .values({
        operationId,
        organizationId: actor.organizationId,
        deviceId: actor.deviceId,
        actorUserId: actor.userId,
        occurredAt,
        payload: changes,
        payloadHash: "",
      })
      .returning({ clientSequence: syncOutbox.clientSequence });
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
      .where(eq(syncOutbox.operationId, operationId));
  });
