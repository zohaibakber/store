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
