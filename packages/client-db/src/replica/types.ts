import type { SyncEntity } from "@store/contracts";
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
  NamedProjectionName,
} from "./sources";
import type { SqliteResultRow } from "./sqlite-row";

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

export interface ReplicaSqlExecutor {
  readonly stamp: () => ReplicaQueryStamp;
  readonly query: (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ) => ReadonlyArray<SqliteResultRow>;
}

export type ReplicaSqliteHandle = ReplicaSqlExecutor &
  ReplicaChangeFeed & {
    readonly workspaceToken: string;
    readonly close: () => void;
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

export type InventoryProjectionDescriptor<Row extends InventoryCollectionRow> = {
  readonly id: string;
  readonly name: NamedProjectionName;
  readonly sql: string;
  readonly parameters: ReadonlyArray<SqliteParameter>;
  readonly maximumRows: number;
  readonly touchedEntities: ReadonlyArray<SyncEntity>;
  readonly getKey: (row: Row) => string;
  readonly decodeRows: (
    rows: ReadonlyArray<SqliteResultRow>,
  ) => Effect.Effect<ReadonlyArray<Row>, ReplicaRowInvalid>;
};

export type SqliteCollectionDependencies = {
  readonly executor: ReplicaSqlExecutor;
  readonly changeFeed: ReplicaChangeFeed;
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
