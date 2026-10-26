import type { WorkspaceAtoms } from "./atoms";
import type { WorkspaceCommands } from "./commands";
import type { ReplicaAuthority } from "./host";

export type Inventory = {
  readonly commands: WorkspaceCommands;
  readonly atoms: WorkspaceAtoms;
  readonly authority: ReplicaAuthority;
  readonly deviceId: string;
};

export type InventoryState =
  | { readonly _tag: "Opening" }
  | { readonly _tag: "Ready"; readonly inventory: Inventory }
  | { readonly _tag: "Error"; readonly error: string; readonly retry: () => void };
