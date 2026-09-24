import { openElectronIpcReplicaHandle } from "@store/client-db";
import type { InventoryHost } from "@store/inventory-react";
import * as Schema from "effect/Schema";

const InventoryHttpConfig = Schema.Struct({
  apiBaseUrl: Schema.String,
  deviceId: Schema.String,
});

export const createElectronInventoryHost = async (): Promise<InventoryHost | undefined> => {
  const http = window.inventoryHttp;
  const replica = window.replica;
  if (!http || !replica) return undefined;
  const config = Schema.decodeUnknownSync(InventoryHttpConfig)(await http.getConfig());
  return {
    apiBaseUrl: config.apiBaseUrl,
    deviceId: config.deviceId,
    openReplica: (identity) => openElectronIpcReplicaHandle(replica, identity),
  };
};
