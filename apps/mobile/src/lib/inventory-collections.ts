import type { AbstractPowerSyncDatabase } from "@powersync/common";
import { PowerSyncDatabase } from "@powersync/react-native";
import {
  type BatchRow,
  type CategoryRow,
  disconnectAndClearInventoryPowerSync,
  inventoryPowerSyncCollectionConfigs,
  inventoryPowerSyncDatabaseName,
  inventoryPowerSyncSchema,
  inventoryReplicaScope,
  makeInventoryPowerSyncConnector,
  type ProductRow,
  waitForInventoryFirstSync,
} from "@store/client-db";
import { createCollection, type Collection, type NonSingleResult } from "@tanstack/react-db";

import { apiOrigin, nativeAuthHeaders } from "@/lib/auth-client";

const authenticatedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(await nativeAuthHeaders())) {
    headers.set(name, value);
  }
  return fetch(input, { ...init, headers });
};

type InventoryCollectionConfig = ReturnType<
  typeof inventoryPowerSyncCollectionConfigs
>[keyof ReturnType<typeof inventoryPowerSyncCollectionConfigs>];
type CatalogCollection<Row extends object> = Collection<Row, string> & NonSingleResult;

const catalogCollection = <Row extends object>(
  options: InventoryCollectionConfig,
): CatalogCollection<Row> => {
  // SAFETY: Runtime value is powerSyncCollectionOptions output. Expo TypeScript 6
  // and workspace TypeScript 7 load separate @tanstack/db copies, so CollectionConfig
  // from client-db is not assignable to createCollection here.
  return createCollection(options as never) as CatalogCollection<Row>;
};

export type MobileInventoryCollections = ReturnType<typeof createMobileInventoryCollections>;

export const createMobileInventoryCollections = (organizationId: string) => {
  const scopeId = inventoryReplicaScope(apiOrigin, organizationId);
  const database: AbstractPowerSyncDatabase = new PowerSyncDatabase({
    database: { dbFilename: inventoryPowerSyncDatabaseName(scopeId) },
    schema: inventoryPowerSyncSchema,
  });
  const configs = inventoryPowerSyncCollectionConfigs(database, scopeId);
  const categories = catalogCollection<CategoryRow>(configs.categories);
  const products = catalogCollection<ProductRow>(configs.products);
  const batches = catalogCollection<BatchRow>(configs.batches);
  let disposed = false;

  return {
    batches,
    categories,
    products,
    preload: async () => {
      await database.init();
      void database.connect(
        makeInventoryPowerSyncConnector({
          apiBaseUrl: apiOrigin,
          authenticatedFetch,
        }),
      );
      await waitForInventoryFirstSync(database);
      await Promise.all([categories.preload(), products.preload(), batches.preload()]);
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await Promise.all([categories.cleanup(), products.cleanup(), batches.cleanup()]);
      await disconnectAndClearInventoryPowerSync(database);
    },
  };
};
