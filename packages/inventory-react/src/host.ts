import type { ReplicaHandle } from "@store/client-db";

export type InventoryScope = {
  readonly organizationId: string;
  readonly userId: string;
};

export type ReplicaOpenIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

export interface InventoryHost {
  readonly apiBaseUrl: string;
  readonly deviceId: string;
  readonly openReplica: (identity: ReplicaOpenIdentity) => Promise<ReplicaHandle>;
}
