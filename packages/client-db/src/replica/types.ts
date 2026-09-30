import type {
  CommandStatus,
  EnqueueCommandRequest,
  InsightsContext,
  InsightsSummaryRead,
  ProductInsightsRead,
  ReplicaInsightsFacts,
  RestockPageRead,
  RestockPageRequest,
  ReplicaInsightsWindow,
  SyncEntity,
} from "@store/contracts";
import type { ReplicaOutboxActivity } from "@store/sync/browser";
import { IR, type CollectionConfig, type LoadSubsetOptions } from "@tanstack/db";
import type * as Effect from "effect/Effect";

import type {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "../rows";
import type { InvoiceCoherenceGate } from "./coherence";
import type { ReplicaRowInvalid } from "./errors";
import type { InventoryCollectionSource, InventoryCollectionSyncMode } from "./sources";
import type { OutboxCommandStatus, ReplicaRow, SqliteResultRow } from "./sqlite-row";
import type { ReplicaSyncHealth } from "./status";
import type {
  InventorySubsetSpec,
  InventorySubsetSummary,
  InventorySubsetSummarySpec,
} from "./subset-spec";

export type InventoryCollectionRow =
  | CategoryRow
  | ProductRow
  | BatchRow
  | InvoiceRow
  | InvoiceItemRow
  | StockMovementRow;

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

export interface ReplicaSyncHealthFeed {
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
  readonly readBatch?: (
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

export type ReplicaAnalyticsChange = {
  readonly revision: number;
  readonly state: "idle" | "building" | "refreshing";
  readonly progress: { readonly done: number; readonly total: number } | null;
};

export interface ReplicaAnalytics {
  readonly readSummary: (context: InsightsContext) => Promise<InsightsSummaryRead>;
  readonly readProducts: (
    context: InsightsContext,
    ids: ReadonlyArray<string>,
  ) => Promise<ProductInsightsRead>;
  readonly readRestockPage: (
    context: InsightsContext,
    request: RestockPageRequest,
  ) => Promise<RestockPageRead>;
  readonly subscribe: (listener: (change: ReplicaAnalyticsChange) => void) => () => void;
}

type ReplicaHandleIdentity = {
  readonly workspaceToken: string;
  readonly engine?: "sqlite" | "indexeddb";
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
  readonly readOutboxStatuses: () => Promise<ReadonlyArray<OutboxCommandStatus>>;
  readonly enqueueCommand: (request: EnqueueCommandRequest) => Promise<EnqueuedCommand>;
  readonly readCommandStatus: (operationId: string) => Promise<CommandStatus | undefined>;
  readonly wakeSyncUpload?: () => void;
};

export type ReplicaActivitySurface = {
  readonly replicaId?: string;
  readonly readOutboxActivity?: () => Promise<ReplicaOutboxActivity>;
  readonly readPendingRowIds?: (entity: SyncEntity) => Promise<ReadonlyArray<string>>;
};

export type ReplicaHandle = ReplicaHandleIdentity &
  ReplicaHandleLifecycle &
  ReplicaSubsetReader &
  ReplicaInsightsReader & { readonly analytics?: ReplicaAnalytics } & ReplicaSummaryReader &
  ReplicaChangeFeed &
  ReplicaSyncHealthFeed &
  ReplicaMutationSurface &
  ReplicaActivitySurface & {
    readonly stamp: () => Promise<ReplicaQueryStamp>;
  };

export type InventoryCollectionDescriptor<Row extends InventoryCollectionRow> = {
  readonly id: string;
  readonly source: InventoryCollectionSource;
  readonly syncMode: InventoryCollectionSyncMode;
  readonly maximumRows: number;
  readonly getKey: (row: Row) => string;
  readonly decodeRows: (
    rows: ReadonlyArray<ReplicaRow>,
  ) => Effect.Effect<ReadonlyArray<Row>, ReplicaRowInvalid>;
};

export type SqliteCollectionDependencies = {
  readonly executor: ReplicaSubsetReader;
  readonly changeFeed: ReplicaChangeFeed;
  readonly coherence?: InvoiceCoherenceGate;
};

export type SqliteCollectionConfig<Row extends InventoryCollectionRow> = CollectionConfig<
  Row,
  string
>;

export type CompileSubsetInput = {
  readonly where?: IR.BasicExpression<boolean>;
  readonly orderBy?: IR.OrderBy;
  readonly limit?: number;
  readonly offset?: number;
  readonly cursor?: LoadSubsetOptions["cursor"];
};
