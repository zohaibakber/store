import {
  makeSqliteReplicaStore,
  openReplicaStore,
  startOwnedHttpSync,
  type OwnedHttpSync,
  type SyncTransport,
} from "@store/sync";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { openReplicaHandleScope } from "./handle-scope";
import { createReplicaCommitPublisher } from "./publisher";
import { decodeReplicaStampRow, decodeSqliteResultRow } from "./sqlite-row";
import type {
  ReplicaCommitNotice,
  ReplicaQueryStamp,
  SqliteParameter,
  SqliteResultRow,
} from "./types";

export type NodeReplicaSyncIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

export type NodeReplicaSyncSession = {
  readonly engine: "sqlite";
  readonly stamp: () => ReplicaQueryStamp;
  readonly query: (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ) => ReadonlyArray<SqliteResultRow>;
  readonly queryStamped: (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ) => {
    readonly stamp: ReplicaQueryStamp;
    readonly rows: ReadonlyArray<SqliteResultRow>;
  };
  readonly wakeSyncUpload: () => Promise<{
    readonly drained: boolean;
    readonly drainCount: number;
  }>;
  readonly subscribe: (listener: (notice: ReplicaCommitNotice) => void) => () => void;
  readonly close: () => void;
};

const toParameter = (value: SqliteParameter): string | number | bigint | Buffer | null => {
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value;
};

const seedIdentity = (
  store: ReturnType<typeof openReplicaStore>,
  identity: NodeReplicaSyncIdentity,
) => {
  const existing = store.sqlite
    .prepare(`select id from replica_state where id = 'singleton'`)
    .get();
  if (existing !== undefined) return;
  store.sqlite
    .prepare(
      `insert into replica_state (
        id, organizationId, userId, replicaId, epoch, incarnation,
        appliedCommitSequence, nextClientSequence, localCommitVersion, activeGeneration
      ) values ('singleton', ?, ?, ?, '1', 'local', '0', '1', 0, 1)`,
    )
    .run(identity.organizationId, identity.userId, identity.replicaId);
};

export const openNodeReplicaSyncSession = async (input: {
  readonly path: string;
  readonly identity: NodeReplicaSyncIdentity;
  readonly databaseIdentity: string;
  readonly transport: SyncTransport;
  readonly live?: {
    readonly apiBaseUrl: string;
    readonly fetch: typeof globalThis.fetch;
    readonly preferSse?: boolean;
  };
}): Promise<NodeReplicaSyncSession> => {
  const lifetime = openReplicaHandleScope();

  const store = openReplicaStore(input.path);
  seedIdentity(store, input.identity);
  await lifetime.addFinalizer(
    Effect.sync(() => {
      store.close();
    }),
  );

  const workspaceToken = input.databaseIdentity;
  const publisher = createReplicaCommitPublisher();
  lifetime.addSyncFinalizer(() => {
    publisher.dispose();
  });

  const replicaStore = await Effect.runPromise(
    makeSqliteReplicaStore(store.db, input.databaseIdentity),
  );
  const owned: OwnedHttpSync = await Effect.runPromise(
    startOwnedHttpSync(
      replicaStore,
      input.transport,
      input.databaseIdentity,
      input.live
        ? {
            apiBaseUrl: input.live.apiBaseUrl,
            replicaId: input.identity.replicaId,
            fetch: input.live.fetch,
            preferSse: input.live.preferSse ?? false,
          }
        : undefined,
    ),
  );
  await lifetime.addFinalizer(owned.dispose);

  await lifetime.runInScope(
    replicaStore.commits.pipe(
      Stream.runForEach((notice) =>
        Effect.sync(() => {
          publisher.publish({
            workspaceToken,
            generationId: notice.generationId,
            localCommitVersion: notice.localCommitVersion,
            touchedEntities: notice.touchedEntities,
            touchedKeys: [...notice.touchedKeys],
          });
        }),
      ),
      Effect.forkScoped,
    ),
  );

  let drainCount = 0;
  const readStamp = (): ReplicaQueryStamp => {
    const decoded = decodeReplicaStampRow(
      store.sqlite
        .prepare(
          `select activeGeneration as generation, localCommitVersion as version from replica_state where id = 'singleton'`,
        )
        .get(),
    );
    return {
      workspaceToken,
      generationId: String(decoded.generation),
      localCommitVersion: decoded.version,
    };
  };

  const query = (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ): ReadonlyArray<SqliteResultRow> => {
    const statement = store.sqlite.prepare(sql);
    const bindings = parameters.map(toParameter);
    if (!statement.reader) {
      statement.run(...bindings);
      return [];
    }
    const rows = statement.all(...bindings);
    const result: Array<SqliteResultRow> = [];
    for (const row of rows) {
      result.push(decodeSqliteResultRow(row));
    }
    return result;
  };

  return {
    engine: "sqlite",
    stamp: readStamp,
    query,
    queryStamped: (sql, parameters) => ({
      stamp: readStamp(),
      rows: query(sql, parameters),
    }),
    wakeSyncUpload: async () => {
      drainCount += 1;
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* owned.wake("localWrite");
          yield* owned.engine.uploadOnce().pipe(Effect.ignore);
        }),
      );
      return { drained: true, drainCount };
    },
    subscribe: publisher.subscribe,
    close: () => {
      lifetime.close();
    },
  };
};
