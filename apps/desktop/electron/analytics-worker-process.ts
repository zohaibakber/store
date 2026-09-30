import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcWorker from "effect/unstable/rpc/RpcWorker";

import { ANALYTICS_WORKER_RPC_CONCURRENCY } from "./analytics-admission";
import { AnalyticsWorkerBoot, AnalyticsWorkerRpcs } from "./analytics-rpc";
import type { SpawnAnalyticsWorker } from "./analytics-supervisor";
import { makeNodeWorkerIncarnation } from "./replica-worker-process";

export const spawnNodeAnalyticsWorker: SpawnAnalyticsWorker = ({ workerPath, boot }) =>
  Effect.gen(function* () {
    const incarnation = yield* makeNodeWorkerIncarnation(workerPath);
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolWorker({
        size: 1,
        concurrency: ANALYTICS_WORKER_RPC_CONCURRENCY,
      }).pipe(
        Layer.provide(incarnation.layer),
        Layer.provide(RpcWorker.layerInitialMessage(AnalyticsWorkerBoot, Effect.succeed(boot))),
      ),
    );
    const client = yield* RpcClient.make(AnalyticsWorkerRpcs).pipe(Effect.provideContext(protocol));
    return { client, lost: incarnation.lost };
  }).pipe(Effect.orDie);
