import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { SyncProtocolCode } from "../sync/protocol";

export const CatalogRefusalReason = Schema.Literals([
  "invalidInput",
  "categoryHasProducts",
  "productHasStock",
  "unitsPerPackWithStock",
  "batchHasStock",
  "insufficientStock",
  "duplicateName",
  "missingReference",
  "emptyCommand",
  "tooManyLines",
  "staleRow",
  "supplierHasOrders",
  "orderTransitionInvalid",
  "orderNotOpen",
  "orderNotDraft",
  "orderHasItems",
  "itemReceived",
  "lineBelongsElsewhere",
  "allocationFailed",
]);
export type CatalogRefusalReason = typeof CatalogRefusalReason.Type;

export const CATALOG_REFUSALS = {
  invalidInput: { code: "ENTITY_CONFLICT" },
  categoryHasProducts: {
    code: "ENTITY_CONFLICT",
    message: "Move products to another category before deleting this category.",
  },
  productHasStock: {
    code: "ENTITY_CONFLICT",
    message: "Clear remaining stock before deleting this product.",
  },
  unitsPerPackWithStock: {
    code: "ENTITY_CONFLICT",
    message: "Change units per pack only after the product has no remaining stock.",
  },
  batchHasStock: {
    code: "ENTITY_CONFLICT",
    message: "Clear remaining stock before deleting this batch.",
  },
  insufficientStock: { code: "ENTITY_CONFLICT" },
  duplicateName: { code: "ENTITY_CONFLICT" },
  missingReference: { code: "ENTITY_CONFLICT" },
  emptyCommand: { code: "ENTITY_CONFLICT" },
  tooManyLines: { code: "ENTITY_CONFLICT" },
  staleRow: { code: "ENTITY_CONFLICT" },
  supplierHasOrders: {
    code: "SUPPLIER_HAS_ORDERS",
    message: "This supplier has purchase orders and cannot be deleted.",
  },
  orderTransitionInvalid: {
    code: "PURCHASE_ORDER_TRANSITION_INVALID",
    message: "This purchase order cannot move to that status.",
  },
  orderNotOpen: {
    code: "PURCHASE_ORDER_NOT_OPEN",
    message: "This purchase order is closed or cancelled and can no longer change.",
  },
  orderNotDraft: {
    code: "PURCHASE_ORDER_NOT_DRAFT",
    message: "Only a draft purchase order can be deleted.",
  },
  orderHasItems: {
    code: "PURCHASE_ORDER_HAS_ITEMS",
    message: "Remove the lines from this purchase order before deleting it.",
  },
  itemReceived: {
    code: "PURCHASE_ORDER_ITEM_RECEIVED",
    message: "This order line has received stock and cannot be removed or moved.",
  },
  lineBelongsElsewhere: { code: "ENTITY_CONFLICT" },
  allocationFailed: { code: "ENTITY_CONFLICT" },
} as const satisfies Record<
  CatalogRefusalReason,
  { readonly code: SyncProtocolCode; readonly message?: string }
>;

export class CatalogRefusal extends Schema.TaggedError<CatalogRefusal>()("CatalogRefusal", {
  reason: CatalogRefusalReason,
  message: Schema.String,
  field: Schema.optionalKey(Schema.String),
}) {}

export const decideField = <S extends Schema.Decoder<unknown>>(
  schema: S,
  value: S["Encoded"],
  refusal: { readonly message?: string; readonly field?: string | undefined },
): Result.Result<S["Type"], CatalogRefusal> =>
  Result.mapError(
    Schema.decodeUnknownResult(schema)(value),
    (error) =>
      new CatalogRefusal({
        reason: "invalidInput",
        message: refusal.message ?? error.message,
        ...(refusal.field === undefined ? null : { field: refusal.field }),
      }),
  );
