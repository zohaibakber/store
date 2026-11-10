import { LOCAL_ORGANIZATION_ID, type OrganizationId, type UserId } from "@store/contracts";
import type * as Effect from "effect/Effect";

import type { InventoryServices } from "./services";

export type InventoryScope = {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
};

export type ReplicaAuthority = "local" | "remote";

export const replicaAuthorityOf = (scope: {
  readonly organizationId: OrganizationId;
}): ReplicaAuthority => (scope.organizationId === LOCAL_ORGANIZATION_ID ? "local" : "remote");

export type OpenedReplica = {
  readonly services: InventoryServices;
  readonly retryRecovery: Effect.Effect<void>;
};
