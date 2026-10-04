import { InventoryReads, ReplicaUnavailable } from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";

const READ_DEADLINE = "20 seconds";

export class ReadDeadline extends RpcMiddleware.Service<ReadDeadline>()(
  "@store/desktop/ReadDeadline",
  { error: ReplicaUnavailable },
) {}

export const TimedInventoryReads = InventoryReads.middleware(ReadDeadline);

export const readDeadline: ReadDeadline["Service"] = (effect) =>
  Effect.timeoutOrElse(effect, {
    duration: READ_DEADLINE,
    orElse: () => Effect.fail(new ReplicaUnavailable({ reason: "busy" })),
  });
