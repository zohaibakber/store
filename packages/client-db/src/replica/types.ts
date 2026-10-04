import type { SyncEntity } from "@store/contracts";

import type {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
  StockMovementRow,
  SupplierRow,
} from "../rows";
import type { ReplicaRow, SqliteResultRow } from "./sqlite-row";
import type { InventorySubsetSummary } from "./subset-spec";

export type CatalogRows = {
  readonly categories: CategoryRow;
  readonly products: ProductRow;
  readonly batches: BatchRow;
  readonly invoices: InvoiceRow;
  readonly invoiceItems: InvoiceItemRow;
  readonly stockMovements: StockMovementRow;
  readonly suppliers: SupplierRow;
  readonly purchaseOrders: PurchaseOrderRow;
  readonly purchaseOrderItems: PurchaseOrderItemRow;
};

export type SqliteParameter = string | number | bigint | null | Uint8Array;

export type { ReplicaRow, SqliteResultRow };

export type ReplicaCommitNotice = {
  readonly workspaceToken: string;
  readonly generationId: string;
  readonly localCommitVersion: number;
  readonly touchedEntities: ReadonlyArray<SyncEntity>;
  readonly touchedKeys: ReadonlyArray<string>;
  readonly fullInvalidation?: boolean;
  readonly overflowedEntities?: ReadonlyArray<SyncEntity>;
};

export type ReplicaQueryStamp = {
  readonly workspaceToken: string;
  readonly generationId: string;
  readonly localCommitVersion: number;
};

export type ReplicaSubsetRead = {
  readonly stamp: ReplicaQueryStamp;
  readonly rows: ReadonlyArray<ReplicaRow>;
};

export type ReplicaBatchRead = {
  readonly stamp: ReplicaQueryStamp;
  readonly reads: ReadonlyArray<ReadonlyArray<ReplicaRow>>;
};

export type ReplicaSummaryRead = {
  readonly stamp: ReplicaQueryStamp;
  readonly summary: InventorySubsetSummary;
};
