import type { SyncCommandEnvelope, SyncEntity } from "@store/contracts";
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
import type { OutboxCommandStatus, SqliteResultRow } from "./sqlite-row";
import type { ReplicaSyncHealth } from "./status";
import type { InventorySubsetSpec } from "./subset-spec";

export type InventoryCollectionRow =
  | CategoryRow
  | ProductRow
  | BatchRow
  | InvoiceRow
  | InvoiceItemRow
  | StockMovementRow;

export type SqliteParameter = string | number | bigint | null | Uint8Array;

export type { SqliteResultRow };

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
  readonly rows: ReadonlyArray<SqliteResultRow>;
};

export interface ReplicaSubsetReader {
  readonly readSubset: (spec: InventorySubsetSpec) => Promise<ReplicaSubsetRead>;
}

export type ReplicaHandleIdentity = {
  readonly workspaceToken: string;
  readonly engine?: "sqlite" | "indexeddb";
};

export type ReplicaHandleLifecycle = {
  readonly close: () => void;
};

export type ReplicaMutationSurface = {
  readonly readOutboxStatuses: () => Promise<ReadonlyArray<OutboxCommandStatus>>;
  readonly readCommandAllocation: () => Promise<{
    readonly epoch: string;
    readonly nextClientSequence: string;
  }>;
  readonly enqueueLocal: (
    envelope: SyncCommandEnvelope,
    createdAt: number,
  ) => Promise<{
    readonly changed: boolean;
    readonly status: string;
  }>;
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
  ReplicaChangeFeed &
  ReplicaSyncHealthFeed &
  ReplicaMutationSurface &
  ReplicaActivitySurface & {
    readonly stamp: () => Promise<ReplicaQueryStamp>;
    readonly publish: (notice: ReplicaCommitNotice) => void;
  };

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
  readonly executor: ReplicaSubsetReader;
  readonly changeFeed: ReplicaChangeFeed;
  readonly coherence?: InvoiceCoherenceGate;
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
