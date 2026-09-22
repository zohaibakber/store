import type { SyncCommandEnvelope, SyncEntity } from "@store/contracts";
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
import type { ReplicaRowInvalid, UnsupportedSubsetQuery } from "./errors";
import type {
  InventoryCollectionSource,
  InventoryCollectionSyncMode,
} from "./sources";
import type { OutboxCommandStatus, SqliteResultRow } from "./sqlite-row";

export type InventoryCollectionRow =
  | CategoryRow
  | ProductRow
  | BatchRow
  | InvoiceRow
  | InvoiceItemRow
  | StockMovementRow;

export type SqliteParameter = string | number | bigint | null | Uint8Array;

export type { SqliteResultRow };

export type SqliteSubsetPlan = {
  readonly source: InventoryCollectionSource;
  readonly sql: string;
  readonly parameters: ReadonlyArray<SqliteParameter>;
  readonly maximumRows: number;
};

export type IndexedDbSubsetPlan = import("@store/sync/replica/indexeddb").IndexedDbSubsetPlan;

export type ReplicaCommitNotice = {
  readonly workspaceToken: string;
  readonly generationId: string;
  readonly localCommitVersion: number;
  readonly touchedEntities: ReadonlyArray<SyncEntity>;
  readonly touchedKeys: ReadonlyArray<string>;
};

export type ReplicaChangeUnsubscribe = () => void;

export interface ReplicaChangeFeed {
  readonly subscribe: (listener: (notice: ReplicaCommitNotice) => void) => ReplicaChangeUnsubscribe;
}

export type ReplicaQueryStamp = {
  readonly workspaceToken: string;
  readonly generationId: string;
  readonly localCommitVersion: number;
};

export type ReplicaQueryExecutor = {
  readonly stamp: () => ReplicaQueryStamp | Promise<ReplicaQueryStamp>;
};

export type ReplicaSubsetRead = {
  readonly stamp: ReplicaQueryStamp;
  readonly rows: ReadonlyArray<SqliteResultRow>;
};

export interface ReplicaSqlExecutor extends ReplicaQueryExecutor {
  readonly query: (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ) => ReadonlyArray<SqliteResultRow> | Promise<ReadonlyArray<SqliteResultRow>>;
  readonly queryStamped?: (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ) => ReplicaSubsetRead | Promise<ReplicaSubsetRead>;
}

export type ReplicaCollectionExecutor = ReplicaSqlExecutor & {
  readonly querySubset?: (
    plan: IndexedDbSubsetPlan,
  ) => ReplicaSubsetRead | Promise<ReplicaSubsetRead>;
};

export const isReplicaIndexedDbExecutor = (
  executor: ReplicaCollectionExecutor,
): executor is ReplicaSqlExecutor & {
  readonly querySubset: (
    plan: IndexedDbSubsetPlan,
  ) => ReplicaSubsetRead | Promise<ReplicaSubsetRead>;
} => typeof executor.querySubset === "function";

export type ReplicaHandleIdentity = {
  readonly workspaceToken: string;
  readonly engine?: "sqlite" | "indexeddb";
};

export type ReplicaHandleLifecycle = {
  readonly close: () => void;
};

export type ReplicaMutationSurface = {
  readonly readOutboxStatuses?: () => Promise<ReadonlyArray<OutboxCommandStatus>>;
  readonly readCommandAllocation?: () => Promise<{
    readonly epoch: string;
    readonly nextClientSequence: string;
  }>;
  readonly enqueueLocal?: (
    envelope: SyncCommandEnvelope,
    createdAt: number,
  ) => Promise<{
    readonly changed: boolean;
    readonly status: string;
  }>;
  readonly wakeSyncUpload?: () => void;
};

export type ReplicaHandle = ReplicaHandleIdentity &
  ReplicaHandleLifecycle &
  ReplicaCollectionExecutor &
  ReplicaChangeFeed &
  ReplicaMutationSurface & {
    readonly publish: (notice: ReplicaCommitNotice) => void;
  };

export type ReplicaSqliteHandle = ReplicaHandle;

export type InventoryCollectionDescriptor<Row extends InventoryCollectionRow> = {
  readonly id: string;
  readonly source: InventoryCollectionSource;
  readonly syncMode: InventoryCollectionSyncMode;
  readonly maximumRows: number;
  readonly getKey: (row: Row) => string;
  readonly decodeRows: (
    rows: ReadonlyArray<SqliteResultRow>,
  ) => Effect.Effect<ReadonlyArray<Row>, ReplicaRowInvalid>;
};

export type SqliteCollectionDependencies = {
  readonly executor: ReplicaCollectionExecutor;
  readonly changeFeed: ReplicaChangeFeed;
  readonly coherence?: import("./coherence").InvoiceCoherenceGate;
};

export type SqliteCollectionConfig<Row extends InventoryCollectionRow> = CollectionConfig<
  Row,
  string
> & {
  readonly utils: {
    readonly loadSubset: (options: LoadSubsetOptions) => true | Promise<void>;
    readonly unloadSubset: (options: LoadSubsetOptions) => void;
  };
};

export type CompileSubsetInput = {
  readonly where?: IR.BasicExpression<boolean>;
  readonly orderBy?: IR.OrderBy;
  readonly limit?: number;
  readonly offset?: number;
  readonly cursor?: LoadSubsetOptions["cursor"];
};

export type CompileSqliteSubset = <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  options: CompileSubsetInput,
) => Effect.Effect<SqliteSubsetPlan, UnsupportedSubsetQuery>;
