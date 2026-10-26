import { makeCatalogs, type Catalogs, type InventoryHost } from "@store/inventory-react";

export type HostInventory =
  | { readonly _tag: "Replica"; readonly catalogs: Catalogs }
  | { readonly _tag: "Unavailable" };

export const hostInventoryOf = (host: InventoryHost | undefined): HostInventory =>
  host === undefined ? { _tag: "Unavailable" } : { _tag: "Replica", catalogs: makeCatalogs(host) };
