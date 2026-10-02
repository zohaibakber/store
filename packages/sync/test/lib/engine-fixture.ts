import * as Effect from "effect/Effect";

import { makeSyncEngineFromReplicaStore } from "../../src/engine";
import type { SqliteReplicaHandle } from "../../src/replica/sql-client/handle";
import { makeSqliteReplicaStore } from "../../src/replica/sqlite/store";
import type { SyncTransport } from "../../src/transport";

export const stubTransport = (overrides: Partial<SyncTransport> = {}): SyncTransport => ({
  registerReplica: () => Effect.die("unused"),
  submitCommand: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  pull: () => Effect.die("unused"),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
  ...overrides,
});

export const sqliteEngine = (handle: SqliteReplicaHandle, transport: SyncTransport) =>
  Effect.gen(function* () {
    const store = yield* makeSqliteReplicaStore(handle, "sqlite");
    return yield* makeSyncEngineFromReplicaStore(store, transport);
  });
