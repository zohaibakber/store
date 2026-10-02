import type { DeviceLabel } from "@store/contracts";
import { SyncTransportService, type OwnedLiveHost, type SyncTransport } from "@store/sync/browser";
import { SqliteReplica } from "@store/sync/sqlite";
import * as Layer from "effect/Layer";

import {
  openSqliteReplicaLocalSession,
  openSqliteReplicaSyncSession,
  type SqliteReplicaIdentity,
  type SqliteReplicaSyncSession,
} from "./sql-client-session";

export type NodeReplicaSyncIdentity = SqliteReplicaIdentity;

export type NodeReplicaSyncSession = SqliteReplicaSyncSession;

export const openNodeReplicaSyncSession = (input: {
  readonly path: string;
  readonly identity: NodeReplicaSyncIdentity;
  readonly databaseIdentity: string;
  readonly transport: SyncTransport;
  readonly live: OwnedLiveHost;
  readonly deviceLabel?: DeviceLabel | undefined;
}): Promise<NodeReplicaSyncSession> =>
  openSqliteReplicaSyncSession({
    replica: SqliteReplica.layer(input.path),
    identity: input.identity,
    databaseIdentity: input.databaseIdentity,
    transport: Layer.succeed(SyncTransportService, input.transport),
    live: input.live,
    deviceLabel: input.deviceLabel,
  });

export const openNodeLocalReplicaSession = (input: {
  readonly path: string;
  readonly identity: NodeReplicaSyncIdentity;
  readonly databaseIdentity: string;
}): Promise<NodeReplicaSyncSession> =>
  openSqliteReplicaLocalSession({
    replica: SqliteReplica.layer(input.path),
    identity: input.identity,
    databaseIdentity: input.databaseIdentity,
  });
