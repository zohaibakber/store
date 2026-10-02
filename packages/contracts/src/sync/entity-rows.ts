import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  suppliers,
} from "@store/db/store.schema";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { PurchaseOrderQuantityType, PurchaseOrderStatus } from "../catalog/write";
import {
  BatchId,
  CategoryId,
  InvoiceId,
  InvoiceItemId,
  ProductId,
  PurchaseOrderId,
  PurchaseOrderItemId,
  SupplierId,
} from "../ids";
import { PositiveInt } from "../schema-primitives";
import { InvoiceItem, StockMovement } from "../store/schema";
import type { SyncEntity } from "./schema";

const NullableNatural = Schema.NullOr(Schema.Natural);

export const CategoryRow = createSelectSchema(categories, {
  id: CategoryId,
  name: Schema.NonEmptyString,
  tracksPacks: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
});

export const ProductRow = createSelectSchema(products, {
  id: ProductId,
  name: Schema.NonEmptyString,
  categoryId: CategoryId,
  unitsPerPack: PositiveInt,
  purchasePrice: NullableNatural,
  retailPrice: NullableNatural,
  unitPrice: NullableNatural,
});

export const BatchRow = createSelectSchema(batches, {
  id: BatchId,
  productId: ProductId,
  expiresAt: NullableNatural,
  packQuantity: Schema.Natural,
  unitQuantity: Schema.Natural,
});

export const InvoiceRow = createSelectSchema(invoices, {
  id: InvoiceId,
  invoiceNumber: PositiveInt,
  total: Schema.Natural,
});

export const InvoiceItemRow = createSelectSchema(invoiceItems, {
  id: InvoiceItemId,
  invoiceId: InvoiceId,
  productId: ProductId,
  batchId: BatchId,
  productName: Schema.NonEmptyString,
  quantity: PositiveInt,
  quantityType: InvoiceItem.fields.quantityType,
  baseUnitQuantity: PositiveInt,
  salePrice: Schema.Natural,
});

export const StockMovementRow = createSelectSchema(stockMovements, {
  productId: ProductId,
  batchId: BatchId,
  purchaseOrderId: Schema.NullOr(PurchaseOrderId).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  type: StockMovement.fields.type,
  packDelta: Schema.Int,
  unitDelta: Schema.Int,
  createdAt: Schema.Natural,
});

export const SupplierRow = createSelectSchema(suppliers, {
  id: SupplierId,
  name: Schema.NonEmptyString,
});

export const PurchaseOrderRow = createSelectSchema(purchaseOrders, {
  id: PurchaseOrderId,
  orderNumber: PositiveInt,
  supplierId: SupplierId,
  status: PurchaseOrderStatus,
  sentAt: NullableNatural,
  expectedAt: NullableNatural,
  total: Schema.Natural,
});

export const PurchaseOrderItemRow = createSelectSchema(purchaseOrderItems, {
  id: PurchaseOrderItemId,
  purchaseOrderId: PurchaseOrderId,
  productId: ProductId,
  productName: Schema.NonEmptyString,
  quantity: PositiveInt,
  quantityType: PurchaseOrderQuantityType,
  baseUnitQuantity: PositiveInt,
  packCost: NullableNatural,
  receivedBaseUnits: Schema.Natural,
});

export const syncEntityRows = {
  category: { table: categories, schema: CategoryRow },
  product: { table: products, schema: ProductRow },
  batch: { table: batches, schema: BatchRow },
  invoice: { table: invoices, schema: InvoiceRow },
  invoiceItem: { table: invoiceItems, schema: InvoiceItemRow },
  stockMovement: { table: stockMovements, schema: StockMovementRow },
  supplier: { table: suppliers, schema: SupplierRow },
  purchaseOrder: { table: purchaseOrders, schema: PurchaseOrderRow },
  purchaseOrderItem: { table: purchaseOrderItems, schema: PurchaseOrderItemRow },
} as const satisfies Record<SyncEntity, { readonly table: unknown; readonly schema: Schema.Top }>;

export type SyncEntityRow<E extends SyncEntity> = (typeof syncEntityRows)[E]["schema"]["Type"];
