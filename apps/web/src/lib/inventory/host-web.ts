import { indexedDbReplicaDatabaseName } from "@store/client-db";
import {
  createCatalogLifetime,
  inventoryScopeId,
  type CatalogLifetime,
  type InventoryHost,
} from "@store/inventory-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { browserDeviceLabel } from "@/lib/device-label";

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

const loadReplicaEngine = () => import("@store/client-db/indexeddb");

const loadWorkspace = () => import("@store/inventory-react/workspace");

export const warmWebWorkspace = () => {
  void loadReplicaEngine().catch(() => undefined);
  void loadWorkspace().catch(() => undefined);
};

export const createWebCatalogLifetime = (): CatalogLifetime =>
  createCatalogLifetime({
    open: async (host, scope) => {
      const { openInventoryWorkspace } = await loadWorkspace();
      return openInventoryWorkspace(host, scope);
    },
    databaseName: inventoryScopeId,
  });

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
  readonly liveAccessToken: (options: { readonly force: boolean }) => Promise<string | null>;
}): InventoryHost => {
  const deviceId = deviceIdFromStorage();
  const deviceLabel = browserDeviceLabel(globalThis.navigator?.userAgent ?? "");
  return {
    apiBaseUrl: input.apiBaseUrl,
    deviceId,
    openReplica: async (identity) => {
      const { openIndexedDbReplicaHandle } = await loadReplicaEngine();
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
          accessToken: input.liveAccessToken,
          deviceLabel,
        },
      });
      requestPersistentStorage();
      return handle;
    },
  };
};
