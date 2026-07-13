import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import { relations } from "@store/db/relations";
import * as PgDrizzle from "drizzle-orm/effect-pglite";
import { migrate } from "drizzle-orm/effect-pglite/migrator";
import * as Effect from "effect/Effect";
import type { PersistenceConfig } from "./config";
import { mapPersistenceError, persistenceError } from "./errors";

export type StoreDatabase = PgDrizzle.EffectPgDatabase<typeof relations>;
export type StoreTransaction = Parameters<Parameters<StoreDatabase["transaction"]>[0]>[0];

export const makeDatabase = (migrationsFolder: string) =>
  Effect.gen(function* () {
    const database = yield* PgDrizzle.makeWithDefaults({ relations });
    yield* migrate(database, {
      migrationsFolder,
      migrationsSchema: "store_migrations",
      migrationsTable: "__store_drizzle_migrations",
    }).pipe(mapPersistenceError("migrate database"));
    return database;
  });

export const clientLayer = (config: PersistenceConfig) =>
  PgliteClient.layerFrom(
    PgliteClient.make({ dataDir: config.dataDir }).pipe(
      Effect.mapError((cause) => persistenceError("open local database", cause)),
    ),
  );
