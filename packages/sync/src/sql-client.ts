import type { SyncProtocolError } from "@store/contracts";
import * as Effect from "effect/Effect";

import {
  makeSyncEngineFromReplicaStore,
  type SyncEngineContract,
  type SyncEngineMutex,
} from "./engine";
import type { SqliteReplicaHandle } from "./replica/sql-client/handle";
import { makeSqliteReplicaStore } from "./replica/sqlite/store";
import type { ReplicaStoreError } from "./replica/store";
import type { SyncTransport } from "./transport";

export type { ReplicaDb, ReplicaQueryEffectHKT } from "./replica/sql-client/drizzle";
export {
  openReplicaStoreFromClient,
  runReplicaTransaction,
  SqliteReplica,
} from "./replica/sql-client/handle";
export type { ReplicaOpenError, SqliteReplicaHandle } from "./replica/sql-client/handle";
export { readOutboxActivitySqlite, readPendingRowIdsSqlite } from "./replica/sqlite/activity";
export { layerSqliteReplicaStore, makeSqliteReplicaStore } from "./replica/sqlite/store";

export const makeSyncEngine = (
  handle: SqliteReplicaHandle,
  mutex: SyncEngineMutex,
  transport: SyncTransport,
): Effect.Effect<SyncEngineContract, SyncProtocolError | ReplicaStoreError> =>
  makeSqliteReplicaStore(handle, "sqlite").pipe(
    Effect.flatMap((store) => makeSyncEngineFromReplicaStore(store, mutex, transport)),
  );
