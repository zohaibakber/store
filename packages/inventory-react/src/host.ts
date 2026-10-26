import { LOCAL_ORGANIZATION_ID, type OrganizationId, type UserId } from "@store/contracts";
import type * as Effect from "effect/Effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type * as Scope from "effect/Scope";

import type { CatalogOpenFailure } from "./errors";
import type { InventoryServices } from "./services";

export type InventoryScope = {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
};

export type ReplicaAuthority = "local" | "remote";

export const replicaAuthorityOf = (scope: {
  readonly organizationId: OrganizationId;
}): ReplicaAuthority => (scope.organizationId === LOCAL_ORGANIZATION_ID ? "local" : "remote");

export type ReplicaOpenIdentity = InventoryScope & {
  readonly replicaId: string;
};

export type OpenedReplica = {
  readonly services: InventoryServices;
  readonly replicaId?: string;
  readonly retryRecovery: Effect.Effect<void>;
};

export interface InventoryHost {
  readonly apiBaseUrl: string;
  readonly deviceId: string;
  readonly open: (
    identity: ReplicaOpenIdentity,
    registry: AtomRegistry.AtomRegistry,
  ) => Effect.Effect<OpenedReplica, CatalogOpenFailure, Scope.Scope>;
}
