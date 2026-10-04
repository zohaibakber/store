import { SyncTransportService, type OwnedLiveHost, type SyncSchedulerPolicy } from "@store/sync";
import { SqliteReplica } from "@store/sync/sql-client";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import type { SqlClient } from "effect/sql/SqlClient";

import { layerSqliteReplicaSync, type SqliteReplicaIdentity } from "./sql-client-session";

export type { SqliteReplicaIdentity, SqliteReplicaServices } from "./sql-client-session";

type SqlClientReplicaInput<E> = {
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

const layerFetchTransport = (apiBaseUrl: string, fetch: typeof globalThis.fetch) =>
  SyncTransportService.layer(apiBaseUrl).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );

export const layerSqlClientReplicaSync = <E>(input: SqlClientReplicaInput<E>) =>
  layerSqliteReplicaSync({
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
