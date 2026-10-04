import type {
  CommandStatus,
  EnqueueCommandRequest,
  ReplicaInsightsFacts,
  ReplicaInsightsWindow,
  SyncEntity,
} from "@store/contracts";

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
import type { ReplicaSyncActivity } from "./activity";
import type { ReplicaRow, SqliteResultRow } from "./sqlite-row";
import type { ReplicaSyncHealth } from "./status";
import type {
  InventorySubsetSpec,
  InventorySubsetSummary,
  InventorySubsetSummarySpec,
} from "./subset-spec";

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

export type ReplicaChangeUnsubscribe = () => void;

export interface ReplicaChangeFeed {
  readonly subscribe: (listener: (notice: ReplicaCommitNotice) => void) => ReplicaChangeUnsubscribe;
}

interface ReplicaSyncHealthFeed {
  readonly subscribeSyncHealth?: (
    listener: (health: ReplicaSyncHealth) => void,
  ) => ReplicaChangeUnsubscribe;
}

export type ReplicaQueryStamp = {
  readonly workspaceToken: string;
  readonly generationId: string;
  readonly localCommitVersion: number;
};

export type ReplicaSubsetRead = {
  readonly stamp: ReplicaQueryStamp;
  readonly rows: ReadonlyArray<ReplicaRow>;
};

export type ReplicaReadOptions = {
  readonly signal?: AbortSignal;
};

export type ReplicaBatchRead = {
  readonly stamp: ReplicaQueryStamp;
  readonly reads: ReadonlyArray<ReadonlyArray<ReplicaRow>>;
};

export interface ReplicaSubsetReader {
  readonly readSubset: (
    spec: InventorySubsetSpec,
    options?: ReplicaReadOptions,
  ) => Promise<ReplicaSubsetRead>;
  readonly readBatch: (
    specs: ReadonlyArray<InventorySubsetSpec>,
    options?: ReplicaReadOptions,
  ) => Promise<ReplicaBatchRead>;
}

export type ReplicaSummaryRead = {
  readonly stamp: ReplicaQueryStamp;
  readonly summary: InventorySubsetSummary;
};

export interface ReplicaSummaryReader {
  readonly summarizeSubset: (spec: InventorySubsetSummarySpec) => Promise<ReplicaSummaryRead>;
}

export type ReplicaInsightsRead = {
  readonly stamp: ReplicaQueryStamp;
  readonly facts: ReplicaInsightsFacts;
};

export interface ReplicaInsightsReader {
  readonly readInsights: (window: ReplicaInsightsWindow) => Promise<ReplicaInsightsRead>;
}

type ReplicaHandleIdentity = {
  readonly workspaceToken: string;
  readonly engine?: "sqlite";
};

type ReplicaHandleLifecycle = {
  readonly close: () => Promise<void>;
  readonly retryRecovery?: () => Promise<void>;
};

export type EnqueuedCommand = {
  readonly operationId: string;
  readonly status: CommandStatus;
  readonly stamp: ReplicaQueryStamp;
};

type ReplicaMutationSurface = {
  readonly enqueueCommand: (request: EnqueueCommandRequest) => Promise<EnqueuedCommand>;
  readonly readCommandStatus: (operationId: string) => Promise<CommandStatus | undefined>;
  readonly wakeSyncUpload?: () => void;
};

type ReplicaActivitySurface = {
  readonly replicaId?: string;
  readonly readSyncActivity: () => Promise<ReplicaSyncActivity>;
  readonly readPendingRowIds?: (entity: SyncEntity) => Promise<ReadonlyArray<string>>;
};

export type ReplicaHandle = ReplicaHandleIdentity &
  ReplicaHandleLifecycle &
  ReplicaSubsetReader &
  ReplicaInsightsReader &
  ReplicaSummaryReader &
  ReplicaChangeFeed &
  ReplicaSyncHealthFeed &
  ReplicaMutationSurface &
  ReplicaActivitySurface & {
    readonly stamp: () => Promise<ReplicaQueryStamp>;
  };
