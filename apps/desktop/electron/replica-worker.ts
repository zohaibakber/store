import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner";
import * as Layer from "effect/Layer";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import * as RpcWorker from "effect/unstable/rpc/RpcWorker";

import { WORKER_RPC_CONCURRENCY } from "./replica-admission";
import { ReplicaWorkerBoot, ReplicaWorkerRpcs } from "./replica-rpc";
import { makeReplicaWorkerHandlers } from "./replica-worker-handlers";

RpcServer.layer(ReplicaWorkerRpcs, { concurrency: WORKER_RPC_CONCURRENCY }).pipe(
  Layer.provide(makeReplicaWorkerHandlers(RpcWorker.initialMessage(ReplicaWorkerBoot))),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
  Layer.launch,
  NodeRuntime.runMain,
);
