import {
  catalogSliceEntities,
  type CatalogSlice,
  type CatalogWriteCommand,
  type ImportInventoryCommand,
  type IssueInvoiceCommand,
  type SyncEntity,
  type SyncEntityChange,
} from "@store/contracts";
import * as Schema from "effect/Schema";

export const OutboxLane = Schema.Literals(["catalog", "invoice"]);
export type OutboxLane = typeof OutboxLane.Type;

export const OutboxEntry = Schema.Struct({
  id: Schema.String,
  lane: OutboxLane,
  kind: Schema.Literals(["catalogWrite", "issueInvoice", "importInventory"]),
  command: Schema.Unknown,
});
export interface OutboxEntry extends Schema.Schema.Type<typeof OutboxEntry> {}

export const ReplicaSnapshot = Schema.Struct({
  cursor: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  outbox: Schema.Array(OutboxEntry),
  rows: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)),
});
export interface ReplicaSnapshot extends Schema.Schema.Type<typeof ReplicaSnapshot> {}

export const emptyReplicaSnapshot = (): ReplicaSnapshot => ({
  cursor: 0,
  outbox: [],
  rows: {
    category: [],
    product: [],
    batch: [],
    invoice: [],
    invoiceItem: [],
    stockMovement: [],
  },
});

export const replicaScopeKey = (apiOrigin: string, organizationId: string) =>
  `catalog:${apiOrigin}:${organizationId}`;

export type ReplicaDiff = {
  readonly entity: SyncEntity;
  readonly upserts: ReadonlyArray<{ readonly id: string; readonly row: unknown }>;
  readonly deletes: ReadonlyArray<string>;
};

const rowId = (row: unknown) => {
  if (row !== null && typeof row === "object" && "id" in row && typeof row.id === "string") {
    return row.id;
  }
  return undefined;
};

export const applyChange = (snapshot: ReplicaSnapshot, change: SyncEntityChange): ReplicaSnapshot => {
  const current = snapshot.rows[change.entity] ?? [];
  const next = current.filter((row) => rowId(row) !== change.entityId);
  if (change.action === "upsert") next.push(change.row);
  return {
    ...snapshot,
    rows: { ...snapshot.rows, [change.entity]: next },
  };
};

export const applyChanges = (snapshot: ReplicaSnapshot, changes: ReadonlyArray<SyncEntityChange>) =>
  changes.reduce(applyChange, snapshot);

export const snapshotAsChanges = (
  snapshot: ReplicaSnapshot,
  slices: ReadonlyArray<CatalogSlice>,
): ReadonlyArray<SyncEntityChange> => {
  const entities = new Set(slices.flatMap((slice) => catalogSliceEntities[slice]));
  const changes: Array<SyncEntityChange> = [];
  for (const entity of entities) {
    for (const row of snapshot.rows[entity] ?? []) {
      const id = rowId(row);
      if (!id) continue;
      const version =
        row !== null &&
        typeof row === "object" &&
        "rowVersion" in row &&
        typeof row.rowVersion === "number"
          ? row.rowVersion
          : 1;
      changes.push({
        entity,
        action: "upsert",
        entityId: id,
        rowVersion: version,
        row,
      });
    }
  }
  return changes;
};

export const diffFromChanges = (changes: ReadonlyArray<SyncEntityChange>): ReadonlyArray<ReplicaDiff> => {
  const byEntity = new Map<SyncEntity, { upserts: Array<{ id: string; row: unknown }>; deletes: Array<string> }>();
  for (const change of changes) {
    const bucket = byEntity.get(change.entity) ?? { upserts: [], deletes: [] };
    if (change.action === "delete") bucket.deletes.push(change.entityId);
    else bucket.upserts.push({ id: change.entityId, row: change.row });
    byEntity.set(change.entity, bucket);
  }
  return [...byEntity.entries()].map(([entity, bucket]) => ({ entity, ...bucket }));
};

export const commandChanges = (command: CatalogWriteCommand): ReadonlyArray<SyncEntityChange> =>
  command.rows.flatMap((row) => {
    const id = rowId(row);
    if (!id) return [];
    const deletedAt =
      row !== null && typeof row === "object" && "deletedAt" in row ? row.deletedAt : null;
    const version =
      row !== null &&
      typeof row === "object" &&
      "rowVersion" in row &&
      typeof row.rowVersion === "number"
        ? row.rowVersion
        : 1;
    return [
      {
        entity: command.entity,
        action: deletedAt == null ? "upsert" : "delete",
        entityId: id,
        rowVersion: version,
        row,
      } satisfies SyncEntityChange,
    ];
  });

export const invoiceCommandEntry = (command: IssueInvoiceCommand): OutboxEntry => ({
  id: command.commandId,
  lane: "invoice",
  kind: "issueInvoice",
  command,
});

export const catalogCommandEntry = (command: CatalogWriteCommand): OutboxEntry => ({
  id: command.operationId,
  lane: "catalog",
  kind: "catalogWrite",
  command,
});

export const importCommandEntry = (command: ImportInventoryCommand): OutboxEntry => ({
  id: command.commandId,
  lane: "catalog",
  kind: "importInventory",
  command,
});
