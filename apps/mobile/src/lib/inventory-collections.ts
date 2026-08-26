import { PowerSyncDatabase } from "@powersync/react-native";
import {
  disconnectAndClearInventoryPowerSync,
  inventoryPowerSyncCollectionConfigs,
  inventoryPowerSyncDatabaseName,
  inventoryPowerSyncSchema,
  inventoryReplicaScope,
  makeInventoryPowerSyncConnector,
  waitForInventoryFirstSync,
} from "@store/client-db";
import { createCollection } from "@tanstack/react-db";

import { apiOrigin, nativeAuthHeaders } from "@/lib/auth-client";

const authenticatedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(await nativeAuthHeaders())) {
    headers.set(name, value);
  }
  return fetch(input, { ...init, headers });
};

export type MobileInventoryCollections = ReturnType<typeof createMobileInventoryCollections>;

export const createMobileInventoryCollections = (organizationId: string) => {
  const scopeId = inventoryReplicaScope(apiOrigin, organizationId);
  const database = new PowerSyncDatabase({
    database: { dbFilename: inventoryPowerSyncDatabaseName(scopeId) },
    schema: inventoryPowerSyncSchema,
  });
  const configs = inventoryPowerSyncCollectionConfigs(database, scopeId);
  const categories = createCollection(configs.categories);
  const products = createCollection(configs.products);
  const batches = createCollection(configs.batches);
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
