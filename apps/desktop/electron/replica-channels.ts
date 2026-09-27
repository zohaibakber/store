import type { ElectronReplicaBridge } from "@store/client-db";

export const REPLICA_OPEN_CHANNEL = "replica:open";
export const REPLICA_CLOSE_CHANNEL = "replica:close";
export const REPLICA_STAMP_CHANNEL = "replica:stamp";
export const REPLICA_READ_SUBSET_CHANNEL = "replica:read-subset";
export const REPLICA_WAKE_CHANNEL = "replica:wake";
export const REPLICA_OUTBOX_CHANNEL = "replica:outbox";
export const REPLICA_ALLOCATION_CHANNEL = "replica:allocation";
export const REPLICA_ENQUEUE_CHANNEL = "replica:enqueue";
export const REPLICA_COMMIT_CHANNEL = "replica:commit";
export const REPLICA_SYNC_HEALTH_CHANNEL = "replica:sync-health";

export type ReplicaIpcBridge = ElectronReplicaBridge;

export type ReplicaCommitEvent = Parameters<Parameters<ReplicaIpcBridge["onCommit"]>[0]>[0];

export type ReplicaSyncHealthEvent = {
  readonly workspaceToken: string;
  readonly health: Parameters<Parameters<ReplicaIpcBridge["onSyncHealth"]>[1]>[0];
};
