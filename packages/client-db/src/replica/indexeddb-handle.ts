import type { SyncCommandEnvelope } from "@store/contracts";
import { layerOwnedHttpSync, SyncScheduler, SyncTransportService } from "@store/sync/browser";
import {
  layerIndexedDbReplicaStore,
  IndexedDbReplicaStore,
  type IndexedDbReplicaIdentity,
  type IndexedDbSubsetRow,
} from "@store/sync/replica/indexeddb";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { layerCommitForwarding } from "./commit-forwarding";
import { planIndexedDbSubset } from "./indexeddb-plan";
import { createReplicaCommitPublisher } from "./publisher";
import { decodeSqliteResultRow, type OutboxCommandStatus } from "./sqlite-row";
import type { InventorySubsetSpec } from "./subset-spec";
import { subscribeSchedulerHealth } from "./sync-health";
import type { ReplicaHandle, ReplicaQueryStamp, ReplicaSubsetRead, SqliteResultRow } from "./types";
import { bootWorkspaceRuntime } from "./workspace-runtime";

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

const layerWebSync = (input: OpenIndexedDbReplicaInput) =>
  input.sync === undefined
    ? Layer.empty
    : layerOwnedHttpSync({
        databaseIdentity: input.databaseName,
        live: {
          apiBaseUrl: input.sync.apiBaseUrl,
          replicaId: input.identity.replicaId,
          fetch: input.sync.authenticatedFetch,
          preferSse: true,
        },
      }).pipe(
        Layer.provide(
          SyncTransportService.layer(input.sync.apiBaseUrl).pipe(
            Layer.provide(FetchHttpClient.layer),
            Layer.provide(Layer.succeed(FetchHttpClient.Fetch, input.sync.authenticatedFetch)),
          ),
        ),
      );

export const openIndexedDbReplicaHandle = async (
  input: OpenIndexedDbReplicaInput,
): Promise<ReplicaHandle> => {
  const publisher = createReplicaCommitPublisher();
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(layerWebSync(input), layerCommitForwarding(input.databaseName, publisher)).pipe(
      Layer.provideMerge(
        layerIndexedDbReplicaStore({
          databaseName: input.databaseName,
          databaseIdentity: input.databaseName,
          identity: input.identity,
        }),
      ),
    ),
  );
  const { store, scheduler, replicaId } = await bootWorkspaceRuntime(
    runtime,
    Effect.gen(function* () {
      const store = yield* IndexedDbReplicaStore;
      return {
        store,
        scheduler: input.sync === undefined ? undefined : yield* SyncScheduler,
        replicaId: (yield* store.readSyncCursor()).replicaId,
      };
    }),
  );
  const stamp = async (): Promise<ReplicaQueryStamp> => {
    const read = await runtime.runPromise(store.readStamp());
    return {
      workspaceToken: input.databaseName,
      generationId: read.generationId,
      localCommitVersion: read.localCommitVersion,
    };
  };

  const readSubset = async (spec: InventorySubsetSpec): Promise<ReplicaSubsetRead> => {
    const result = await runtime.runPromise(
      planIndexedDbSubset(spec).pipe(Effect.flatMap((plan) => store.querySubset(plan))),
    );
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
    replicaId,
    stamp,
    readSubset,
    readOutboxActivity: () => runtime.runPromise(store.readOutboxActivity()),
    readPendingRowIds: (entity) => runtime.runPromise(store.readPendingRowIds(entity)),
    readOutboxStatuses: async (): Promise<ReadonlyArray<OutboxCommandStatus>> =>
      runtime.runPromise(store.listOutboxStatuses()),
    readCommandAllocation: async () => runtime.runPromise(store.readCommandAllocation()),
    enqueueLocal: async (envelope: SyncCommandEnvelope, createdAt: number) => {
      const queued = await runtime.runPromise(store.enqueueCommand(envelope, createdAt));
      return { changed: queued.notice !== undefined, status: queued.value.status };
    },
    wakeSyncUpload: scheduler
      ? () => {
          void runtime.runPromise(scheduler.wake("localWrite"));
        }
      : undefined,
    subscribe: publisher.subscribe,
    subscribeSyncHealth: scheduler ? subscribeSchedulerHealth(scheduler) : undefined,
    publish: publisher.publish,
    close: () => {
      publisher.dispose();
      void runtime.dispose();
    },
  };
};
