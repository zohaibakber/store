import * as LibsqlClient from "@effect/sql-libsql/LibsqlClient";
import { localRelations } from "@store/db/local/relations";
import * as LibsqlDrizzle from "drizzle-orm/effect-libsql";
import * as Effect from "effect/Effect";

import type { PersistenceConfig } from "../config";
import { mapPersistenceError } from "../errors";

export type StoreDatabase = LibsqlDrizzle.EffectLibsqlDatabase<typeof localRelations>;
export type StoreTransaction = Parameters<Parameters<StoreDatabase["transaction"]>[0]>[0];

export const MIGRATIONS_TABLE = "__store_drizzle_migrations";

export const libsqlLayer = (url: string) =>
  LibsqlClient.layer({
    url,
    intMode: "number",
  });

export const makeDatabase = (config: PersistenceConfig) =>
  Effect.gen(function* () {
    const database = yield* LibsqlDrizzle.makeWithDefaults({ relations: localRelations });
    if (config.bundledMigrations)
      yield* applyBundledMigrations(config.bundledMigrations).pipe(
        mapPersistenceError("migrate database"),
      );
    else if (config.applySchema) yield* config.applySchema(database);
    else return yield* PersistenceConfigError();
    return database;
  });

const PersistenceConfigError = () =>
  Effect.fail(new Error("Persistence requires either migrationsFolder or bundledMigrations.")).pipe(
    mapPersistenceError("migrate database"),
  );

/**
 * Applies inlined drizzle SQL the same way Durable Object migrations are
 * applied: statement-breakpoint splits, recorded by folder name in the drizzle
 * migrations table. Used by the browser replica, which has no filesystem.
 */
export const applyBundledMigrations = (migrations: Record<string, string>) =>
  Effect.gen(function* () {
    const sql = yield* LibsqlClient.LibsqlClient;
    yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )`);
    const applied = yield* sql.unsafe<{ hash: string }>(`SELECT hash FROM "${MIGRATIONS_TABLE}"`);
    const hashes = new Set(
      (Array.isArray(applied) ? applied : []).map((row) =>
        typeof row === "object" && row !== null && "hash" in row ? String(row.hash) : "",
      ),
    );
    for (const [name, body] of Object.entries(migrations).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (hashes.has(name)) continue;
      for (const statement of body.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed) yield* sql.unsafe(trimmed);
      }
      yield* sql.unsafe(`INSERT INTO "${MIGRATIONS_TABLE}" (hash, created_at) VALUES (?, ?)`, [
        name,
        Date.now(),
      ]);
    }
  });
