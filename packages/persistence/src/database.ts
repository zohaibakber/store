import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import { localRelations } from "@store/db/local/relations";
import { sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-pglite";
import { migrate } from "drizzle-orm/effect-pglite/migrator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { PersistenceConfig } from "./config";
import { mapPersistenceError, persistenceError } from "./errors";
import { pgliteExtensions } from "./pglite-extensions";
import { upgradePgliteDataDir } from "./pglite-upgrade";

export type StoreDatabase = PgDrizzle.EffectPgDatabase<typeof localRelations>;
export type StoreTransaction = Parameters<Parameters<StoreDatabase["transaction"]>[0]>[0];

export const makeDatabase = (migrationsFolder: string) =>
  Effect.gen(function* () {
    const database = yield* PgDrizzle.makeWithDefaults({ relations: localRelations });
    yield* migrate(database, {
      migrationsFolder,
      migrationsSchema: "store_migrations",
      migrationsTable: "__store_drizzle_migrations",
    }).pipe(mapPersistenceError("migrate database"));
    return database;
  });

// The fuzzy-search extensions and their trigram indexes live only in PGlite.
// They remain runtime setup rather than migrations because the remote database
// does not install these extensions. The statements are safe on every startup.
export const ensureLocalSearchIndexes = (database: StoreDatabase) =>
  Effect.gen(function* () {
    yield* database.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    yield* database.execute(sql`CREATE EXTENSION IF NOT EXISTS fuzzystrmatch`);
    yield* database.execute(sql`CREATE EXTENSION IF NOT EXISTS unaccent`);
    yield* database.execute(
      sql`CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON products USING gin (name gin_trgm_ops)`,
    );
    yield* database.execute(
      sql`CREATE INDEX IF NOT EXISTS products_composition_trgm_idx ON products USING gin (composition gin_trgm_ops)`,
    );
  }).pipe(mapPersistenceError("enable local search indexes"));

const makeClientLayer = (config: PersistenceConfig) =>
  PgliteClient.layerFrom(
    PgliteClient.make({
      dataDir: config.dataDir,
      extensions: pgliteExtensions,
    }).pipe(Effect.mapError((cause) => persistenceError("open local database", cause))),
  );

export const clientLayer = (config: PersistenceConfig) =>
  Layer.unwrap(
    upgradePgliteDataDir(config.dataDir).pipe(Effect.map(() => makeClientLayer(config))),
  );
