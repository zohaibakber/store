import { indexedDbReplicaDatabaseName, openIndexedDbReplicaHandle } from "@store/client-db";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { InventoryHost } from "@/lib/inventory-host";

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

export const createWebInventoryHost = (): InventoryHost | undefined => {
  const apiBaseUrl = Schema.decodeUnknownOption(Schema.String)(import.meta.env.VITE_API_URL).pipe(
    Option.filter((value) => value.length > 0),
  );
  if (apiBaseUrl._tag === "None") return undefined;
  const deviceId = deviceIdFromStorage();
  return {
    apiBaseUrl: apiBaseUrl.value,
    authenticatedFetch: globalThis.fetch.bind(globalThis),
    deviceId,
    openReplicaSqlite: async (_databaseName, identity) =>
      openIndexedDbReplicaHandle({
        databaseName: indexedDbReplicaDatabaseName(identity.organizationId, identity.userId),
        identity: {
          organizationId: identity.organizationId,
          userId: identity.userId,
          replicaId: identity.replicaId,
        },
        sync: {
          apiBaseUrl: apiBaseUrl.value,
          authenticatedFetch: globalThis.fetch.bind(globalThis),
        },
      }),
  };
};
