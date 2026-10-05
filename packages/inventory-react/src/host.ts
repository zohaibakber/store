import type * as Effect from "effect/Effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type * as Scope from "effect/Scope";

import type { CatalogOpenFailure } from "./errors";
import type { InventoryServices } from "./services";

export type InventoryScope = {
  readonly organizationId: string;
  readonly userId: string;
};

export type ReplicaOpenIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

export type OpenedReplica = {
  readonly replicaId?: string;
  readonly retryRecovery: Effect.Effect<void>;
};

export interface InventoryHost {
  readonly apiBaseUrl: string;
  readonly deviceId: string;
  readonly services: InventoryServices;
  readonly open: (
    identity: ReplicaOpenIdentity,
    registry: AtomRegistry.AtomRegistry,
  ) => Effect.Effect<OpenedReplica, CatalogOpenFailure, Scope.Scope>;
}
