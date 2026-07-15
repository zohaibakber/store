import { SyncResponse, SyncServerChange, type SyncAck, type SyncRequest } from "@store/contracts";
import { syncChangeLog } from "@store/db/remote/schema";
import { and, asc, eq, gt } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ConstraintError, SqlError, UniqueViolation } from "effect/unstable/sql/SqlError";
import { makeSyncDrizzle, type SyncDrizzle } from "./database.client";
import { SyncDatabase } from "./database.service";
import { SyncDatabaseError, SyncProtocolError } from "./errors";
import type { SyncActor } from "./model";
import { applyOperation } from "./operation";

const PAGE_SIZE = 500;

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const constraintProtocolError = (cause: unknown) => {
  if (!(cause instanceof EffectDrizzleQueryError) || !(cause.cause instanceof SqlError))
    return undefined;
  if (cause.cause.reason instanceof UniqueViolation)
    return SyncProtocolError.make({
      code: "ENTITY_CONFLICT",
      message: "A synced entity conflicts with an existing unique value.",
    });
  if (cause.cause.reason instanceof ConstraintError)
    return SyncProtocolError.make({
      code: "ENTITY_RELATION_INVALID",
      message: "A synced entity refers to a related entity that does not exist.",
    });
  return undefined;
};

const makeDatabase = (db: SyncDrizzle) => {
  const exchange = Effect.fn("SyncDatabase.exchange")(
    function* (actor: SyncActor, request: SyncRequest) {
      return yield* db.transaction((tx) =>
        Effect.gen(function* () {
          const acknowledgements: SyncAck[] = [];
          for (const operation of request.operations)
            acknowledgements.push(yield* applyOperation(tx, actor, operation));

          const pulled = yield* tx
            .select()
            .from(syncChangeLog)
            .where(
              and(
                eq(syncChangeLog.organizationId, actor.organizationId),
                gt(syncChangeLog.cursor, request.cursor),
              ),
            )
            .orderBy(asc(syncChangeLog.cursor))
            .limit(PAGE_SIZE + 1);
          const hasMore = pulled.length > PAGE_SIZE;
          const page = hasMore ? pulled.slice(0, PAGE_SIZE) : pulled;
          const changes = page.map((entry) =>
            SyncServerChange.make({
              cursor: entry.cursor,
              operationId: entry.operationId,
              changedAt: entry.changedAt,
              change: entry.payload,
            }),
          );
          return SyncResponse.make({
            organizationId: actor.organizationId,
            cursor: changes.at(-1)?.cursor ?? request.cursor,
            hasMore,
            acknowledgements,
            changes,
          });
        }),
      );
    },
    Effect.mapError((cause) =>
      cause instanceof SyncProtocolError
        ? cause
        : (constraintProtocolError(cause) ??
          SyncDatabaseError.make({ message: messageOf(cause), cause })),
    ),
  );
  return SyncDatabase.of({ exchange });
};

export const syncDatabaseLayer = Layer.effect(
  SyncDatabase,
  makeSyncDrizzle().pipe(Effect.map(makeDatabase)),
);
