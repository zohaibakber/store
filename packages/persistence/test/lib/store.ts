import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as LibsqlClient from "@effect/sql-libsql/LibsqlClient";
import { syncOutbox } from "@store/db/local/schema";
import { asc } from "drizzle-orm";
import * as LibsqlDrizzle from "drizzle-orm/effect-libsql";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { databaseFile } from "../../src/database/node-client";
import type { PersistenceConfig } from "../../src/index";
import { layer, OfflineStore } from "../../src/index";

type OfflineStoreService = Effect.Success<typeof OfflineStore>;

export const store = <A, E>(f: (store: OfflineStoreService) => Effect.Effect<A, E>) =>
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

type TestStoreConfig = Partial<Omit<PersistenceConfig, "dataDir">>;

/**
 * A workspace starts with no categories. They are the shop's own, nothing is
 * seeded, so the fixture creates the one most tests write their products into,
 * as its own sync operation. Pass `categories` for a different set, or `[]` for
 * a genuinely empty workspace.
 */
const DEFAULT_TEST_CATEGORIES = ["General"];

const makeStoreRuntime = (dataDir: string, config: TestStoreConfig = {}) =>
  // Retry backoff is collapsed by default so failure paths do not spend
  // seconds on a real clock; a test can still opt back in via `config`.
  ManagedRuntime.make(layer({ dataDir, migrationsFolder, exchangeRetryBaseMillis: 1, ...config }));

export type TestStoreRuntime = ReturnType<typeof makeStoreRuntime>;

export interface TestStoreFixture {
  readonly dataDir: string;
  readonly runtime: TestStoreRuntime;
  readonly makeRuntime: (config?: TestStoreConfig) => TestStoreRuntime;
}

export const withTestStore = <A>(
  use: (fixture: TestStoreFixture) => Promise<A>,
  config: TestStoreConfig & { readonly categories?: ReadonlyArray<string> } = {},
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
    const categoryNames = config.categories ?? DEFAULT_TEST_CATEGORIES;
    return yield* Effect.acquireUseRelease(
      Effect.succeed({ dataDir, runtime, makeRuntime }),
      (fixture) =>
        Effect.tryPromise(async () => {
          if (categoryNames.length > 0) await seedCategories(fixture.runtime, ...categoryNames);
          return use(fixture);
        }),
      () =>
        Effect.promise(async () => {
          for (const activeRuntime of runtimes.reverse()) await activeRuntime.dispose();
        }),
    );
  }).pipe(Effect.scoped, Effect.runPromise);

/**
 * A fresh workspace has no categories. They are the shop's own, so a test
 * creates the ones it needs the way the app does. Names slug into the ids the
 * tests use: "Medicine" becomes `medicine`.
 */
export const seedCategories = (runtime: TestStoreRuntime, ...names: ReadonlyArray<string>) =>
  runtime.runPromise(
    store((offlineStore) => Effect.forEach(names, (name) => offlineStore.createCategory({ name }))),
  );

export const readOutbox = (dataDir: string) =>
  Effect.gen(function* () {
    const database = yield* LibsqlDrizzle.makeWithDefaults();
    return yield* database.select().from(syncOutbox).orderBy(asc(syncOutbox.clientSequence));
  }).pipe(
    Effect.provide(LibsqlClient.layer({ url: `file:${databaseFile(dataDir)}`, intMode: "number" })),
    Effect.runPromise,
  );
