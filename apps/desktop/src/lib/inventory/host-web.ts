import { indexedDbReplicaDatabaseName, openIndexedDbReplicaHandle } from "@store/client-db";
import type { InventoryHost } from "@store/inventory-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const DeviceId = Schema.String.check(Schema.isMinLength(1));
const DEVICE_ID_KEY = "tabaaq.deviceId";

const deviceIdFromStorage = (): string => {
  const existing = Schema.decodeUnknownOption(DeviceId)(
    globalThis.localStorage?.getItem(DEVICE_ID_KEY),
  ).pipe(Option.getOrNull);
  if (existing) return existing;
  const id = crypto.randomUUID();
  globalThis.localStorage?.setItem(DEVICE_ID_KEY, id);
  return id;
};

let persistenceRequested = false;

const requestPersistentStorage = () => {
  const storage = globalThis.navigator?.storage;
  if (persistenceRequested || !storage?.persist) return;
  persistenceRequested = true;
  void storage
    .persisted()
    .then((persisted) => persisted || storage.persist())
    .catch(() => false);
};

export const createWebInventoryHost = (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
}): InventoryHost => {
  const deviceId = deviceIdFromStorage();
  return {
    apiBaseUrl: input.apiBaseUrl,
    deviceId,
    openReplica: async (identity) => {
      const handle = await openIndexedDbReplicaHandle({
        databaseName: indexedDbReplicaDatabaseName(identity.organizationId, identity.userId),
        identity: {
          organizationId: identity.organizationId,
          userId: identity.userId,
          replicaId: identity.replicaId,
        },
        sync: {
          apiBaseUrl: input.apiBaseUrl,
          authenticatedFetch: input.authenticatedFetch,
        },
      });
      requestPersistentStorage();
      return handle;
    },
  };
};
