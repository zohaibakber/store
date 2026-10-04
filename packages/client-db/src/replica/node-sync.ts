import type { DeviceLabel } from "@store/contracts";
import type { OwnedLiveHost, SyncTransportService } from "@store/sync";
import { layerNodeSqliteReplica } from "@store/sync/sqlite";
import type * as Layer from "effect/Layer";

import {
  openSqliteReplicaLocalSession,
  openSqliteReplicaSyncSession,
  type SqliteReplicaIdentity,
  type SqliteReplicaSyncSession,
} from "./sql-client-session";

type NodeReplicaSyncIdentity = SqliteReplicaIdentity;

export type NodeReplicaSyncSession = SqliteReplicaSyncSession;

export const openNodeReplicaSyncSession = (input: {
  readonly path: string;
  readonly identity: NodeReplicaSyncIdentity;
  readonly databaseIdentity: string;
  readonly transport: Layer.Layer<SyncTransportService>;
  readonly live: OwnedLiveHost;
  readonly deviceLabel?: DeviceLabel | undefined;
}): Promise<NodeReplicaSyncSession> =>
  openSqliteReplicaSyncSession({
    replica: layerNodeSqliteReplica(input.path),
    identity: input.identity,
    databaseIdentity: input.databaseIdentity,
    transport: input.transport,
    live: input.live,
    deviceLabel: input.deviceLabel,
  });

export const openNodeLocalReplicaSession = (input: {
  readonly path: string;
  readonly identity: NodeReplicaSyncIdentity;
  readonly databaseIdentity: string;
}): Promise<NodeReplicaSyncSession> =>
  openSqliteReplicaLocalSession({
    replica: layerNodeSqliteReplica(input.path),
    identity: input.identity,
    databaseIdentity: input.databaseIdentity,
  });
