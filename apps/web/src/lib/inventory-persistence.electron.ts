import { createElectronSQLitePersistence } from "@tanstack/electron-db-sqlite-persistence/renderer";

import type { InventoryPersistenceLease } from "@/lib/inventory-host";

export const openElectronInventoryPersistence = async (): Promise<InventoryPersistenceLease> => {
  const bridge = window.tanstackDbPersistence;
  if (!bridge) throw new Error("Electron catalog persistence is unavailable.");
  return {
    persistence: createElectronSQLitePersistence({
      invoke: (_channel, request) => bridge.invoke(request),
    }),
    dispose: async () => undefined,
  };
};
