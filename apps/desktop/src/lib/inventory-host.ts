import type { AbstractPowerSyncDatabase } from "@powersync/common";
import type { OpenOrganizationObjectLiveSocket, ReplicaSqliteHandle } from "@store/client-db";

import type { InventoryBackendSelection } from "@/lib/inventory/types";

export interface InventoryHost {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly backend: InventoryBackendSelection;
  readonly deviceId: string;
  readonly openPowerSyncDatabase: (databaseName: string) => Promise<AbstractPowerSyncDatabase>;
  readonly openReplicaSqlite?: (databaseName: string) => Promise<ReplicaSqliteHandle>;
  readonly openLiveSocket?: OpenOrganizationObjectLiveSocket;
}
