import {
  CatalogWriteCommand,
  ImportInventoryCommand,
  IssueInvoiceCommand,
  catalogSliceEntities,
  type CatalogSlice,
  type SyncEntity,
  SyncEntityChange,
} from "@store/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const OutboxLane = Schema.Literals(["catalog", "invoice"]);
export type OutboxLane = typeof OutboxLane.Type;

export const CatalogWriteOutbox = Schema.Struct({
  id: Schema.String,
  lane: Schema.Literal("catalog"),
  kind: Schema.Literal("catalogWrite"),
  command: CatalogWriteCommand,
});
export type CatalogWriteOutbox = typeof CatalogWriteOutbox.Type;

export const InvoiceOutbox = Schema.Struct({
  id: Schema.String,
  lane: Schema.Literal("invoice"),
  kind: Schema.Literal("issueInvoice"),
  command: IssueInvoiceCommand,
  changes: Schema.optionalKey(Schema.Array(SyncEntityChange)),
});
export type InvoiceOutbox = typeof InvoiceOutbox.Type;

export const ImportOutbox = Schema.Struct({
  id: Schema.String,
  lane: Schema.Literal("catalog"),
  kind: Schema.Literal("importInventory"),
  command: ImportInventoryCommand,
});
export type ImportOutbox = typeof ImportOutbox.Type;

export const OutboxEntry = Schema.Union([CatalogWriteOutbox, InvoiceOutbox, ImportOutbox]);
export type OutboxEntry = typeof OutboxEntry.Type;

