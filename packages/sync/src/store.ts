import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import { makeMemoryReplicaStore, type ReplicaStoreApi } from "./persistence";

export class ReplicaStore extends Context.Service<ReplicaStore, ReplicaStoreApi>()(
  "store/ReplicaStore",
) {
  static memory = Layer.succeed(ReplicaStore, ReplicaStore.of(makeMemoryReplicaStore()));
}

export { makeMemoryReplicaStore } from "./persistence";
export type { ReplicaStoreApi, ReplicaStoreSnapshot, ReplicaStoreTransaction } from "./persistence";
