import type { CatalogCommands } from "@store/client-db";

import type { WorkspaceAtoms } from "./atoms";
import type { StaffActions } from "./staff";

export type Inventory = {
  readonly actions: InventoryActions;
  readonly atoms: WorkspaceAtoms;
  readonly deviceId: string;
  readonly dispose: () => Promise<void>;
};

export interface InventoryActions extends CatalogCommands {
  readonly retrySync: () => Promise<void>;
  readonly staff: StaffActions;
  readonly syncNow: () => void;
}

export type InventoryState =
  | { readonly _tag: "Opening" }
  | { readonly _tag: "Ready"; readonly inventory: Inventory; readonly actions: InventoryActions }
  | { readonly _tag: "Error"; readonly error: string; readonly retry: () => void };
