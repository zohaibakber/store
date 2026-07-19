import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import { syncOutbox } from "@store/db/local/schema";
import path from "node:path";
import { asc } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-pglite";
import * as Effect from "effect/Effect";
import { OfflineStore } from "./service";

type OfflineStoreShape = Effect.Success<typeof OfflineStore>;

export const store = <A, E>(f: (store: OfflineStoreShape) => Effect.Effect<A, E>) =>
  Effect.flatMap(OfflineStore, f);

export const migrationsFolder = path.resolve(import.meta.dirname, "../../db/migrations/local");
export const remoteMigrationsFolder = path.resolve(
  import.meta.dirname,
  "../../db/migrations/remote",
);

export const readOutbox = (dataDir: string) =>
  Effect.gen(function* () {
    const database = yield* PgDrizzle.makeWithDefaults();
    return yield* database.select().from(syncOutbox).orderBy(asc(syncOutbox.clientSequence));
  }).pipe(Effect.provide(PgliteClient.layer({ dataDir })), Effect.runPromise);
