import {
  PARTITION_ENTITIES,
  partitionDigestOf,
  type PartitionEntity,
  type SnapshotRow,
  type SyncLogChange,
  type SyncTransactionGroup,
} from "@store/contracts";
export type AuthorityPartition = Map<string, SnapshotRow>;

export const makeAuthorityPartition = (): AuthorityPartition => new Map();

export const commitToAuthority = (
  partition: AuthorityPartition,
  group: SyncTransactionGroup,
): void => {
  for (const change of group.changes) {
    const key = `${change.entity}:${change.entityId}`;
    if (change.action === "delete") {
      partition.delete(key);
      continue;
    }
    partition.set(key, {
      entity: change.entity,
      entityId: change.entityId,
      rowVersion: change.rowVersion,
      row: change.row,
    });
  }
};

const isPartitionEntity = (entity: string): entity is PartitionEntity =>
  PARTITION_ENTITIES.some((candidate) => candidate === entity);

const partitionLeaves = (rows: Iterable<SnapshotRow>) =>
  [...rows].flatMap((row) =>
    isPartitionEntity(row.entity)
      ? [{ entity: row.entity, entityId: row.entityId, rowVersion: row.rowVersion }]
      : [],
  );

export const authorityDigest = (partition: AuthorityPartition) =>
  partitionDigestOf(partitionLeaves(partition.values()));

type ServerMutableMetadata = {
  readonly organizationId: string;
  readonly createdByUserId: string;
  readonly updatedByUserId: string;
  readonly deviceId: string;
  readonly operationId: string;
  readonly rowVersion: number;
};

type ServerCategoryRow = {
  readonly id: string;
  readonly name: string;
  readonly tracksPacks: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
} & ServerMutableMetadata;

type ServerProductRow = {
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
} & ServerMutableMetadata;

type ServerBatchRow = {
  readonly id: string;
  readonly productId: string;
  readonly batchNumber: string | null;
  readonly expiresAt: number | null;
  readonly packQuantity: number;
  readonly unitQuantity: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number | null;
} & ServerMutableMetadata;

export type ServerPartitionTables = {
  readonly categories: ReadonlyArray<ServerCategoryRow>;
  readonly products: ReadonlyArray<ServerProductRow>;
  readonly batches: ReadonlyArray<ServerBatchRow>;
};

const partitionRows = <Row extends { readonly id: string; readonly rowVersion: number }>(
  entity: "category" | "product" | "batch",
  rows: ReadonlyArray<Row>,
): ReadonlyArray<SnapshotRow> =>
  rows.map((row) => ({ entity, entityId: row.id, rowVersion: row.rowVersion, row }));

export const serverPartitionDigest = (tables: ServerPartitionTables) =>
  partitionDigestOf(
    partitionLeaves([
      ...partitionRows("category", tables.categories),
      ...partitionRows(
        "product",
        tables.products.filter((row) => row.deletedAt === null),
      ),
      ...partitionRows(
        "batch",
        tables.batches.filter((row) => row.deletedAt === null),
      ),
    ]),
  );

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

export const serverChangeLog = (tables: ServerPartitionTables): ReadonlyArray<SyncLogChange> => [
  ...tables.categories.map((row) => logChange("category", row, false)),
  ...tables.products.map((row) => logChange("product", row, row.deletedAt !== null)),
  ...tables.batches.map((row) => logChange("batch", row, row.deletedAt !== null)),
];
