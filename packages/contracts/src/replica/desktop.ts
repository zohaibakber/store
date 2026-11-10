import * as Schema from "effect/Schema";

export const REPLICA_PORTS_CHANNEL = "replica:ports";

export const REPLICA_PORT_ROLES = ["reads", "store", "insights"] as const;
export type ReplicaPortRole = (typeof REPLICA_PORT_ROLES)[number];

export const WorkspaceToken = Schema.NonEmptyString.pipe(Schema.brand("WorkspaceToken"));
export type WorkspaceToken = typeof WorkspaceToken.Type;

export const ReplicaPortsMessage = Schema.Struct({
  type: Schema.Literal(REPLICA_PORTS_CHANNEL),
  generation: Schema.Natural,
  workspaceToken: WorkspaceToken,
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
