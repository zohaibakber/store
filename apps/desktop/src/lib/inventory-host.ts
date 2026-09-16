import type { OpenOrganizationObjectLiveSocket, ReplicaSqliteHandle } from "@store/client-db";

export interface InventoryHost {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly deviceId: string;
  readonly openReplicaSqlite: (databaseName: string) => Promise<ReplicaSqliteHandle>;
  readonly openLiveSocket?: OpenOrganizationObjectLiveSocket;
}
