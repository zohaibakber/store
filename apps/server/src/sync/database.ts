import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import { SyncResponse, SyncServerChange, type SyncAck, type SyncRequest } from "@store/contracts";
import { durableObjectMigrations } from "@store/db/do/migrations";
import { durableObjectRelations } from "@store/db/do/relations";
import { syncChangeLog, syncDevices } from "@store/db/do/schema";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as DoDrizzle from "drizzle-orm/effect-sqlite-do";
import { migrate } from "drizzle-orm/effect-sqlite-do/migrator";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ConstraintError, SqlError, UniqueViolation } from "effect/unstable/sql/SqlError";

import { SyncDatabaseError, SyncProtocolError } from "./errors";
import type { SyncActor } from "./model";
import { applyOperation } from "./operation";

export const makeSyncDrizzle = (storage: DurableObjectStorage) =>
  DoDrizzle.makeWithDefaults({ relations: durableObjectRelations, storage });

export type SyncDrizzle = Effect.Success<ReturnType<typeof makeSyncDrizzle>>;
export type SyncTransaction = Parameters<Parameters<SyncDrizzle["transaction"]>[0]>[0];

export class SyncDatabase extends Context.Service<
  SyncDatabase,
  {
    readonly exchange: (
      actor: SyncActor,
      request: SyncRequest,
    ) => Effect.Effect<SyncResponse, SyncDatabaseError | SyncProtocolError>;
    readonly headCursor: (organizationId: string) => Effect.Effect<number, SyncDatabaseError>;
  }
>()("@store/server/SyncDatabase") {}

const PAGE_SIZE = 500;
const PAGE_BYTES = 512 * 1024;
type SyncDatabaseClient = Pick<SyncDrizzle, "transaction">;

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

export const makeDatabase = (db: SyncDatabaseClient) => {
  const exchange = Effect.fn("SyncDatabase.exchange")(
    function* (actor: SyncActor, request: SyncRequest) {
      return yield* db.transaction((tx) =>
        Effect.gen(function* () {
          const acknowledgements: SyncAck[] = [];
          for (const operation of request.operations)
            acknowledgements.push(yield* applyOperation(tx, actor, operation));

          yield* tx
            .insert(syncDevices)
            .values({
              organizationId: actor.organizationId,
              deviceId: request.deviceId,
              userId: actor.userId,
              protocolVersion: request.protocolVersion ?? 1,
              lastAppliedCursor: request.cursor,
              lastSeenAt: Date.now(),
              clientPlatform: request.clientPlatform ?? "unknown",
              clientVersion: request.clientVersion ?? "unknown",
            })
            .onConflictDoUpdate({
              target: [syncDevices.organizationId, syncDevices.deviceId],
              set: {
                userId: actor.userId,
                protocolVersion: request.protocolVersion ?? 1,
                lastAppliedCursor: request.cursor,
                lastSeenAt: Date.now(),
                clientPlatform: request.clientPlatform ?? "unknown",
                clientVersion: request.clientVersion ?? "unknown",
              },
            });

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
          const candidates = pulled.slice(0, PAGE_SIZE);
          const page: Array<(typeof candidates)[number]> = [];
          let responseBytes = 0;
          for (const entry of candidates) {
            const entryBytes = new TextEncoder().encode(JSON.stringify(entry.payload)).byteLength;
            if (page.length > 0 && responseBytes + entryBytes > PAGE_BYTES) break;
            page.push(entry);
            responseBytes += entryBytes;
          }
          const changes = page.map((entry) =>
            SyncServerChange.make({
              cursor: entry.cursor,
              operationId: entry.operationId,
              changedAt: entry.changedAt,
              change: entry.payload,
            }),
          );
          const [head] = yield* tx
            .select({ cursor: sql<number>`coalesce(max(${syncChangeLog.cursor}), 0)` })
            .from(syncChangeLog)
            .where(eq(syncChangeLog.organizationId, actor.organizationId));
          const headCursor = head?.cursor ?? 0;
          const nextCursor = changes.at(-1)?.cursor ?? request.cursor;
          return SyncResponse.make({
            protocolVersion: 2,
            organizationId: actor.organizationId,
            cursor: nextCursor,
            nextCursor,
            headCursor,
            hasMore: nextCursor < headCursor,
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
  const headCursor = Effect.fn("SyncDatabase.headCursor")(
    function* (organizationId: string) {
      return yield* db.transaction((tx) =>
        tx
          .select({ cursor: sql<number>`coalesce(max(${syncChangeLog.cursor}), 0)` })
          .from(syncChangeLog)
          .where(eq(syncChangeLog.organizationId, organizationId))
          .pipe(Effect.map((rows) => rows[0]?.cursor ?? 0)),
      );
    },
    Effect.mapError((cause) => SyncDatabaseError.make({ message: messageOf(cause), cause })),
  );
  return SyncDatabase.of({ exchange, headCursor });
};

export const syncDatabaseLayer = (storage: DurableObjectStorage) =>
  Layer.effect(
    SyncDatabase,
    Effect.gen(function* () {
      const drizzle = yield* makeSyncDrizzle(storage);
      yield* migrate(drizzle, { migrations: durableObjectMigrations });
      return makeDatabase(drizzle);
    }),
  ).pipe(Layer.provide(SqliteClient.layer({ storage })));
