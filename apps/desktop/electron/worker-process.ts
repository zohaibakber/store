import { Worker } from "node:worker_threads";

import * as NodeWorker from "@effect/platform-node/NodeWorker";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as RpcClient from "effect/rpc/RpcClient";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcWorker from "effect/rpc/RpcWorker";
import type * as Schema from "effect/Schema";
import * as WorkerPlatform from "effect/workers/Worker";

import {
  ANALYTICS_WORKER_RPC_CONCURRENCY,
  AnalyticsWorkerBoot,
  AnalyticsWorkerRpcs,
} from "./analytics-rpc";
import {
  READER_RPC_CONCURRENCY,
  ReplicaReaderBoot,
  ReplicaReaderRpcs,
  ReplicaWorkerBoot,
  ReplicaWorkerRpcs,
  WORKER_RPC_CONCURRENCY,
} from "./replica-rpc";
import type { SpawnReplicaReader, SpawnReplicaWorker } from "./replica-supervisor";

const singleIncarnation = (
  base: WorkerPlatform.WorkerPlatform["Service"],
  lost: Deferred.Deferred<void>,
): WorkerPlatform.WorkerPlatform["Service"] =>
  WorkerPlatform.WorkerPlatform.of({
    spawn: <O, I>(id: number) =>
      base.spawn<O, I>(id).pipe(
        Effect.map((worker): WorkerPlatform.Worker<O, I> => ({
          send: worker.send,
          run: (handler, options) =>
            Effect.flatMap(Deferred.isDone(lost), (ended) =>
              ended
                ? Effect.never
                : worker
                    .run(handler, options)
                    .pipe(Effect.onExit(() => Deferred.succeed(lost, undefined))),
            ),
        })),
      ),
  });

const makeNodeWorkerIncarnation = (workerPath: string) =>
  Effect.gen(function* () {
    const lost = yield* Deferred.make<void>();
    const created = yield* Deferred.make<Worker>();
    const platform = Layer.effect(WorkerPlatform.WorkerPlatform)(
      WorkerPlatform.WorkerPlatform.use((base) => Effect.succeed(singleIncarnation(base, lost))),
    ).pipe(Layer.provide(NodeWorker.layerPlatform));
    const spawner = WorkerPlatform.layerSpawner(() => {
      const worker = new Worker(workerPath);
      Deferred.doneUnsafe(created, Exit.succeed(worker));
      return worker;
    });
    return {
      layer: Layer.merge(platform, spawner),
      lost: Deferred.await(lost),
      terminate: Effect.flatMap(Deferred.isDone(created), (spawned) =>
        spawned
          ? Effect.flatMap(Deferred.await(created), (worker) =>
              Effect.promise(() => worker.terminate()),
            )
          : Effect.void,
      ).pipe(Effect.asVoid),
    };
  });

const spawnNodeRpcWorker =
  <Rpcs extends Rpc.Any, Boot extends Schema.Constraint>(protocol: {
    readonly rpcs: RpcGroup.RpcGroup<Rpcs>;
    readonly boot: Boot;
    readonly concurrency: number;
  }) =>
  (launch: { readonly workerPath: string; readonly boot: Boot["Type"] }) =>
    Effect.gen(function* () {
      const incarnation = yield* makeNodeWorkerIncarnation(launch.workerPath);
      const transport = yield* Layer.build(
        RpcClient.layerProtocolWorker({ size: 1, concurrency: protocol.concurrency }).pipe(
          Layer.provide(incarnation.layer),
          Layer.provide(RpcWorker.layerInitialMessage(protocol.boot, Effect.succeed(launch.boot))),
        ),
      );
      const client = yield* RpcClient.make(protocol.rpcs).pipe(Effect.provideContext(transport));
      return { client, lost: incarnation.lost, terminate: incarnation.terminate };
    }).pipe(Effect.orDie);

export const spawnNodeReplicaWorker: SpawnReplicaWorker = spawnNodeRpcWorker({
  rpcs: ReplicaWorkerRpcs,
  boot: ReplicaWorkerBoot,
  concurrency: WORKER_RPC_CONCURRENCY,
});

export const spawnNodeReplicaReader: SpawnReplicaReader = spawnNodeRpcWorker({
  rpcs: ReplicaReaderRpcs,
  boot: ReplicaReaderBoot,
  concurrency: READER_RPC_CONCURRENCY,
});

export const spawnNodeAnalyticsWorker = spawnNodeRpcWorker({
  rpcs: AnalyticsWorkerRpcs,
  boot: AnalyticsWorkerBoot,
  concurrency: ANALYTICS_WORKER_RPC_CONCURRENCY,
});
