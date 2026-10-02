import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner";
import * as Layer from "effect/Layer";
import * as RpcServer from "effect/rpc/RpcServer";
import * as RpcWorker from "effect/rpc/RpcWorker";

import { makeReplicaReaderHandlers } from "./replica-reader-handlers";
import { READER_RPC_CONCURRENCY, ReplicaReaderBoot, ReplicaReaderRpcs } from "./replica-rpc";
import { layerWorkerSentry } from "./sentry-worker";

RpcServer.layer(ReplicaReaderRpcs, { concurrency: READER_RPC_CONCURRENCY }).pipe(
  Layer.provide(makeReplicaReaderHandlers(RpcWorker.initialMessage(ReplicaReaderBoot))),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
  Layer.provide(layerWorkerSentry),
  Layer.launch,
  NodeRuntime.runMain,
);
