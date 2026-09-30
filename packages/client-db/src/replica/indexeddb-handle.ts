import type { EnqueueCommandRequest, ReplicaInsightsWindow } from "@store/contracts";
import {
  layerOwnedHttpSync,
  SyncScheduler,
  SyncTransportService,
  type OwnedLiveHost,
} from "@store/sync/browser";
import {
  layerIndexedDbReplicaStore,
  IndexedDbReplicaStore,
  type IndexedDbReplicaIdentity,
  type IndexedDbSubsetRow,
} from "@store/sync/replica/indexeddb";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { layerCommitForwarding } from "./commit-forwarding";
import { planIndexedDbSubset } from "./indexeddb-plan";
import { makeReplicaLifetime } from "./lifetime";
import { createReplicaCommitPublisher } from "./publisher";
import { MAX_DISTINCT_VALUES } from "./sources";
import { decodeSqliteResultRow, type OutboxCommandStatus } from "./sqlite-row";
import type { InventorySubsetSpec, InventorySubsetSummarySpec } from "./subset-spec";
import { subscribeSchedulerHealth } from "./sync-health";
import type {
  ReplicaBatchRead,
  ReplicaHandle,
  ReplicaInsightsRead,
  ReplicaQueryStamp,
  ReplicaReadOptions,
  ReplicaSubsetRead,
  ReplicaSummaryRead,
  SqliteResultRow,
} from "./types";
import { validateBatchSpecs, validateSummarySpec } from "./validate";
import { bootWorkspaceRuntime } from "./workspace-runtime";

export type OpenIndexedDbReplicaInput = {
  readonly databaseName: string;
  readonly identity: IndexedDbReplicaIdentity;
  readonly sync?: {
    readonly apiBaseUrl: string;
    readonly authenticatedFetch: typeof fetch;
    readonly accessToken: OwnedLiveHost["accessToken"];
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
          accessToken: input.sync.accessToken,
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
  const lifetime = makeReplicaLifetime();
  lifetime.onClose(Effect.promise(() => runtime.dispose()));
  lifetime.onClose(Effect.promise(() => publisher.dispose()));

  type RuntimeServices = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

  const run = <A, E>(effect: Effect.Effect<A, E, RuntimeServices>, options?: ReplicaReadOptions) =>
    runtime.runPromise(
      lifetime.supervise(effect),
      options?.signal === undefined ? undefined : { signal: options.signal },
    );

  const stamped = (stamp: {
    readonly generationId: string;
    readonly localCommitVersion: number;
  }): ReplicaQueryStamp => ({
    workspaceToken: input.databaseName,
    generationId: stamp.generationId,
    localCommitVersion: stamp.localCommitVersion,
  });

  const stamp = async (): Promise<ReplicaQueryStamp> => stamped(await run(store.readStamp()));

  const readSubset = async (
    spec: InventorySubsetSpec,
    options?: ReplicaReadOptions,
  ): Promise<ReplicaSubsetRead> => {
    const result = await run(
      planIndexedDbSubset(spec).pipe(Effect.flatMap((plan) => store.querySubset(plan))),
      options,
    );
    return { stamp: stamped(result.stamp), rows: result.rows.map(toSqliteResultRow) };
  };

  const readBatch = async (
    specs: ReadonlyArray<InventorySubsetSpec>,
    options?: ReplicaReadOptions,
  ): Promise<ReplicaBatchRead> => {
    const read = Effect.gen(function* () {
      yield* validateBatchSpecs(specs);
      const plans = yield* Effect.forEach(specs, planIndexedDbSubset);
      if (!Array.isArrayNonEmpty(plans)) {
        return yield* Effect.die("The batch read has no specifications.");
      }
      return yield* store.querySubsets(plans);
    });
    const result = await run(read, options);
    return {
      stamp: stamped(result.stamp),
      reads: result.reads.map((rows) => rows.map(toSqliteResultRow)),
    };
  };

  const summarizeSubset = async (spec: InventorySubsetSummarySpec): Promise<ReplicaSummaryRead> => {
    const result = await run(
      validateSummarySpec(spec).pipe(
        Effect.flatMap((valid) =>
          planIndexedDbSubset({ ...valid, orderBy: [], limit: 1, offset: 0 }),
        ),
        Effect.flatMap((plan) => store.summarizeSubset(plan, spec.distinct, MAX_DISTINCT_VALUES)),
      ),
    );
    return { stamp: stamped(result.stamp), summary: result.summary };
  };

  const readInsights = async (window: ReplicaInsightsWindow): Promise<ReplicaInsightsRead> => {
    const result = await run(store.queryInsights(window));
    return { stamp: stamped(result.stamp), facts: result.facts };
  };

  return {
    workspaceToken: input.databaseName,
    engine: "indexeddb",
    replicaId,
    stamp,
    readSubset,
    readBatch,
    readInsights,
    summarizeSubset,
    readOutboxActivity: () => run(store.readOutboxActivity()),
    readPendingRowIds: (entity) => run(store.readPendingRowIds(entity)),
    readOutboxStatuses: async (): Promise<ReadonlyArray<OutboxCommandStatus>> =>
      run(store.listOutboxStatuses()),
    enqueueCommand: async (request: EnqueueCommandRequest) => {
      const queued = await run(store.enqueueCommand(request));
      return {
        operationId: queued.value.operationId,
        status: queued.value.status,
        stamp: { workspaceToken: input.databaseName, ...queued.value.stamp },
      };
    },
    readCommandStatus: (operationId: string) => run(store.readCommandStatus(operationId)),
    wakeSyncUpload: scheduler
      ? () => {
          void run(scheduler.wake("localWrite")).catch(() => undefined);
        }
      : undefined,
    subscribe: publisher.subscribe,
    subscribeSyncHealth: scheduler
      ? subscribeSchedulerHealth(scheduler, lifetime.scope)
      : undefined,
    close: lifetime.close,
  };
};
