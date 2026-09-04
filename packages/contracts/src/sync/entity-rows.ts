import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { BatchId, CategoryId, InvoiceId, InvoiceItemId, ProductId } from "../ids";
import { omitManaged } from "./managed-columns";
import type { SyncEntity } from "./schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const SignedInteger = Schema.Number.check(Schema.isInt());
const NullableNonNegativeInteger = Schema.NullOr(NonNegativeInteger);

const mutableEntityFields = {
  organizationId: Schema.String,
  createdByUserId: Schema.String,
  updatedByUserId: Schema.String,
  deviceId: Schema.String,
  operationId: Schema.String,
  rowVersion: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  deletedAt: Schema.NullOr(Schema.Number),
};

const CategoryRow = Schema.Struct({
  id: CategoryId,
  name: NonEmptyString,
  // Change-log entries written before categories gained this column do not
  // contain it. The database migration used the same default for those rows.
  tracksPacks: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  ...mutableEntityFields,
});

const ProductRow = Schema.Struct({
  id: ProductId,
  name: NonEmptyString,
  categoryId: CategoryId,
  aisle: Schema.NullOr(Schema.String),
  composition: Schema.NullOr(Schema.String),
  strength: Schema.NullOr(Schema.String),
  unitsPerPack: PositiveInteger,
  purchasePrice: NullableNonNegativeInteger,
  retailPrice: NullableNonNegativeInteger,
  unitPrice: NullableNonNegativeInteger,
  visible: Schema.Boolean,
  ...mutableEntityFields,
});

const BatchRow = Schema.Struct({
  id: BatchId,
  productId: ProductId,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: NullableNonNegativeInteger,
  packQuantity: NonNegativeInteger,
  unitQuantity: NonNegativeInteger,
  ...mutableEntityFields,
});

const InvoiceRow = Schema.Struct({
  id: InvoiceId,
  invoiceNumber: PositiveInteger,
  customerName: Schema.NullOr(Schema.String),
  total: NonNegativeInteger,
  ...mutableEntityFields,
});

const InvoiceItemRow = Schema.Struct({
  id: InvoiceItemId,
  invoiceId: InvoiceId,
  productId: ProductId,
  batchId: BatchId,
  productName: NonEmptyString,
  batchNumber: Schema.NullOr(Schema.String),
  quantity: PositiveInteger,
  quantityType: Schema.Literals(["unit", "pack"]),
  baseUnitQuantity: PositiveInteger,
  salePrice: NonNegativeInteger,
  ...mutableEntityFields,
});

const StockMovementRow = Schema.Struct({
  id: NonEmptyString,
  productId: ProductId,
  batchId: BatchId,
  invoiceId: Schema.NullOr(InvoiceId),
  type: Schema.Literals(["stock_in", "sale", "open_pack", "adjustment"]),
  packDelta: SignedInteger,
  unitDelta: SignedInteger,
  note: Schema.NullOr(Schema.String),
  organizationId: Schema.String,
  actorUserId: Schema.String,
  deviceId: Schema.String,
  operationId: Schema.String,
  createdAt: NonNegativeInteger,
});

export const syncEntityRows = {
  category: { schema: CategoryRow },
  product: { schema: ProductRow },
  batch: { schema: BatchRow },
  invoice: { schema: InvoiceRow },
  invoiceItem: { schema: InvoiceItemRow },
  stockMovement: { schema: StockMovementRow },
} as const satisfies Record<SyncEntity, { readonly schema: Schema.Top }>;

export type SyncEntityRow<E extends SyncEntity> = (typeof syncEntityRows)[E]["schema"]["Type"];

const pushRow = <F extends Schema.Struct.Fields>(schema: { readonly fields: F }) =>
  Schema.Struct({
    ...omitManaged(schema.fields),
    id: NonEmptyString,
    createdAt: Schema.optionalKey(NonNegativeInteger),
  });

export const syncEntityPushRows = {
  category: pushRow(CategoryRow),
  product: pushRow(ProductRow),
  batch: pushRow(BatchRow),
  invoice: pushRow(InvoiceRow),
  invoiceItem: pushRow(InvoiceItemRow),
  stockMovement: pushRow(StockMovementRow),
} as const satisfies Record<SyncEntity, Schema.Top>;
