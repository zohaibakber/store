import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner";
import * as Layer from "effect/Layer";
import * as RpcServer from "effect/unstable/rpc/RpcServer";

import { ReplicaWorkerRpcs } from "./replica-rpc";
import { makeReplicaWorkerHandlers } from "./replica-worker-handlers";

RpcServer.layer(ReplicaWorkerRpcs).pipe(
  Layer.provide(makeReplicaWorkerHandlers()),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
  Layer.launch,
  NodeRuntime.runMain,
);
