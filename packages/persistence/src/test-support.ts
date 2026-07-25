import path from "node:path";

import * as LibsqlClient from "@effect/sql-libsql/LibsqlClient";
import { syncOutbox } from "@store/db/local/schema";
import { asc } from "drizzle-orm";
import * as LibsqlDrizzle from "drizzle-orm/effect-libsql";
import * as Effect from "effect/Effect";

import { databaseFile } from "./database";
import { OfflineStore } from "./service";

type OfflineStoreShape = Effect.Success<typeof OfflineStore>;

export const store = <A, E>(f: (store: OfflineStoreShape) => Effect.Effect<A, E>) =>
  Effect.flatMap(OfflineStore, f);

export const migrationsFolder = path.resolve(import.meta.dirname, "../../db/migrations/local");
export const durableObjectMigrationsFolder = path.resolve(
  import.meta.dirname,
  "../../db/migrations/do",
);
export const authMigrationsFolder = path.resolve(import.meta.dirname, "../../db/migrations/auth");

/** Opens the store database a second time, read-only, to assert on outbox state. */
export const readOutbox = (dataDir: string) =>
  Effect.gen(function* () {
    const database = yield* LibsqlDrizzle.makeWithDefaults();
    return yield* database.select().from(syncOutbox).orderBy(asc(syncOutbox.clientSequence));
  }).pipe(
    Effect.provide(LibsqlClient.layer({ url: `file:${databaseFile(dataDir)}`, intMode: "number" })),
    Effect.runPromise,
  );
