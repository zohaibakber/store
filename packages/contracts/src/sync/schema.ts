import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { PositiveInt } from "../schema-primitives";

export const SyncEntity = Schema.Literals([
  "category",
  "product",
  "batch",
  "invoice",
  "invoiceItem",
  "stockMovement",
]);
export type SyncEntity = typeof SyncEntity.Type;

export const isSyncEntity = Schema.is(SyncEntity);

const SyncAction = Schema.Literals(["upsert", "delete"]);

export const SyncEntityChange = Schema.Struct({
  entity: SyncEntity,
  action: SyncAction,
  entityId: Schema.String,
  rowVersion: PositiveInt,
  row: Schema.Unknown,
});
export interface SyncEntityChange extends Schema.Schema.Type<typeof SyncEntityChange> {}

const ForeignEntityRecord = Schema.Struct({
  entity: Schema.String.check(
    Schema.makeFilter((entity) => !isSyncEntity(entity), {
      title: "An entity this build does not replicate",
    }),
  ),
});
type ForeignEntityRecord = typeof ForeignEntityRecord.Type;

export const knownEntityRecords = <
  S extends Schema.Codec<{ readonly entity: SyncEntity }, { readonly entity: string }>,
>(
  known: S,
) =>
  Schema.Array(Schema.Union([known, ForeignEntityRecord])).pipe(
    Schema.decodeTo(
      Schema.Array(Schema.toType(known)),
      SchemaTransformation.transform({
        decode: (
          records: ReadonlyArray<S["Type"] | ForeignEntityRecord>,
        ): ReadonlyArray<S["Type"]> =>
          records.filter((record): record is S["Type"] => isSyncEntity(record.entity)),
        encode: (
          records: ReadonlyArray<S["Type"]>,
        ): ReadonlyArray<S["Type"] | ForeignEntityRecord> => records,
      }),
    ),
  );
