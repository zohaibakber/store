import { openElectronIpcReplicaHandle } from "@store/client-db";
import { LOCAL_ORGANIZATION_ID } from "@store/contracts";
import type { InventoryHost, ReplicaOpenIdentity } from "@store/inventory-react";
import * as Schema from "effect/Schema";

const InventoryHttpConfig = Schema.Struct({
  apiBaseUrl: Schema.String,
  deviceId: Schema.String,
});

const authorityOf = (identity: ReplicaOpenIdentity) =>
  identity.organizationId === LOCAL_ORGANIZATION_ID ? "local" : "remote";

export const createElectronInventoryHost = async (): Promise<InventoryHost | undefined> => {
  const http = window.inventoryHttp;
  const replica = window.replica;
  if (!http || !replica) return undefined;
  const config = Schema.decodeUnknownSync(InventoryHttpConfig)(await http.getConfig());
  return {
    apiBaseUrl: config.apiBaseUrl,
    deviceId: config.deviceId,
    openReplica: (identity) =>
      openElectronIpcReplicaHandle(replica, { ...identity, authority: authorityOf(identity) }),
  };
};
