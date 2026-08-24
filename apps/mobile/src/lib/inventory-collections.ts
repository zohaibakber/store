import { PowerSyncDatabase } from "@powersync/react-native";
import {
  inventoryPowerSyncDatabaseName,
  inventoryPowerSyncSchema,
  inventoryReplicaScope,
  makeInventoryPowerSyncConnector,
  powerSyncCollectionSchemas,
  powerSyncDeserializationSchemas,
  powerSyncDeserializationFailure,
} from "@store/client-db";
import { powerSyncCollectionOptions } from "@tanstack/powersync-db-collection";
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
  const configs = {
    categories: powerSyncCollectionOptions({
      id: `${scopeId}:categories`,
      database,
      table: inventoryPowerSyncSchema.props.categories,
      schema: powerSyncCollectionSchemas.categories,
      deserializationSchema: powerSyncDeserializationSchemas.categories,
      onDeserializationError: powerSyncDeserializationFailure,
    }),
    products: powerSyncCollectionOptions({
      id: `${scopeId}:products`,
      database,
      table: inventoryPowerSyncSchema.props.products,
      schema: powerSyncCollectionSchemas.products,
      deserializationSchema: powerSyncDeserializationSchemas.products,
      onDeserializationError: powerSyncDeserializationFailure,
    }),
    batches: powerSyncCollectionOptions({
      id: `${scopeId}:batches`,
      database,
      table: inventoryPowerSyncSchema.props.batches,
      schema: powerSyncCollectionSchemas.batches,
      deserializationSchema: powerSyncDeserializationSchemas.batches,
      onDeserializationError: powerSyncDeserializationFailure,
    }),
  };
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
      await database.connect(
        makeInventoryPowerSyncConnector({
          apiBaseUrl: apiOrigin,
          authenticatedFetch,
        }),
      );
      await Promise.all([categories.preload(), products.preload(), batches.preload()]);
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await Promise.all([categories.cleanup(), products.cleanup(), batches.cleanup()]);
      await database.close();
    },
  };
};
