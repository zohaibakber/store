import type { SyncEntity } from "@store/contracts";
import { syncEntityRows, type SyncEntityRow } from "@store/contracts/entity-rows";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

type UndecodedRow = Parameters<
  ReturnType<typeof Schema.decodeUnknownEffect<(typeof syncEntityRows)["category"]["schema"]>>
>[0];

type RowDecoder<Entity extends SyncEntity> = (
  row: UndecodedRow,
) => Effect.Effect<SyncEntityRow<Entity>, Schema.SchemaError>;

type EntityRowDecoders = { readonly [Entity in SyncEntity]: RowDecoder<Entity> };

const decoders: EntityRowDecoders = {
  category: Schema.decodeUnknownEffect(syncEntityRows.category.schema),
  product: Schema.decodeUnknownEffect(syncEntityRows.product.schema),
  batch: Schema.decodeUnknownEffect(syncEntityRows.batch.schema),
  invoice: Schema.decodeUnknownEffect(syncEntityRows.invoice.schema),
  invoiceItem: Schema.decodeUnknownEffect(syncEntityRows.invoiceItem.schema),
  stockMovement: Schema.decodeUnknownEffect(syncEntityRows.stockMovement.schema),
  supplier: Schema.decodeUnknownEffect(syncEntityRows.supplier.schema),
  purchaseOrder: Schema.decodeUnknownEffect(syncEntityRows.purchaseOrder.schema),
  purchaseOrderItem: Schema.decodeUnknownEffect(syncEntityRows.purchaseOrderItem.schema),
};

export const decodeEntityRow = <Entity extends SyncEntity>(
  entity: Entity,
): EntityRowDecoders[Entity] => decoders[entity];

export const decodeRowOrDie = <Entity extends SyncEntity>(
  entity: Entity,
  row: UndecodedRow,
): Effect.Effect<SyncEntityRow<Entity>> =>
  decodeEntityRow(entity)(row).pipe(
    Effect.tapError((error) =>
      Effect.logError("replica.row_undecodable").pipe(
        Effect.annotateLogs({
          entity,
          rowId: Predicate.hasProperty(row, "id") ? row.id : undefined,
          error: error.message,
        }),
      ),
    ),
    Effect.orDie,
  );
