import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner";
import * as Layer from "effect/Layer";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import * as RpcWorker from "effect/unstable/rpc/RpcWorker";

import { READER_RPC_CONCURRENCY } from "./replica-admission";
import { makeReplicaReaderHandlers } from "./replica-reader-handlers";
import { ReplicaReaderBoot, ReplicaReaderRpcs } from "./replica-rpc";

RpcServer.layer(ReplicaReaderRpcs, { concurrency: READER_RPC_CONCURRENCY }).pipe(
  Layer.provide(makeReplicaReaderHandlers(RpcWorker.initialMessage(ReplicaReaderBoot))),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
  Layer.launch,
  NodeRuntime.runMain,
);
