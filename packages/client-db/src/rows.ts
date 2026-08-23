import { BatchId, CategoryId, InvoiceId, InvoiceItemId, ProductId } from "@store/contracts/ids";
import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const SignedInteger = Schema.Number.check(Schema.isInt());

const mutableEntityFields = {
  id: NonEmptyString,
  organizationId: NonEmptyString,
  createdByUserId: NonEmptyString,
  updatedByUserId: NonEmptyString,
  deviceId: NonEmptyString,
  operationId: NonEmptyString,
  rowVersion: PositiveInteger,
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
  deletedAt: Schema.NullOr(NonNegativeInteger),
};

export const CategoryRow = Schema.Struct({
  ...mutableEntityFields,
  id: CategoryId,
  name: NonEmptyString,
  tracksPacks: Schema.Boolean,
});
export type CategoryRow = typeof CategoryRow.Type;

export const ProductRow = Schema.Struct({
  ...mutableEntityFields,
  id: ProductId,
  name: NonEmptyString,
  categoryId: CategoryId,
  aisle: Schema.NullOr(Schema.String),
  composition: Schema.NullOr(Schema.String),
  strength: Schema.NullOr(Schema.String),
  unitsPerPack: PositiveInteger,
  packPrice: Schema.NullOr(NonNegativeInteger),
  unitPrice: Schema.NullOr(NonNegativeInteger),
  visible: Schema.Boolean,
});
export type ProductRow = typeof ProductRow.Type;

export const BatchRow = Schema.Struct({
  ...mutableEntityFields,
  id: BatchId,
  productId: ProductId,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(NonNegativeInteger),
  packQuantity: NonNegativeInteger,
  unitQuantity: NonNegativeInteger,
});
export type BatchRow = typeof BatchRow.Type;

export const InvoiceRow = Schema.Struct({
  ...mutableEntityFields,
  id: InvoiceId,
  invoiceNumber: PositiveInteger,
  customerName: Schema.NullOr(Schema.String),
  total: NonNegativeInteger,
});
export type InvoiceRow = typeof InvoiceRow.Type;

export const InvoiceItemRow = Schema.Struct({
  ...mutableEntityFields,
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
});
export type InvoiceItemRow = typeof InvoiceItemRow.Type;

export const StockMovementRow = Schema.Struct({
  id: NonEmptyString,
  productId: ProductId,
  batchId: BatchId,
  invoiceId: Schema.NullOr(InvoiceId),
  type: Schema.Literals(["stock_in", "sale", "open_pack", "adjustment"]),
  packDelta: SignedInteger,
  unitDelta: SignedInteger,
  note: Schema.NullOr(Schema.String),
  organizationId: NonEmptyString,
  actorUserId: NonEmptyString,
  deviceId: NonEmptyString,
  operationId: NonEmptyString,
  createdAt: NonNegativeInteger,
});
export type StockMovementRow = typeof StockMovementRow.Type;
