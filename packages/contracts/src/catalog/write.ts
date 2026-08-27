import * as Schema from "effect/Schema";

export const MAX_CATALOG_WRITE_ROWS = 1_000;

export const CatalogWriteEntity = Schema.Literals(["category", "product", "batch"]);
export type CatalogWriteEntity = typeof CatalogWriteEntity.Type;

export const CatalogWriteCommand = Schema.Struct({
  operationId: Schema.String,
  organizationId: Schema.String,
  deviceId: Schema.String,
  actorUserId: Schema.String,
  occurredAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  entity: CatalogWriteEntity,
  rows: Schema.Array(Schema.Unknown).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_CATALOG_WRITE_ROWS),
  ),
});
export interface CatalogWriteCommand extends Schema.Schema.Type<typeof CatalogWriteCommand> {}
