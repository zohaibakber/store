import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import { syncOutbox } from "@store/db/schema";
import path from "node:path";
import { asc } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-pglite";
import * as Effect from "effect/Effect";

export const migrationsFolder = path.resolve(import.meta.dirname, "../../db/migrations");

export const readOutbox = (dataDir: string) =>
  Effect.gen(function* () {
    const database = yield* PgDrizzle.makeWithDefaults();
    return yield* database.select().from(syncOutbox).orderBy(asc(syncOutbox.clientSequence));
  }).pipe(Effect.provide(PgliteClient.layer({ dataDir })), Effect.runPromise);
