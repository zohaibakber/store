import * as PgClient from "@effect/sql-pg/PgClient";
import { SyncProtocolError, syncProtocolError, unpadDecimalSequence } from "@store/contracts";
import { InventoryHyperdrive } from "@store/db/postgres/infra";
import { inventoryState } from "@store/db/postgres/schema";
import * as Cloudflare from "alchemy/Cloudflare";
import * as DrizzlePostgres from "alchemy/Drizzle/Postgres";
import { eq } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { InventoryDatabaseError } from "./errors";

export const makeInventoryDrizzle = (client: PgClient.PgClient) =>
  PgDrizzle.makeWithDefaults().pipe(Effect.provideService(PgClient.PgClient, client));

export type InventoryDrizzle = Effect.Success<ReturnType<typeof makeInventoryDrizzle>>;
export type InventoryTransaction = Parameters<Parameters<InventoryDrizzle["transaction"]>[0]>[0];

export type InventoryStateRow = {
  readonly status: "importing" | "ready";
  readonly releaseId: string | null;
};

export const isProtocolError = Schema.is(SyncProtocolError);

export const protocol = (code: SyncProtocolError["code"], message: string) =>
  Effect.fail(syncProtocolError(code, message));

export const databaseError = (cause: unknown, fallback = "Inventory command failed.") =>
  InventoryDatabaseError.make({
    message: cause instanceof Error ? cause.message : fallback,
    cause,
  });

export const integerTextFromNumeric = (value: string) =>
  unpadDecimalSequence(value.split(".", 1)[0] ?? value);

export const requireReady = (state: InventoryStateRow | undefined) => {
  if (!state || state.status !== "ready" || state.releaseId === null) {
    return protocol("EPOCH_MISMATCH", "This organization inventory is not ready.");
  }
  return Effect.void;
};

export const lockOrganization = Effect.fn("InventoryPostgres.lockOrganization")(function* (
  tx: InventoryTransaction,
  organizationId: string,
) {
  const [state] = yield* tx
    .select()
    .from(inventoryState)
    .where(eq(inventoryState.organizationId, organizationId))
    .for("update")
    .limit(1);
  yield* requireReady(state);
  if (!state) return yield* protocol("EPOCH_MISMATCH", "This organization inventory is not ready.");
  return state;
});

export const runTransaction =
  (db: InventoryDrizzle) =>
  <A, E>(
    isolationLevel: "read committed" | "repeatable read",
    accessMode: "read write" | "read only",
    body: (tx: InventoryTransaction) => Effect.Effect<A, E>,
  ) =>
    db
      .transaction(body, { isolationLevel, accessMode })
      .pipe(
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
