import { Worker } from "node:worker_threads";

import * as NodeWorker from "@effect/platform-node/NodeWorker";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcWorker from "effect/unstable/rpc/RpcWorker";
import * as WorkerPlatform from "effect/unstable/workers/Worker";

import { READER_RPC_CONCURRENCY, WORKER_RPC_CONCURRENCY } from "./replica-admission";
import {
  ReplicaReaderBoot,
  ReplicaReaderRpcs,
  ReplicaWorkerBoot,
  ReplicaWorkerRpcs,
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

export const makeNodeWorkerIncarnation = (workerPath: string) =>
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

export const spawnNodeReplicaWorker: SpawnReplicaWorker = ({ workerPath, boot }) =>
  Effect.gen(function* () {
    const incarnation = yield* makeNodeWorkerIncarnation(workerPath);
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolWorker({ size: 1, concurrency: WORKER_RPC_CONCURRENCY }).pipe(
        Layer.provide(incarnation.layer),
        Layer.provide(RpcWorker.layerInitialMessage(ReplicaWorkerBoot, Effect.succeed(boot))),
      ),
    );
    const client = yield* RpcClient.make(ReplicaWorkerRpcs).pipe(Effect.provideContext(protocol));
    return { client, lost: incarnation.lost, terminate: incarnation.terminate };
  }).pipe(Effect.orDie);

export const spawnNodeReplicaReader: SpawnReplicaReader = ({ workerPath, boot }) =>
  Effect.gen(function* () {
    const incarnation = yield* makeNodeWorkerIncarnation(workerPath);
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolWorker({ size: 1, concurrency: READER_RPC_CONCURRENCY }).pipe(
        Layer.provide(incarnation.layer),
        Layer.provide(RpcWorker.layerInitialMessage(ReplicaReaderBoot, Effect.succeed(boot))),
      ),
    );
    const client = yield* RpcClient.make(ReplicaReaderRpcs).pipe(Effect.provideContext(protocol));
    return { client, lost: incarnation.lost, terminate: incarnation.terminate };
  }).pipe(Effect.orDie);
