import {
  SyncTransportService,
  type OwnedLiveHost,
  type SyncSchedulerPolicy,
  type SyncWakeReason,
} from "@store/sync/browser";
import { SqliteReplica } from "@store/sync/sql-client";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import { openSqliteReplicaSyncSession, type SqliteReplicaIdentity } from "./sql-client-session";
import type { ReplicaHandle } from "./types";

export type { SqliteReplicaIdentity } from "./sql-client-session";

type OpenSqlClientReplicaInput<E> = {
  readonly sqlClient: Layer.Layer<SqlClient, E>;
  readonly databaseName: string;
  readonly identity: SqliteReplicaIdentity;
  readonly sync: {
    readonly apiBaseUrl: string;
    readonly authenticatedFetch: typeof globalThis.fetch;
    readonly accessToken: OwnedLiveHost["accessToken"];
    readonly network?: OwnedLiveHost["network"];
  };
  readonly policy?: SyncSchedulerPolicy;
};

export type SqlClientReplicaHandle = ReplicaHandle & {
  readonly replicaId: string;
  readonly wakeSync: (reason: SyncWakeReason) => Promise<void>;
  readonly setVisible: (visible: boolean) => Promise<void>;
  readonly setPullMaxBytes: (maxBytes: number | undefined) => Promise<void>;
};

const layerFetchTransport = (apiBaseUrl: string, fetch: typeof globalThis.fetch) =>
  SyncTransportService.layer(apiBaseUrl).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );

export const openSqlClientReplicaHandle = async <E>(
  input: OpenSqlClientReplicaInput<E>,
): Promise<SqlClientReplicaHandle> => {
  const session = await openSqliteReplicaSyncSession({
    replica: SqliteReplica.layerFromClient.pipe(Layer.provide(input.sqlClient)),
    identity: input.identity,
    databaseIdentity: input.databaseName,
    transport: layerFetchTransport(input.sync.apiBaseUrl, input.sync.authenticatedFetch),
    live: {
      apiBaseUrl: input.sync.apiBaseUrl,
      accessToken: input.sync.accessToken,
      network: input.sync.network,
    },
    policy: input.policy,
  });
  return {
    workspaceToken: input.databaseName,
    engine: "sqlite",
    replicaId: session.replicaId,
    readOutboxActivity: session.readOutboxActivity,
    readPendingRowIds: session.readPendingRowIds,
    stamp: session.stamp,
    readSubset: session.readSubset,
    readBatch: session.readBatch,
    readInsights: session.readInsights,
    summarizeSubset: session.summarizeSubset,
    readOutboxStatuses: session.readOutboxStatuses,
    enqueueCommand: session.enqueueCommand,
    readCommandStatus: session.readCommandStatus,
    wakeSyncUpload: () => {
      void session.wake("localWrite").catch(() => undefined);
    },
    wakeSync: session.wake,
    setVisible: session.setVisible,
    setPullMaxBytes: session.setPullMaxBytes,
    subscribe: session.subscribe,
    subscribeSyncHealth: session.subscribeSyncHealth,
    close: session.close,
  };
};
