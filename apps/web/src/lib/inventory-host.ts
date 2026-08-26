import type { AbstractPowerSyncDatabase } from "@powersync/common";

export interface InventoryHost {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly deviceId: string;
  readonly openPowerSyncDatabase: (databaseName: string) => Promise<AbstractPowerSyncDatabase>;
}
