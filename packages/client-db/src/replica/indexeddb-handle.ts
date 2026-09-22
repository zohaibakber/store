import type { SyncCommandEnvelope } from "@store/contracts";
import type { ReplicaCommitNotice as ContractNotice } from "@store/contracts/sync/replica-model";
import { makeSyncTransport, startOwnedHttpSync, type OwnedHttpSync } from "@store/sync/browser";
import type { IndexedDbSubsetPlan, IndexedDbSubsetRow } from "@store/sync/replica/indexeddb";
import {
  makeIndexedDbReplicaStore,
  requireIndexedDbPrimitives,
  type IndexedDbReplicaIdentity,
} from "@store/sync/replica/indexeddb";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { openReplicaHandleScope } from "./handle-scope";
import { createReplicaCommitPublisher } from "./publisher";
import { decodeSqliteResultRow, type OutboxCommandStatus } from "./sqlite-row";
import type {
  ReplicaCommitNotice,
  ReplicaHandle,
  ReplicaQueryStamp,
  ReplicaSubsetRead,
  SqliteParameter,
  SqliteResultRow,
} from "./types";

export type OpenIndexedDbReplicaInput = {
  readonly databaseName: string;
  readonly identity: IndexedDbReplicaIdentity;
  readonly sync?: {
    readonly apiBaseUrl: string;
    readonly authenticatedFetch: typeof fetch;
  };
};

const IndexedDbCell = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);
type IndexedDbCell = typeof IndexedDbCell.Type;
const decodeIndexedDbCell = Schema.decodeUnknownOption(IndexedDbCell);

const toClientNotice = (workspaceToken: string, notice: ContractNotice): ReplicaCommitNotice => ({
  workspaceToken,
  generationId: notice.generationId,
  localCommitVersion: notice.localCommitVersion,
  touchedEntities: notice.touchedEntities,
  touchedKeys: [...notice.touchedKeys],
});

const indexedDbCellToSqlite = (value: IndexedDbCell): string | number | null =>
  value === true ? 1 : value === false ? 0 : value;

const toSqliteResultRow = (row: IndexedDbSubsetRow): SqliteResultRow =>
  decodeSqliteResultRow(
    Object.fromEntries(
      Object.entries(row).flatMap(([column, value]) => {
        const decoded = decodeIndexedDbCell(value);
        return Option.isSome(decoded)
          ? [[column, indexedDbCellToSqlite(decoded.value)] as const]
          : [];
      }),
    ),
  );

export const openIndexedDbReplicaHandle = async (
  input: OpenIndexedDbReplicaInput,
): Promise<ReplicaHandle> => {
  const lifetime = openReplicaHandleScope();

  const primitives = await Effect.runPromise(requireIndexedDbPrimitives());
  const store = await Effect.runPromise(
    makeIndexedDbReplicaStore({
      databaseName: input.databaseName,
      databaseIdentity: input.databaseName,
      identity: input.identity,
      indexedDB: primitives.indexedDB,
      IDBKeyRange: primitives.IDBKeyRange,
    }),
  );
  await lifetime.addFinalizer(store.dispose());

  const publisher = createReplicaCommitPublisher();
  lifetime.addSyncFinalizer(() => {
    publisher.dispose();
  });

  await lifetime.runInScope(
    store.commits.pipe(
      Stream.runForEach((notice) =>
        Effect.sync(() => {
          publisher.publish(toClientNotice(input.databaseName, notice));
        }),
      ),
      Effect.forkScoped,
    ),
  );

  let ownedSync: OwnedHttpSync | undefined;
  if (input.sync) {
    const { apiBaseUrl, authenticatedFetch } = input.sync;
    ownedSync = await Effect.runPromise(
      Effect.gen(function* () {
        const transport = yield* makeSyncTransport(apiBaseUrl).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, authenticatedFetch),
        );
        return yield* startOwnedHttpSync(store, transport, input.databaseName, {
          apiBaseUrl,
          replicaId: input.identity.replicaId,
          fetch: authenticatedFetch,
          preferSse: true,
        });
      }),
    );
    await lifetime.addFinalizer(ownedSync.dispose);
  }

  const stamp = async (): Promise<ReplicaQueryStamp> => {
    const read = await Effect.runPromise(store.readStamp());
    return {
      workspaceToken: input.databaseName,
      generationId: read.generationId,
      localCommitVersion: read.localCommitVersion,
    };
  };

  const querySubset = async (plan: IndexedDbSubsetPlan): Promise<ReplicaSubsetRead> => {
    const result = await Effect.runPromise(store.querySubset(plan));
    return {
      stamp: {
        workspaceToken: input.databaseName,
        generationId: result.stamp.generationId,
        localCommitVersion: result.stamp.localCommitVersion,
      },
      rows: result.rows.map(toSqliteResultRow),
    };
  };

  return {
    workspaceToken: input.databaseName,
    engine: "indexeddb",
    stamp,
    querySubset,
    query: async (_sql: string, _parameters: ReadonlyArray<SqliteParameter>) => {
      throw new Error(
        "IndexedDB replica does not expose SQL. Use collection descriptors through the host-neutral query path.",
      );
    },
    readOutboxStatuses: async (): Promise<ReadonlyArray<OutboxCommandStatus>> =>
      Effect.runPromise(store.listOutboxStatuses()),
    readCommandAllocation: async () => Effect.runPromise(store.readCommandAllocation()),
    enqueueLocal: async (envelope: SyncCommandEnvelope, createdAt: number) => {
      const queued = await Effect.runPromise(store.enqueueCommand(envelope, createdAt));
      return { changed: queued.notice !== undefined, status: queued.value.status };
    },
    wakeSyncUpload: ownedSync
      ? () => {
          void Effect.runPromise(ownedSync.wake("localWrite"));
        }
      : undefined,
    subscribe: publisher.subscribe,
    publish: publisher.publish,
    close: lifetime.close,
  };
};
