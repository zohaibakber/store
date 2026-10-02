import { inventoryReplicaScope, sqliteReplicaFileName } from "@store/client-db";
import {
  openSqlClientReplicaHandle,
  type SqlClientReplicaHandle,
} from "@store/client-db/sql-client";
import type { InventoryHost, ReplicaOpenIdentity } from "@store/inventory-react";
import type { LiveNetworkSignal } from "@store/sync";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { randomUUID } from "expo-crypto";

import type { LiveAccessToken } from "@/auth/session";

import { replicaSqlClient } from "./sqlite";

const replicaDatabaseName = (apiBaseUrl: string, organizationId: string, userId: string): string =>
  sqliteReplicaFileName(
    encodeURIComponent(`${inventoryReplicaScope(apiBaseUrl, organizationId)}:${userId}`),
  );

const databaseLocks = new Map<string, Semaphore.Semaphore>();

const exclusive = <A, E>(databaseName: string, work: Effect.Effect<A, E>): Promise<A> => {
  const lock = databaseLocks.get(databaseName) ?? Semaphore.makeUnsafe(1);
  databaseLocks.set(databaseName, lock);
  return Effect.runPromise(lock.withPermit(work));
};

type MobileReplicaListener = {
  readonly opened: (handle: SqlClientReplicaHandle) => void;
  readonly closed: (handle: SqlClientReplicaHandle) => void;
};

export const createMobileInventoryHost = (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof globalThis.fetch;
  readonly liveAccessToken: LiveAccessToken;
  readonly network: LiveNetworkSignal;
  readonly listener: MobileReplicaListener;
}): InventoryHost => ({
  apiBaseUrl: input.apiBaseUrl,
  deviceId: randomUUID(),
  openReplica: async (identity: ReplicaOpenIdentity) => {
    const databaseName = replicaDatabaseName(
      input.apiBaseUrl,
      identity.organizationId,
      identity.userId,
    );
    const handle = await exclusive(
      databaseName,
      Effect.tryPromise({
        try: () =>
          openSqlClientReplicaHandle({
            sqlClient: replicaSqlClient(databaseName),
            databaseName,
            identity: { ...identity, replicaId: randomUUID() },
            sync: {
              apiBaseUrl: input.apiBaseUrl,
              authenticatedFetch: input.authenticatedFetch,
              accessToken: input.liveAccessToken,
              network: input.network,
            },
          }),
        catch: (cause) => cause,
      }),
    );
    let retired: Promise<void> | undefined;
    const replica: SqlClientReplicaHandle = {
      ...handle,
      close: () => {
        if (retired === undefined) {
          input.listener.closed(replica);
          retired = exclusive(databaseName, Effect.ignore(Effect.tryPromise(() => handle.close())));
        }
        return retired;
      },
    };
    input.listener.opened(replica);
    return replica;
  },
});
