import type {
  BatchRow,
  CatalogActor,
  CatalogCommands,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
  StockMovementRow,
  SupplierRow,
} from "@store/client-db";
import type { Collection, DbClient } from "@tanstack/react-db";

import type { WorkspaceAtoms } from "./atoms";
import type { ReplicaAuthority } from "./host";

type InventoryCollection<Row extends { readonly id: string }> = Collection<Row, string>;

export type Inventory = {
  readonly batches: InventoryCollection<BatchRow>;
  readonly categories: InventoryCollection<CategoryRow>;
  readonly dbClient: DbClient;
  readonly invoiceItems: InventoryCollection<InvoiceItemRow>;
  readonly invoices: InventoryCollection<InvoiceRow>;
  readonly products: InventoryCollection<ProductRow>;
  readonly purchaseOrderItems: InventoryCollection<PurchaseOrderItemRow>;
  readonly purchaseOrders: InventoryCollection<PurchaseOrderRow>;
  readonly stockMovements: InventoryCollection<StockMovementRow>;
  readonly suppliers: InventoryCollection<SupplierRow>;
  readonly actions: InventoryActions;
  readonly atoms: WorkspaceAtoms;
  readonly authority: ReplicaAuthority;
  readonly dispose: () => Promise<void>;
};

export type InventoryActor = CatalogActor;

export type { ImportInventoryRequest } from "@store/client-db";

export interface InventoryActions extends CatalogCommands {
  readonly retrySync: () => Promise<void>;
  readonly syncNow: () => void;
}

export type InventoryState =
  | { readonly _tag: "Opening" }
  | { readonly _tag: "Ready"; readonly inventory: Inventory; readonly actions: InventoryActions }
  | { readonly _tag: "Error"; readonly error: string; readonly retry: () => void };
