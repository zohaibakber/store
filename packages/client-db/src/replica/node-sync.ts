import type { DeviceLabel } from "@store/contracts";
import type { OwnedLiveHost, SyncTransportService } from "@store/sync";
import { layerNodeSqliteReplica } from "@store/sync/sqlite";
import type * as Layer from "effect/Layer";

import {
  layerSqliteReplicaLocal,
  layerSqliteReplicaSync,
  type SqliteReplicaIdentity,
} from "./sql-client-session";

type NodeReplicaInput = {
  readonly path: string;
  readonly identity: SqliteReplicaIdentity;
  readonly databaseIdentity: string;
};

type NodeReplicaSyncInput = NodeReplicaInput & {
  readonly transport: Layer.Layer<SyncTransportService>;
  readonly live: OwnedLiveHost;
  readonly deviceLabel?: DeviceLabel | undefined;
};

const syncInput = (input: NodeReplicaSyncInput) => ({
  replica: layerNodeSqliteReplica(input.path),
  identity: input.identity,
  databaseIdentity: input.databaseIdentity,
  transport: input.transport,
  live: input.live,
  deviceLabel: input.deviceLabel,
});

export const layerNodeReplicaSync = (input: NodeReplicaSyncInput) =>
  layerSqliteReplicaSync(syncInput(input));

export const layerNodeLocalReplica = (input: NodeReplicaInput) =>
  layerSqliteReplicaLocal({
    replica: layerNodeSqliteReplica(input.path),
    identity: input.identity,
    databaseIdentity: input.databaseIdentity,
  });
