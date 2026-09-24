import { SyncProtocolError, syncProtocolError, unpadDecimalSequence } from "@store/contracts";
import { InventoryHyperdrive } from "@store/db/postgres/infra";
import { inventoryState, replicas } from "@store/db/postgres/schema";
import * as Cloudflare from "alchemy/Cloudflare";
import * as DrizzlePostgres from "alchemy/Drizzle/Postgres";
import { and, eq } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlError from "effect/unstable/sql/SqlError";

import { InventoryDatabaseError } from "./errors";

export type InventoryDrizzle = EffectPgDatabase;
export type InventoryTransaction = Parameters<Parameters<InventoryDrizzle["transaction"]>[0]>[0];

export const isProtocolError = Schema.is(SyncProtocolError);

export const protocol = (code: SyncProtocolError["code"], message: string) =>
  Effect.fail(syncProtocolError(code, message));

export const databaseError = (cause: unknown) =>
  InventoryDatabaseError.make({
    message: cause instanceof Error ? cause.message : "Inventory command failed.",
    cause,
  });

export const integerTextFromNumeric = (value: string) =>
  unpadDecimalSequence(value.split(".", 1)[0] ?? value);

export const randomHex = (byteCount: number): string =>
  Encoding.encodeHex(crypto.getRandomValues(new Uint8Array(byteCount)));

const selectState = (tx: InventoryTransaction, organizationId: string) =>
  tx.select().from(inventoryState).where(eq(inventoryState.organizationId, organizationId));

type InventoryStateRow = typeof inventoryState.$inferSelect;

const requireReady = (state: InventoryStateRow | undefined) =>
  state && state.status === "ready" && state.releaseId !== null
    ? Effect.succeed(state)
    : protocol("EPOCH_MISMATCH", "This organization inventory is not ready.");

export const readReadyState = Effect.fn("InventoryPostgres.readReadyState")(function* (
  tx: InventoryTransaction,
  organizationId: string,
) {
  const [state] = yield* selectState(tx, organizationId).limit(1);
  return yield* requireReady(state);
});

export const lockOrganization = Effect.fn("InventoryPostgres.lockOrganization")(function* (
  tx: InventoryTransaction,
  organizationId: string,
) {
  const [state] = yield* selectState(tx, organizationId).for("update").limit(1);
  return yield* requireReady(state);
});

export const readReplica = Effect.fn("InventoryPostgres.readReplica")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  replicaId: string,
) {
  const [replica] = yield* tx
    .select()
    .from(replicas)
    .where(and(eq(replicas.organizationId, organizationId), eq(replicas.replicaId, replicaId)))
    .limit(1);
  return replica;
});

const MAX_SERIALIZATION_RETRIES = 4;

const sqlErrorOf = <E>(error: E): SqlError.SqlError | undefined => {
  if (SqlError.isSqlError(error)) return error;
  if (
    !Predicate.isTagged(error, "EffectDrizzleQueryError") ||
    !Predicate.hasProperty(error, "cause") ||
    !Cause.isCause(error.cause)
  ) {
    return undefined;
  }
  const failure = Cause.findErrorOption(error.cause);
  return Option.isSome(failure) && SqlError.isSqlError(failure.value) ? failure.value : undefined;
};

const isSerializationFailure = <E>(error: E): boolean => {
  const reason = sqlErrorOf(error)?.reason._tag;
  return reason === "SerializationError" || reason === "DeadlockError";
};

export const withSerializationRetry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.retry(effect, {
    schedule: Schedule.jittered(Schedule.exponential("10 millis", 2)),
    times: MAX_SERIALIZATION_RETRIES,
    while: isSerializationFailure,
  });

export const runTransaction =
  (db: InventoryDrizzle) =>
  <A, E>(
    isolationLevel: "read committed" | "repeatable read",
    accessMode: "read write" | "read only",
    body: (tx: InventoryTransaction) => Effect.Effect<A, E>,
  ) =>
    withSerializationRetry(db.transaction(body, { isolationLevel, accessMode })).pipe(
      Effect.mapError((cause) =>
        isProtocolError(cause) || cause instanceof InventoryDatabaseError
          ? cause
          : databaseError(cause),
      ),
    );

export const openInventoryDrizzle = Effect.gen(function* () {
  const inventoryHyperdrive = yield* InventoryHyperdrive;
  const hyperdrive = yield* Cloudflare.Hyperdrive.Connect(inventoryHyperdrive);
  return yield* DrizzlePostgres.Postgres(hyperdrive.connectionString).pipe(Effect.orDie);
});

export const inventoryPostgresUnavailable = InventoryDatabaseError.make({
  message: "Inventory Postgres is not provisioned for this stage.",
});
