import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import type { SyncRequest } from "@store/contracts";
import { durableObjectMigrations } from "@store/db/do/migrations";
import { migrate } from "drizzle-orm/effect-sqlite-do/migrator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { makeDatabase } from "./database";
import { makeSyncDrizzle } from "./database.client";
import { SyncDatabase } from "./database.service";
import { syncProgram, syncServiceLayer, type SyncActor } from "./service";

/**
 * Builds the sync runtime over one organization's Durable Object storage.
 *
 * Migrations run as part of building the database layer rather than at a
 * separate startup boundary: a Durable Object has no startup event, and the
 * object may be created on any request. `migrate` records applied migrations in
 * its own table, so repeated construction is cheap and idempotent.
 */
export const makeSyncRuntime = (storage: DurableObjectStorage) => {
  const sqliteLayer = SqliteClient.layer({ storage });
  const databaseLayer = Layer.effect(
    SyncDatabase,
    Effect.gen(function* () {
      const drizzle = yield* makeSyncDrizzle(storage);
      yield* migrate(drizzle, { migrations: durableObjectMigrations });
      return makeDatabase(drizzle);
    }),
  ).pipe(Layer.provide(sqliteLayer));
  const runtime = ManagedRuntime.make(syncServiceLayer.pipe(Layer.provide(databaseLayer)));

  return {
    runSync: (actor: SyncActor, request: SyncRequest) =>
      runtime.runPromise(syncProgram(actor, request)),
    dispose: () => runtime.dispose(),
  };
};
