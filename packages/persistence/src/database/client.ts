import { mkdirSync } from "node:fs";
import path from "node:path";

import * as LibsqlClient from "@effect/sql-libsql/LibsqlClient";
import { localRelations } from "@store/db/local/relations";
import * as LibsqlDrizzle from "drizzle-orm/effect-libsql";
import { migrate } from "drizzle-orm/effect-libsql/migrator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { PersistenceConfig } from "../config";
import { mapPersistenceError } from "../errors";

export type StoreDatabase = LibsqlDrizzle.EffectLibsqlDatabase<typeof localRelations>;
export type StoreTransaction = Parameters<Parameters<StoreDatabase["transaction"]>[0]>[0];

export const databaseFile = (dataDir: string) => path.join(dataDir, "store.db");

export const makeDatabase = (migrationsFolder: string) =>
  Effect.gen(function* () {
    const database = yield* LibsqlDrizzle.makeWithDefaults({ relations: localRelations });
    yield* migrate(database, {
      migrationsFolder,
      migrationsTable: "__store_drizzle_migrations",
    }).pipe(mapPersistenceError("migrate database"));
    return database;
  });

export const clientLayer = (config: PersistenceConfig) =>
  Layer.unwrap(
    Effect.sync(() => {
      mkdirSync(config.dataDir, { recursive: true });
      return libsqlLayer(config);
    }),
  );

const libsqlLayer = (config: PersistenceConfig) =>
  LibsqlClient.layer({
    url: `file:${databaseFile(config.dataDir)}`,
    intMode: "number",
  });