export const ReplicaRowIdentity = Schema.Struct({
  id: Schema.String,
  rowVersion: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  ),
  deletedAt: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type ReplicaRowIdentity = typeof ReplicaRowIdentity.Type;

export const ReplicaRows = Schema.Struct({
  category: Schema.Array(Schema.Json),
  product: Schema.Array(Schema.Json),
  batch: Schema.Array(Schema.Json),
  invoice: Schema.Array(Schema.Json),
  invoiceItem: Schema.Array(Schema.Json),
  stockMovement: Schema.Array(Schema.Json),
});
export type ReplicaRows = typeof ReplicaRows.Type;

export const ReplicaOverlay = Schema.Struct({
  txid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  changes: Schema.Array(SyncEntityChange),
});
export type ReplicaOverlay = typeof ReplicaOverlay.Type;

export const ReplicaBootstrap = Schema.Struct({
  id: Schema.String,
  generation: Schema.String,
  cursor: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  offset: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  done: Schema.Boolean,
  expiresAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  rows: Schema.optionalKey(ReplicaRows),
});
export type ReplicaBootstrap = typeof ReplicaBootstrap.Type;

export const ReplicaSnapshot = Schema.Struct({
  initialized: Schema.optionalKey(Schema.Boolean),
  cursor: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  outbox: Schema.Array(OutboxEntry),
  rows: ReplicaRows,
  overlays: Schema.optionalKey(Schema.Array(ReplicaOverlay)),
  bootstrap: Schema.optionalKey(ReplicaBootstrap),
});
export type ReplicaSnapshot = typeof ReplicaSnapshot.Type;

export const emptyReplicaRows = (): ReplicaRows => ({
  category: [],
  product: [],
  batch: [],
  invoice: [],
  invoiceItem: [],
  stockMovement: [],
});

export const emptyReplicaSnapshot = (): ReplicaSnapshot => ({
  cursor: 0,
  outbox: [],
  rows: emptyReplicaRows(),
  overlays: [],
});

export const outboxEntryIdentity = (entry: OutboxEntry) => `${entry.kind}:${entry.id}`;

export const changesForOutboxEntry = (entry: OutboxEntry): ReadonlyArray<SyncEntityChange> =>
  entry.kind === "catalogWrite"
    ? commandChanges(entry.command)
    : entry.kind === "issueInvoice"
      ? (entry.changes ?? [])
      : [];

export const overlayChanges = (snapshot: ReplicaSnapshot): ReadonlyArray<SyncEntityChange> =>
  (snapshot.overlays ?? []).flatMap((overlay) => overlay.changes);

export const pendingReplicaChanges = (
  snapshot: ReplicaSnapshot,
): ReadonlyArray<SyncEntityChange> => [
  ...overlayChanges(snapshot),
  ...snapshot.outbox.flatMap(changesForOutboxEntry),
];

export const visibleReplicaSnapshot = (snapshot: ReplicaSnapshot): ReplicaSnapshot => {
  const pending = pendingReplicaChanges(snapshot);
  return pending.length === 0 ? snapshot : applyChanges(snapshot, pending);
};

export const replicaScopeKey = (apiOrigin: string, organizationId: string) =>
  `catalog:${apiOrigin}:${organizationId}`;

export type ReplicaDiff = {
  readonly entity: SyncEntity;
  readonly upserts: ReadonlyArray<{ readonly id: string; readonly row: typeof Schema.Json.Type }>;
  readonly deletes: ReadonlyArray<string>;
};

const identityOf = (row: typeof Schema.Json.Type) =>
  Schema.decodeUnknownOption(ReplicaRowIdentity)(row).pipe(Option.getOrNull);

const replicaEntities = [...catalogSliceEntities.catalog, ...catalogSliceEntities.sales];

export const applyRowChanges = (
  current: ReplicaRows,
  changes: ReadonlyArray<SyncEntityChange>,
): ReplicaRows => {
  if (changes.length === 0) return current;
  const next = { ...current };
  for (const entity of replicaEntities) {
    const updates = changes.filter((change) => change.entity === entity);
    if (updates.length === 0) continue;
    const rows = new Map(
      current[entity].flatMap((row) => {
        const identity = identityOf(row);
        return identity ? [[identity.id, row] as const] : [];
      }),
    );
    for (const change of updates) {
      if (change.action === "delete") rows.delete(change.entityId);
      else {
        const row = Schema.decodeUnknownOption(Schema.Json)(change.row).pipe(Option.getOrNull);
        if (row) rows.set(change.entityId, row);
      }
    }
    next[entity] = [...rows.values()];
  }
  return next;
};

export const applyChanges = (
  snapshot: ReplicaSnapshot,
  changes: ReadonlyArray<SyncEntityChange>,
): ReplicaSnapshot =>
  changes.length === 0 ? snapshot : { ...snapshot, rows: applyRowChanges(snapshot.rows, changes) };

export const diffReplicaRows = (
  before: ReplicaRows,
  after: ReplicaRows,
): ReadonlyArray<ReplicaDiff> => {
  const diffs: Array<ReplicaDiff> = [];
  const indexRows = (rows: ReplicaRows[SyncEntity]) =>
    new Map(rows.map((row) => [Schema.decodeUnknownSync(ReplicaRowIdentity)(row).id, row]));
  for (const entity of replicaEntities) {
    if (before[entity] === after[entity]) continue;
    const previous = indexRows(before[entity]);
    const current = indexRows(after[entity]);
    const upserts = [...current]
      .filter(([id, row]) => previous.get(id) !== row)
      .map(([id, row]) => ({ id, row }));
    const deletes = [...previous.keys()].filter((id) => !current.has(id));
    if (upserts.length > 0 || deletes.length > 0) diffs.push({ entity, upserts, deletes });
  }
  return diffs;
};

export const snapshotAsChanges = (
  snapshot: ReplicaSnapshot,
  slices: ReadonlyArray<CatalogSlice>,
): ReadonlyArray<SyncEntityChange> => {
  const entities = new Set(slices.flatMap((slice) => catalogSliceEntities[slice]));
  const changes: Array<SyncEntityChange> = [];
  for (const entity of entities) {
    for (const row of snapshot.rows[entity]) {
      const identity = identityOf(row);
      if (!identity) continue;
      changes.push({
        entity,
        action: "upsert",
        entityId: identity.id,
        rowVersion: identity.rowVersion ?? 1,
        row,
      });
    }
  }
  return changes;
};

export const diffFromChanges = (
  changes: ReadonlyArray<SyncEntityChange>,
): ReadonlyArray<ReplicaDiff> => {
  const byEntity = new Map<
    SyncEntity,
    { upserts: Array<{ id: string; row: typeof Schema.Json.Type }>; deletes: Array<string> }
  >();
  const latest = new Map(changes.map((change) => [`${change.entity}:${change.entityId}`, change]));
  for (const change of latest.values()) {
    const bucket = byEntity.get(change.entity) ?? { upserts: [], deletes: [] };
    if (change.action === "delete") bucket.deletes.push(change.entityId);
    else {
      const row = Schema.decodeUnknownOption(Schema.Json)(change.row).pipe(Option.getOrNull);
      if (row) bucket.upserts.push({ id: change.entityId, row });
    }
    byEntity.set(change.entity, bucket);
  }
  return [...byEntity.entries()].map(([entity, bucket]) => ({
    entity,
    upserts: bucket.upserts,
    deletes: bucket.deletes,
  }));
};

export const commandChanges = (command: CatalogWriteCommand): ReadonlyArray<SyncEntityChange> =>
  command.rows.flatMap((row) => {
    const json = Schema.decodeUnknownOption(Schema.Json)(row).pipe(Option.getOrNull);
    if (!json) return [];
    const identity = identityOf(json);
    if (!identity) return [];
    return [
      {
        entity: command.entity,
        action: identity.deletedAt == null ? "upsert" : "delete",
        entityId: identity.id,
        rowVersion: identity.rowVersion ?? 1,
        row: json,
      } satisfies SyncEntityChange,
    ];
  });

export const invoiceCommandEntry = (
  command: IssueInvoiceCommand,
  changes: ReadonlyArray<SyncEntityChange>,
): InvoiceOutbox => ({
  id: command.commandId,
  lane: "invoice",
  kind: "issueInvoice",
  command,
  changes,
});

export const catalogCommandEntry = (command: CatalogWriteCommand): CatalogWriteOutbox => ({
  id: command.operationId,
  lane: "catalog",
  kind: "catalogWrite",
  command,
});

export const importCommandEntry = (command: ImportInventoryCommand): ImportOutbox => ({
  id: command.commandId,
  lane: "catalog",
  kind: "importInventory",
  command,
});
