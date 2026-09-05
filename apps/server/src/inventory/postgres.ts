import * as PgClient from "@effect/sql-pg/PgClient";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import { ConstraintError, SqlError, UniqueViolation } from "effect/unstable/sql/SqlError";

import {
  InventoryDatabaseError,
  InventoryProtocolError,
  inventoryProtocolError as protocolError,
} from "./errors";

export const makePostgresDrizzle = (client: PgClient.PgClient) =>
  PgDrizzle.makeWithDefaults().pipe(Effect.provideService(PgClient.PgClient, client));

export type PostgresDrizzle = Effect.Success<ReturnType<typeof makePostgresDrizzle>>;
export type PostgresTransaction = Parameters<Parameters<PostgresDrizzle["transaction"]>[0]>[0];

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const databaseError = (cause: unknown) => {
  if (cause instanceof InventoryProtocolError || cause instanceof InventoryDatabaseError)
    return cause;
  if (cause instanceof EffectDrizzleQueryError && cause.cause instanceof SqlError) {
    if (cause.cause.reason instanceof UniqueViolation)
      return protocolError("ENTITY_CONFLICT", "This entity conflicts with an existing value.");
    if (cause.cause.reason instanceof ConstraintError)
      return protocolError(
        "ENTITY_RELATION_INVALID",
        "This entity refers to a related entity that does not exist.",
      );
  }
  return InventoryDatabaseError.make({ message: messageOf(cause), cause });
};

export const catalogReadError = (cause: unknown) =>
  cause instanceof InventoryDatabaseError
    ? cause
    : InventoryDatabaseError.make({ message: messageOf(cause), cause });
