import type { InventoryHost } from "@store/inventory-react";

export type HostInventory =
  | { readonly _tag: "Replica"; readonly host: InventoryHost }
  | { readonly _tag: "Unavailable" }
  | { readonly _tag: "NoReplica" };

export const NO_REPLICA: HostInventory = { _tag: "NoReplica" };

export const hostInventoryOf = (host: InventoryHost | undefined): HostInventory =>
  host === undefined ? { _tag: "Unavailable" } : { _tag: "Replica", host };
