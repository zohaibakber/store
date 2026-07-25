import type { SyncEntityChange, SyncOperation } from "@store/contracts";
import { syncOutbox } from "@store/db/local/schema";
import { and, eq, sql } from "drizzle-orm";
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
    // Postgres allocated this from a `bigserial`. SQLite's AUTOINCREMENT only
    // applies to an INTEGER PRIMARY KEY, which `operationId` already occupies,
    // so the sequence is allocated here instead. This is safe because the whole
    // enqueue runs inside the caller's transaction and SQLite admits one writer
    // at a time; the unique index on (organizationId, deviceId, clientSequence)
    // is the backstop if that ever stops being true.
    const [highest] = yield* transaction
      .select({ last: sql<number | null>`max(${syncOutbox.clientSequence})` })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.organizationId, actor.organizationId),
          eq(syncOutbox.deviceId, actor.deviceId),
        ),
      );
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
