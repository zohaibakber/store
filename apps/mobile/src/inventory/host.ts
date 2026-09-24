import {
  openSqlClientReplicaHandle,
  type SqlClientReplicaHandle,
} from "@store/client-db/sql-client";
import type { InventoryHost, ReplicaOpenIdentity } from "@store/inventory-react";

import { mintReplicaIdCandidate } from "./device-id";
import { replicaDatabaseName } from "./policy";
import { replicaSqlClient } from "./sqlite";

const disposals = new Map<string, Promise<void>>();

const settled = (work: Promise<unknown>): Promise<void> =>
  work.then(
    () => undefined,
    () => undefined,
  );

const retire = (databaseName: string, handle: SqlClientReplicaHandle): Promise<void> => {
  const previous = disposals.get(databaseName) ?? Promise.resolve();
  const done = previous.then(() => settled(handle.dispose()));
  disposals.set(databaseName, done);
  void done.then(() => {
    if (disposals.get(databaseName) === done) disposals.delete(databaseName);
  });
  return done;
};

export type MobileReplicaListener = {
  readonly opened: (handle: SqlClientReplicaHandle) => void;
  readonly closed: (handle: SqlClientReplicaHandle) => void;
};

export const createMobileInventoryHost = (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof globalThis.fetch;
  readonly listener: MobileReplicaListener;
}): InventoryHost => ({
  apiBaseUrl: input.apiBaseUrl,
  deviceId: mintReplicaIdCandidate(),
  openReplica: async (identity: ReplicaOpenIdentity) => {
    const databaseName = replicaDatabaseName(
      input.apiBaseUrl,
      identity.organizationId,
      identity.userId,
    );
    await disposals.get(databaseName);
    const handle = await openSqlClientReplicaHandle({
      sqlClient: replicaSqlClient(databaseName),
      databaseName,
      identity: { ...identity, replicaId: mintReplicaIdCandidate() },
      sync: { apiBaseUrl: input.apiBaseUrl, authenticatedFetch: input.authenticatedFetch },
    });
    let retired: Promise<void> | undefined;
    const replica: SqlClientReplicaHandle = {
      ...handle,
      close: () => {
        void replica.dispose();
      },
      dispose: () => {
        if (retired === undefined) {
          input.listener.closed(replica);
          retired = retire(databaseName, handle);
        }
        return retired;
      },
    };
    input.listener.opened(replica);
    return replica;
  },
});

export const unavailableInventoryHost = (input: {
  readonly apiBaseUrl: string;
  readonly message: string;
}): InventoryHost => ({
  apiBaseUrl: input.apiBaseUrl,
  deviceId: "",
  openReplica: () => Promise.reject(new Error(input.message)),
});
