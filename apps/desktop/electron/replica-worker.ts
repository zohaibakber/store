// Must stay the first import: parsers created before it run on the interpreter.
import "effect/schema/SchemaJITCompiler/enable";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner";
import * as Layer from "effect/Layer";
import * as RpcServer from "effect/rpc/RpcServer";
import * as RpcWorker from "effect/rpc/RpcWorker";

import { ReplicaWorkerBoot, ReplicaWorkerRpcs, WORKER_RPC_CONCURRENCY } from "./replica-rpc";
import { makeReplicaWorkerHandlers } from "./replica-worker-handlers";
import { layerWorkerSentry } from "./sentry-worker";

RpcServer.layer(ReplicaWorkerRpcs, { concurrency: WORKER_RPC_CONCURRENCY }).pipe(
  Layer.provide(makeReplicaWorkerHandlers(RpcWorker.initialMessage(ReplicaWorkerBoot))),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
  Layer.provide(layerWorkerSentry),
  Layer.launch,
  NodeRuntime.runMain,
);
