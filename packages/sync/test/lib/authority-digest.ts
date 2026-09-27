import {
  rowImageDigest,
  type PartitionDigest,
  type SnapshotRow,
  type SyncLogChange,
  type SyncTransactionGroup,
} from "@store/contracts";
import * as Schema from "effect/Schema";

const RowCell = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);
const decodeRowCells = Schema.decodeUnknownSync(Schema.Record(Schema.String, RowCell));

type AuthorityRowCells = typeof RowCell.Type;

const postgresRowImage = (change: SyncLogChange): Record<string, AuthorityRowCells> => {
  const { deletedAt: _deletedAt, ...live } = decodeRowCells(change.row);
  return change.entity === "category" ? live : { ...live, deletedAt: null };
};

export type AuthorityPartition = Map<string, SnapshotRow>;

export const makeAuthorityPartition = (): AuthorityPartition => new Map();

export const commitToAuthority = (
  partition: AuthorityPartition,
  group: SyncTransactionGroup,
): void => {
  for (const change of group.changes) {
    if (change.entity !== "category" && change.entity !== "product" && change.entity !== "batch") {
      continue;
    }
    const key = `${change.entity}:${change.entityId}`;
    if (change.action === "delete") {
      partition.delete(key);
      continue;
    }
    partition.set(key, {
      entity: change.entity,
      entityId: change.entityId,
      rowVersion: change.rowVersion,
      row: postgresRowImage(change),
    });
  }
};

export const authorityDigest = (partition: AuthorityPartition): PartitionDigest =>
  rowImageDigest([...partition.values()]);

type PostgresMutableMetadata = {
  readonly organizationId: string;
  readonly createdByUserId: string;
  readonly updatedByUserId: string;
  readonly deviceId: string;
  readonly operationId: string;
  readonly rowVersion: number;
};

export type PostgresCategoryRow = {
  readonly id: string;
  readonly name: string;
  readonly tracksPacks: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
} & PostgresMutableMetadata;

export type PostgresProductRow = {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string;
  readonly aisle: string | null;
  readonly composition: string | null;
  readonly strength: string | null;
  readonly unitsPerPack: number;
  readonly purchasePrice: number | null;
  readonly retailPrice: number | null;
  readonly unitPrice: number | null;
  readonly visible: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number | null;
} & PostgresMutableMetadata;

export type PostgresBatchRow = {
  readonly id: string;
  readonly productId: string;
  readonly batchNumber: string | null;
  readonly expiresAt: number | null;
  readonly packQuantity: number;
  readonly unitQuantity: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number | null;
} & PostgresMutableMetadata;

export type PostgresPartitionTables = {
  readonly categories: ReadonlyArray<PostgresCategoryRow>;
  readonly products: ReadonlyArray<PostgresProductRow>;
  readonly batches: ReadonlyArray<PostgresBatchRow>;
};

const partitionRows = <Row extends { readonly id: string; readonly rowVersion: number }>(
  entity: "category" | "product" | "batch",
  rows: ReadonlyArray<Row>,
): ReadonlyArray<SnapshotRow> =>
  rows.map((row) => ({ entity, entityId: row.id, rowVersion: row.rowVersion, row }));

export const serverPartitionDigest = (tables: PostgresPartitionTables): PartitionDigest =>
  rowImageDigest([
    ...partitionRows("category", tables.categories),
    ...partitionRows(
      "product",
      tables.products.filter((row) => row.deletedAt === null),
    ),
    ...partitionRows(
      "batch",
      tables.batches.filter((row) => row.deletedAt === null),
    ),
  ]);

const logChange = <Row extends { readonly id: string; readonly rowVersion: number }>(
  entity: "category" | "product" | "batch",
  row: Row,
  deleted: boolean,
): SyncLogChange => ({
  entity,
  action: deleted ? "delete" : "upsert",
  entityId: row.id,
  rowVersion: row.rowVersion,
  row,
});

export const serverChangeLog = (tables: PostgresPartitionTables): ReadonlyArray<SyncLogChange> => [
  ...tables.categories.map((row) => logChange("category", row, false)),
  ...tables.products.map((row) => logChange("product", row, row.deletedAt !== null)),
  ...tables.batches.map((row) => logChange("batch", row, row.deletedAt !== null)),
];
