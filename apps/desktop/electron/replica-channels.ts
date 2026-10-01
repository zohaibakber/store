import type { ElectronReplicaBridge } from "@store/client-db";

export const REPLICA_OPEN_CHANNEL = "replica:open";
export const REPLICA_CLOSE_CHANNEL = "replica:close";
export const REPLICA_STAMP_CHANNEL = "replica:stamp";
export const REPLICA_READ_SUBSET_CHANNEL = "replica:read-subset";
export const REPLICA_READ_BATCH_CHANNEL = "replica:read-batch";
export const REPLICA_CANCEL_READ_CHANNEL = "replica:cancel-read";
export const REPLICA_RETRY_CHANNEL = "replica:retry";
export const REPLICA_READ_INSIGHTS_CHANNEL = "replica:read-insights";
export const REPLICA_SUMMARIZE_SUBSET_CHANNEL = "replica:summarize-subset";
export const REPLICA_WAKE_CHANNEL = "replica:wake";
export const REPLICA_OUTBOX_CHANNEL = "replica:outbox";
export const REPLICA_ACTIVITY_CHANNEL = "replica:activity";
export const REPLICA_COMMAND_STATUS_CHANNEL = "replica:command-status";
export const REPLICA_ENQUEUE_CHANNEL = "replica:enqueue";
export const REPLICA_INSIGHTS_SUMMARY_CHANNEL = "replica:insights-summary";
export const REPLICA_PRODUCT_INSIGHTS_CHANNEL = "replica:product-insights";
export const REPLICA_RESTOCK_PAGE_CHANNEL = "replica:restock-page";
export const REPLICA_ANALYTICS_CHANNEL = "replica:analytics";
export const REPLICA_COMMIT_CHANNEL = "replica:commit";
export const REPLICA_SYNC_HEALTH_CHANNEL = "replica:sync-health";

export type ReplicaIpcBridge = ElectronReplicaBridge;

export type ReplicaCommitEvent = Parameters<Parameters<ReplicaIpcBridge["onCommit"]>[0]>[0];

export type ReplicaSyncHealthEvent = {
  readonly workspaceToken: string;
  readonly health: Parameters<Parameters<ReplicaIpcBridge["onSyncHealth"]>[1]>[0];
};

export type ReplicaAnalyticsEvent = {
  readonly workspaceToken: string;
  readonly revision: number;
  readonly state: "idle" | "building" | "refreshing";
  readonly progress: { readonly done: number; readonly total: number } | null;
};
