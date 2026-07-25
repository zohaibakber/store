import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as LibsqlClient from "@effect/sql-libsql/LibsqlClient";
import { syncOutbox } from "@store/db/local/schema";
import { asc } from "drizzle-orm";
import * as LibsqlDrizzle from "drizzle-orm/effect-libsql";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { databaseFile } from "../../src/database/client";
import type { PersistenceConfig } from "../../src/index";
import { layer, OfflineStore } from "../../src/service";

type OfflineStoreShape = Effect.Success<typeof OfflineStore>;

export const store = <A, E>(f: (store: OfflineStoreShape) => Effect.Effect<A, E>) =>
  Effect.flatMap(OfflineStore, f);

export const migrationsFolder = path.resolve(import.meta.dirname, "../../../db/migrations/local");
export const durableObjectMigrationsFolder = path.resolve(
  import.meta.dirname,
  "../../../db/migrations/do",
);
export const authMigrationsFolder = path.resolve(
  import.meta.dirname,
  "../../../db/migrations/auth",
);

type TestStoreConfig = Partial<Omit<PersistenceConfig, "dataDir" | "migrationsFolder">>;

const makeStoreRuntime = (dataDir: string, config: TestStoreConfig = {}) =>
  ManagedRuntime.make(layer({ dataDir, migrationsFolder, ...config }));

export type TestStoreRuntime = ReturnType<typeof makeStoreRuntime>;

export interface TestStoreFixture {
  readonly dataDir: string;
  readonly runtime: TestStoreRuntime;
  readonly makeRuntime: (config?: TestStoreConfig) => TestStoreRuntime;
}

export const withTestStore = <A>(
  use: (fixture: TestStoreFixture) => Promise<A>,
  config: TestStoreConfig = {},
): Promise<A> =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), "store-persistence-"))),
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    );
    const dataDir = path.join(directory, "data");
    const runtimes: TestStoreRuntime[] = [];
    const makeRuntime = (overrides: TestStoreConfig = {}) => {
      const runtime = makeStoreRuntime(dataDir, { ...config, ...overrides });
      runtimes.push(runtime);
      return runtime;
    };
    const runtime = makeRuntime();
    return yield* Effect.acquireUseRelease(
      Effect.succeed({ dataDir, runtime, makeRuntime }),
      (fixture) => Effect.tryPromise(() => use(fixture)),
      () =>
        Effect.promise(async () => {
          for (const activeRuntime of runtimes.reverse()) await activeRuntime.dispose();
        }),
    );
  }).pipe(Effect.scoped, Effect.runPromise);

export const readOutbox = (dataDir: string) =>
  Effect.gen(function* () {
    const database = yield* LibsqlDrizzle.makeWithDefaults();
    return yield* database.select().from(syncOutbox).orderBy(asc(syncOutbox.clientSequence));
  }).pipe(
    Effect.provide(LibsqlClient.layer({ url: `file:${databaseFile(dataDir)}`, intMode: "number" })),
    Effect.runPromise,
  );
