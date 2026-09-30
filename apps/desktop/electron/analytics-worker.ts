import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner";
import * as Layer from "effect/Layer";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import * as RpcWorker from "effect/unstable/rpc/RpcWorker";

import { ANALYTICS_WORKER_RPC_CONCURRENCY } from "./analytics-admission";
import { AnalyticsWorkerBoot, AnalyticsWorkerRpcs } from "./analytics-rpc";
import { makeAnalyticsWorkerHandlers } from "./analytics-worker-handlers";

RpcServer.layer(AnalyticsWorkerRpcs, { concurrency: ANALYTICS_WORKER_RPC_CONCURRENCY }).pipe(
  Layer.provide(makeAnalyticsWorkerHandlers(RpcWorker.initialMessage(AnalyticsWorkerBoot))),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
  Layer.launch,
  NodeRuntime.runMain,
);
