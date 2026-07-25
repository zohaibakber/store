import path from "node:path";

import * as LibsqlClient from "@effect/sql-libsql/LibsqlClient";
import { localRelations } from "@store/db/local/relations";
import * as LibsqlDrizzle from "drizzle-orm/effect-libsql";
import { migrate } from "drizzle-orm/effect-libsql/migrator";
import * as Effect from "effect/Effect";

import type { PersistenceConfig } from "./config";
import { mapPersistenceError } from "./errors";

export type StoreDatabase = LibsqlDrizzle.EffectLibsqlDatabase<typeof localRelations>;
export type StoreTransaction = Parameters<Parameters<StoreDatabase["transaction"]>[0]>[0];

/** The single database file inside the application's data directory. */
export const databaseFile = (dataDir: string) => path.join(dataDir, "store.db");

export const makeDatabase = (migrationsFolder: string) =>
  Effect.gen(function* () {
    const database = yield* LibsqlDrizzle.makeWithDefaults({ relations: localRelations });
    // No `migrationsSchema`: SQLite has no schema namespaces.
    yield* migrate(database, {
      migrationsFolder,
      migrationsTable: "__store_drizzle_migrations",
    }).pipe(mapPersistenceError("migrate database"));
    return database;
  });

export const clientLayer = (config: PersistenceConfig) =>
  LibsqlClient.layer({
    url: `file:${databaseFile(config.dataDir)}`,
    // `intMode: "number"` is the libSQL default and the correct choice here: the
    // schema declares integer columns as `integer({ mode: "number" })`, so
    // drizzle expects JS numbers. "bigint" would hand BigInts to those columns.
    //
    // The trade-off is that libSQL THROWS when a value exceeds
    // Number.MAX_SAFE_INTEGER rather than degrading silently. For money in paisa
    // that ceiling is ~₨90 trillion of lifetime turnover, and failing loudly is
    // strictly better than the Postgres behaviour it replaces, where a bigint
    // aggregate came back as a string and silently concatenated.
    intMode: "number",
  });
