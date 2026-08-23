import "@electric-sql/client/react-native";
import {
  type BatchRow,
  type CategoryRow,
  type ProductRow,
  createInventoryCollectionConfigs,
  INVENTORY_REPLICA_SCHEMA_VERSION,
  inventoryReplicaDatabaseName,
  inventoryReplicaScope,
  submitCatalogRows,
} from "@store/client-db";
import {
  electricCollectionOptions,
  type ElectricCollectionUtils,
} from "@tanstack/electric-db-collection";
import {
  createExpoSQLitePersistence,
  persistedCollectionOptions,
  type ExpoSQLiteDatabaseLike,
} from "@tanstack/expo-db-sqlite-persistence";
import { createCollection } from "@tanstack/react-db";
import * as SQLite from "expo-sqlite";

import { apiOrigin, nativeAuthHeaders } from "@/lib/auth-client";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The third-party driver input is validated immediately below.
const isSQLiteBindValue = (value: unknown): value is SQLite.SQLiteBindValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  value instanceof Uint8Array ||
  value instanceof ArrayBuffer;

const sqliteBindParams = (
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Expo's driver supplies external parameters that are validated here.
  params: ReadonlyArray<unknown> | Record<string, unknown> | undefined,
): SQLite.SQLiteBindParams => {
  if (params === undefined) return [];
  if (Array.isArray(params)) {
    return params.map((value) => {
      if (!isSQLiteBindValue(value)) throw new TypeError("Unsupported SQLite bind value.");
      return value;
    });
  }
  const bound: Record<string, SQLite.SQLiteBindValue> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!isSQLiteBindValue(value)) throw new TypeError("Unsupported SQLite bind value.");
    bound[key] = value;
  }
  return bound;
};

const expoPersistenceDatabase = (database: SQLite.SQLiteDatabase): ExpoSQLiteDatabaseLike => ({
  execAsync: (sql) => database.execAsync(sql),
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This exactly implements the third-party persistence boundary.
  getAllAsync: <T>(sql: string, params?: ReadonlyArray<unknown> | Record<string, unknown>) =>
    database.getAllAsync<T>(sql, sqliteBindParams(params)),
  runAsync: async (sql, params) => {
    const result = await database.runAsync(sql, sqliteBindParams(params));
    return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
  },
  withExclusiveTransactionAsync: async <T>(
    task: (transaction: ExpoSQLiteDatabaseLike) => Promise<T>,
  ) => {
    let outcome: Promise<T> | undefined;
    await database.withExclusiveTransactionAsync(async (transaction) => {
      outcome = task(expoPersistenceDatabase(transaction));
      await outcome;
    });
    if (!outcome) throw new Error("Expo SQLite did not start the transaction.");
    return outcome;
  },
});

const authenticatedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(await nativeAuthHeaders())) {
    headers.set(name, value);
  }
  return fetch(input, { ...init, headers });
};

const persistRows = (
  entity: "category" | "product" | "batch",
  rows: ReadonlyArray<CategoryRow | ProductRow | BatchRow>,
) =>
  submitCatalogRows({
    apiBaseUrl: apiOrigin,
    authenticatedFetch,
    entity,
    rows,
  });

export type MobileInventoryCollections = ReturnType<typeof createMobileInventoryCollections>;

export const createMobileInventoryCollections = (organizationId: string) => {
  const scopeId = inventoryReplicaScope(apiOrigin, organizationId);
  const database = SQLite.openDatabaseSync(inventoryReplicaDatabaseName(scopeId));
  const persistence = createExpoSQLitePersistence({ database: expoPersistenceDatabase(database) });
  const configs = createInventoryCollectionConfigs({
    apiBaseUrl: apiOrigin,
    authenticatedFetch,
    scopeId,
  });
  const categorySync = electricCollectionOptions<CategoryRow>({
    ...configs.categories,
    onInsert: ({ transaction }) =>
      persistRows(
        "category",
        transaction.mutations.map((mutation) => mutation.modified),
      ),
    onUpdate: ({ transaction }) =>
      persistRows(
        "category",
        transaction.mutations.map((mutation) => mutation.modified),
      ),
  });
  const productSync = electricCollectionOptions<ProductRow>({
    ...configs.products,
    onInsert: ({ transaction }) =>
      persistRows(
        "product",
        transaction.mutations.map((mutation) => mutation.modified),
      ),
    onUpdate: ({ transaction }) =>
      persistRows(
        "product",
        transaction.mutations.map((mutation) => mutation.modified),
      ),
  });
  const batchSync = electricCollectionOptions<BatchRow>({
    ...configs.batches,
    onInsert: ({ transaction }) =>
      persistRows(
        "batch",
        transaction.mutations.map((mutation) => mutation.modified),
      ),
    onUpdate: ({ transaction }) =>
      persistRows(
        "batch",
        transaction.mutations.map((mutation) => mutation.modified),
      ),
  });

  const categories = createCollection(
    persistedCollectionOptions<
      CategoryRow,
      string | number,
      never,
      ElectricCollectionUtils<CategoryRow>
    >({
      ...categorySync,
      persistence,
      schemaVersion: INVENTORY_REPLICA_SCHEMA_VERSION,
    }),
  );
  const products = createCollection(
    persistedCollectionOptions<
      ProductRow,
      string | number,
      never,
      ElectricCollectionUtils<ProductRow>
    >({
      ...productSync,
      persistence,
      schemaVersion: INVENTORY_REPLICA_SCHEMA_VERSION,
    }),
  );
  const batches = createCollection(
    persistedCollectionOptions<BatchRow, string | number, never, ElectricCollectionUtils<BatchRow>>(
      {
        ...batchSync,
        persistence,
        schemaVersion: INVENTORY_REPLICA_SCHEMA_VERSION,
      },
    ),
  );

  let disposed = false;

  return {
    batches,
    categories,
    products,
    preload: async () => {
      await Promise.all([categories.preload(), products.preload(), batches.preload()]);
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await Promise.all([categories.cleanup(), products.cleanup(), batches.cleanup()]);
      await database.closeAsync();
    },
  };
};
