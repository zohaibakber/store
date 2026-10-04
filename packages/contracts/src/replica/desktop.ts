import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

export const REPLICA_PORTS_CHANNEL = "replica:ports";

export const REPLICA_PORT_ROLES = ["reads", "store", "desktop", "insights"] as const;
export type ReplicaPortRole = (typeof REPLICA_PORT_ROLES)[number];

export const ReplicaPortsMessage = Schema.Struct({
  type: Schema.Literal(REPLICA_PORTS_CHANNEL),
  generation: Schema.Natural,
  workspaceToken: Schema.String,
  roles: Schema.Array(Schema.Literals(REPLICA_PORT_ROLES)),
});
export type ReplicaPortsMessage = typeof ReplicaPortsMessage.Type;

export const WorkerPhase = Schema.Literals([
  "starting",
  "running",
  "recovering",
  "exhausted",
  "unavailable",
]);
export type WorkerPhase = typeof WorkerPhase.Type;

export const WorkspaceState = Schema.Struct({ writer: WorkerPhase, reader: WorkerPhase });
export type WorkspaceState = typeof WorkspaceState.Type;

export class DesktopRpcs extends RpcGroup.make(
  Rpc.make("WorkspaceState", { success: WorkspaceState, stream: true }),
) {}
