import type { ReplicaHandle } from "@store/client-db";
import { LOCAL_ORGANIZATION_ID } from "@store/contracts";

export type InventoryScope = {
  readonly organizationId: string;
  readonly userId: string;
};

export type ReplicaAuthority = "local" | "remote";

export const replicaAuthorityOf = (scope: { readonly organizationId: string }): ReplicaAuthority =>
  scope.organizationId === LOCAL_ORGANIZATION_ID ? "local" : "remote";

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
