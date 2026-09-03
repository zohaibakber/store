import * as Schema from "effect/Schema";

export const SyncPositiveInteger = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
);

export const SyncEntity = Schema.Literals([
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "stockMovement",
]);
export type SyncEntity = typeof SyncEntity.Type;

export const SyncAction = Schema.Literals(["upsert", "delete"]);
export type SyncAction = typeof SyncAction.Type;

export const SyncEntityChange = Schema.Struct({
  entity: SyncEntity,
  action: SyncAction,
  entityId: Schema.String,
  rowVersion: SyncPositiveInteger,
  row: Schema.Unknown,
});
export interface SyncEntityChange extends Schema.Schema.Type<typeof SyncEntityChange> {}

export const CatalogCursor = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export type CatalogCursor = typeof CatalogCursor.Type;

export const CatalogSlice = Schema.Literals(["catalog", "sales"]);
export type CatalogSlice = typeof CatalogSlice.Type;

export const catalogSliceEntities = {
  catalog: ["category", "product", "batch"],
  sales: ["invoice", "invoiceItem", "stockMovement"],
} as const satisfies Record<CatalogSlice, ReadonlyArray<SyncEntity>>;

export const CatalogPullRequest = Schema.Struct({
  cursor: CatalogCursor,
  slices: Schema.Array(CatalogSlice).check(Schema.isMinLength(1)),
  waitMs: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(25_000)),
  ),
});
export interface CatalogPullRequest extends Schema.Schema.Type<typeof CatalogPullRequest> {}

export const CatalogPullResult = Schema.Struct({
  cursor: CatalogCursor,
  changes: Schema.Array(SyncEntityChange),
  hasMore: Schema.Boolean,
});
export interface CatalogPullResult extends Schema.Schema.Type<typeof CatalogPullResult> {}

export const CatalogSnapshotRequest = Schema.Struct({
  slices: Schema.Array(CatalogSlice).check(Schema.isMinLength(1)),
});
export interface CatalogSnapshotRequest extends Schema.Schema.Type<typeof CatalogSnapshotRequest> {}

export const CatalogSnapshotResult = Schema.Struct({
  cursor: CatalogCursor,
  changes: Schema.Array(SyncEntityChange),
});
export interface CatalogSnapshotResult extends Schema.Schema.Type<typeof CatalogSnapshotResult> {}
