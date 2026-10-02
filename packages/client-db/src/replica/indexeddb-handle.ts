import type { DeviceLabel, ReplicaInsightsWindow } from "@store/contracts";
import {
  layerOwnedHttpSync,
  SyncScheduler,
  SyncTransportService,
  type OwnedLiveHost,
} from "@store/sync";
import {
  layerIndexedDbReplicaStore,
  IndexedDbReplicaStore,
  type IndexedDbReplicaIdentity,
} from "@store/sync/replica/indexeddb";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";

import { replicaSyncActivityOf } from "./activity";
import { planIndexedDbSubset } from "./indexeddb-plan";
import { enqueuedCommand, openReplicaRuntime } from "./replica-runtime";
import { MAX_DISTINCT_VALUES } from "./sources";
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
} from "./types";
import { validateBatchSpecs, validateSummarySpec } from "./validate";

type OpenIndexedDbReplicaInput = {
  readonly databaseName: string;
  readonly identity: IndexedDbReplicaIdentity;
  readonly sync?: {
    readonly apiBaseUrl: string;
    readonly authenticatedFetch: typeof fetch;
    readonly accessToken: OwnedLiveHost["accessToken"];
    readonly deviceLabel?: DeviceLabel | undefined;
  };
};

const layerWebSync = (input: OpenIndexedDbReplicaInput) =>
  input.sync === undefined
    ? Layer.empty
    : layerOwnedHttpSync({
        databaseIdentity: input.databaseName,
        live: {
          apiBaseUrl: input.sync.apiBaseUrl,
          accessToken: input.sync.accessToken,
        },
        deviceLabel: input.sync.deviceLabel,
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
  const { booted, run, subscribe, scope, close } = await openReplicaRuntime(
    input.databaseName,
    (commitForwarding) =>
      Layer.mergeAll(layerWebSync(input), commitForwarding).pipe(
        Layer.provideMerge(
          layerIndexedDbReplicaStore({
            databaseName: input.databaseName,
            databaseIdentity: input.databaseName,
            identity: input.identity,
          }),
        ),
      ),
    Effect.gen(function* () {
      const store = yield* IndexedDbReplicaStore;
      return {
        store,
        scheduler: input.sync === undefined ? undefined : yield* SyncScheduler,
        replicaId: (yield* store.readSyncCursor()).replicaId,
      };
    }),
  );
  const { store, scheduler, replicaId } = booted;

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
    return { stamp: stamped(result.stamp), rows: result.rows };
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
    return { stamp: stamped(result.stamp), reads: result.reads };
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
    readSyncActivity: () => run(store.readOutboxActivity().pipe(Effect.map(replicaSyncActivityOf))),
    readPendingRowIds: (entity) => run(store.readPendingRowIds(entity)),
    enqueueCommand: async (request) =>
      enqueuedCommand(input.databaseName, (await run(store.enqueueCommand(request))).value),
    readCommandStatus: (operationId: string) => run(store.readCommandStatus(operationId)),
    wakeSyncUpload: scheduler
      ? () => {
          void run(scheduler.wake("localWrite")).catch(() => undefined);
        }
      : undefined,
    subscribe,
    subscribeSyncHealth: scheduler ? subscribeSchedulerHealth(scheduler, scope) : undefined,
    close,
  };
};
