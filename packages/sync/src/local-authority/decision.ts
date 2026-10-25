import {
  CommandReceipt,
  INT4_MAX,
  STOCK_MOVEMENT_ROW_VERSION,
  type SyncCommand,
  type SyncEntity,
  type SyncLogChange,
  type SyncProtocolCode,
} from "@store/contracts";
import { type SyncEntityRow } from "@store/contracts/entity-rows";
import {
  ReplicaBatchRow,
  ReplicaInvoiceRow,
  ReplicaProductRow,
} from "@store/contracts/sync/replica-model";
import * as Result from "effect/Result";

import {
  type CatalogEntity,
  type CommandRejection,
  type ProjectedUpsert,
  type ProjectionActor,
  type ReplicaCatalogLookup,
} from "../replica/projection";

export type CatalogPayload = Extract<SyncCommand, { readonly _tag: "catalogWrite" }>["payload"];

export type InvoicePayload = Extract<SyncCommand, { readonly _tag: "issueInvoice" }>["payload"];

export type InvoiceTake = InvoicePayload["allocations"][number];

type AcceptedResult = Exclude<CommandReceipt["result"], { readonly _tag: "rejected" }>;

export type Rejection = CommandRejection;

export type PurchasingEntity = Extract<
  CatalogEntity,
  "supplier" | "purchaseOrder" | "purchaseOrderItem"
>;

export type CatalogRowsById = {
  readonly [Entity in CatalogEntity]: ReadonlyMap<string, SyncEntityRow<Entity>>;
};

export type StagedCatalogRows = {
  readonly [Entity in CatalogEntity]: Map<string, SyncEntityRow<Entity> | undefined>;
};

export type Accepted = {
  readonly result: AcceptedResult;
  readonly changes: ReadonlyArray<SyncLogChange>;
};

export type Decision = Result.Result<Accepted, Rejection>;

export type LocalCatalogFacts = {
  readonly rows: CatalogRowsById;
  readonly recordedMovementIds: ReadonlySet<string>;
  readonly categoriesHoldingOtherProducts: ReadonlySet<string>;
  readonly productsHoldingOtherStock: ReadonlySet<string>;
};

export type LocalInvoiceFacts = {
  readonly products: ReadonlyMap<string, ReplicaProductRow>;
  readonly batches: ReadonlyMap<string, ReplicaBatchRow>;
  readonly invoice: ReplicaInvoiceRow | undefined;
  readonly invoiceNumberTaken: boolean;
  readonly highestInvoiceNumber: number;
  readonly recordedItemIds: ReadonlySet<string>;
  readonly recordedMovementIds: ReadonlySet<string>;
};

export const rejected = (
  code: SyncProtocolCode,
  message: string,
): Result.Result<never, Rejection> => Result.fail({ code, message });

const OUT_OF_RANGE = rejected("INVALID_OPERATION", "A value in this command is out of range.");

export const ALREADY_EXISTS = rejected(
  "ENTITY_CONFLICT",
  "A record this command creates already exists.",
);

const fitsInt4 = (...values: ReadonlyArray<number | null>): boolean =>
  values.every(
    (value) => value === null || (Number.isInteger(value) && Math.abs(value) <= INT4_MAX),
  );

export const hasStock = (batch: { readonly packQuantity: number; readonly unitQuantity: number }) =>
  batch.packQuantity > 0 || batch.unitQuantity > 0;

export const changeOf = <Row>(
  entity: SyncEntity,
  action: SyncLogChange["action"],
  entityId: string,
  rowVersion: number,
  row: Row,
): SyncLogChange => ({ entity, action, entityId, rowVersion, row });

export const upsertOf = (projected: ProjectedUpsert): Result.Result<SyncLogChange, Rejection> => {
  switch (projected.entity) {
    case "category":
      return Result.succeed(
        changeOf("category", "upsert", projected.entityId, projected.row.rowVersion, projected.row),
      );
    case "product": {
      const { row } = projected;
      return fitsInt4(row.unitsPerPack, row.purchasePrice, row.retailPrice, row.unitPrice)
        ? Result.succeed(changeOf("product", "upsert", projected.entityId, row.rowVersion, row))
        : OUT_OF_RANGE;
    }
    case "batch": {
      const { row } = projected;
      return fitsInt4(row.packQuantity, row.unitQuantity)
        ? Result.succeed(changeOf("batch", "upsert", projected.entityId, row.rowVersion, row))
        : OUT_OF_RANGE;
    }
    case "invoice": {
      const { row } = projected;
      return fitsInt4(row.invoiceNumber, row.total) && row.total >= 0
        ? Result.succeed(changeOf("invoice", "upsert", projected.entityId, row.rowVersion, row))
        : OUT_OF_RANGE;
    }
    case "invoiceItem": {
      const { row } = projected;
      return fitsInt4(row.quantity, row.baseUnitQuantity, row.salePrice)
        ? Result.succeed(changeOf("invoiceItem", "upsert", projected.entityId, row.rowVersion, row))
        : OUT_OF_RANGE;
    }
    case "stockMovement": {
      const { row } = projected;
      return fitsInt4(row.packDelta, row.unitDelta)
        ? Result.succeed(
            changeOf(
              "stockMovement",
              "upsert",
              projected.entityId,
              STOCK_MOVEMENT_ROW_VERSION,
              row,
            ),
          )
        : OUT_OF_RANGE;
    }
    case "supplier":
      return Result.succeed(
        changeOf("supplier", "upsert", projected.entityId, projected.row.rowVersion, projected.row),
      );
    case "purchaseOrder": {
      const { row } = projected;
      return fitsInt4(row.orderNumber, row.total)
        ? Result.succeed(
            changeOf("purchaseOrder", "upsert", projected.entityId, row.rowVersion, row),
          )
        : OUT_OF_RANGE;
    }
    case "purchaseOrderItem": {
      const { row } = projected;
      return fitsInt4(row.quantity, row.baseUnitQuantity, row.packCost, row.receivedBaseUnits)
        ? Result.succeed(
            changeOf("purchaseOrderItem", "upsert", projected.entityId, row.rowVersion, row),
          )
        : OUT_OF_RANGE;
    }
  }
};

export const stampOf = (
  payload: { readonly commandId: string; readonly deviceId: string; readonly occurredAt: number },
  actor: ProjectionActor,
  existing: { readonly rowVersion: number },
) => ({
  updatedByUserId: actor.userId,
  deviceId: payload.deviceId,
  operationId: payload.commandId,
  rowVersion: existing.rowVersion + 1,
  updatedAt: payload.occurredAt,
});

export const NO_CATALOG: ReplicaCatalogLookup = {
  category: () => undefined,
  product: () => undefined,
  batch: () => undefined,
  supplier: () => undefined,
  purchaseOrder: () => undefined,
  purchaseOrderItem: () => undefined,
  productInCategory: () => undefined,
  stockedBatchOfProduct: () => undefined,
  supplierNamed: () => undefined,
  purchaseOrdersOfSupplier: () => [],
  itemsOfPurchaseOrder: () => [],
  purchaseOrderNumbered: () => undefined,
  highestPurchaseOrders: [],
};
