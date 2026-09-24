import { SyncTransportService, type SyncTransport } from "@store/sync/browser";
import { SqliteReplica } from "@store/sync/sqlite";
import * as Layer from "effect/Layer";

import {
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
  readonly live?: {
    readonly apiBaseUrl: string;
    readonly fetch: typeof globalThis.fetch;
    readonly preferSse?: boolean;
  };
}): Promise<NodeReplicaSyncSession> =>
  openSqliteReplicaSyncSession({
    replica: SqliteReplica.layer(input.path),
    identity: input.identity,
    databaseIdentity: input.databaseIdentity,
    transport: Layer.succeed(SyncTransportService, input.transport),
    live: input.live,
  });
