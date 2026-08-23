import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from "@tanstack/browser-db-sqlite-persistence";

import type { InventoryPersistenceLease } from "@/lib/inventory-host";

export const openBrowserInventoryPersistence = async (
  databaseName: string,
): Promise<InventoryPersistenceLease> => {
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName });
  const coordinator = new BrowserCollectionCoordinator({ dbName: databaseName });

  try {
    return {
      persistence: createBrowserWASQLitePersistence({
        // The runtime object is the coordinator exported by this exact
        // persistence package.
        coordinator,
        database,
      }),
      dispose: async () => {
        coordinator.dispose();
        await database.close?.();
      },
    };
  } catch (cause) {
    coordinator.dispose();
    await database.close?.();
    throw cause;
  }
};
