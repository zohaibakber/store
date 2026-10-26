import type { WorkspaceAtoms } from "./atoms";
import type { CatalogCommands } from "./catalog-commands";
import type { ReplicaAuthority } from "./host";
import type { StaffActions } from "./staff";

export type Inventory = {
  readonly actions: InventoryActions;
  readonly atoms: WorkspaceAtoms;
  readonly authority: ReplicaAuthority;
  readonly deviceId: string;
};

export interface InventoryActions extends CatalogCommands {
  readonly retrySync: () => Promise<void>;
  readonly staff: StaffActions;
  readonly syncNow: () => void;
}

export type InventoryState =
  | { readonly _tag: "Opening" }
  | { readonly _tag: "Ready"; readonly inventory: Inventory }
  | { readonly _tag: "Error"; readonly error: string; readonly retry: () => void };
