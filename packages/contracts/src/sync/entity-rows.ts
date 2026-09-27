import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/store.schema";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { BatchId, CategoryId, InvoiceId, InvoiceItemId, ProductId } from "../ids";
import { PositiveInt } from "../schema-primitives";
import { omitManaged } from "./managed-columns";
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
  quantityType: Schema.Literals(["unit", "pack"]),
  baseUnitQuantity: PositiveInt,
  salePrice: Schema.Natural,
});

export const StockMovementRow = createSelectSchema(stockMovements, {
  productId: ProductId,
  batchId: BatchId,
  type: Schema.Literals(["stock_in", "sale", "open_pack", "adjustment"]),
  packDelta: Schema.Int,
  unitDelta: Schema.Int,
  createdAt: Schema.Natural,
});

export const syncEntityRows = {
  category: { table: categories, schema: CategoryRow },
  product: { table: products, schema: ProductRow },
  batch: { table: batches, schema: BatchRow },
  invoice: { table: invoices, schema: InvoiceRow },
  invoiceItem: { table: invoiceItems, schema: InvoiceItemRow },
  stockMovement: { table: stockMovements, schema: StockMovementRow },
} as const satisfies Record<SyncEntity, { readonly table: unknown; readonly schema: Schema.Top }>;

export type SyncEntityRow<E extends SyncEntity> = (typeof syncEntityRows)[E]["schema"]["Type"];

const pushRow = <F extends Schema.Struct.Fields>(schema: { readonly fields: F }) =>
  Schema.Struct({
    ...omitManaged(schema.fields),
    id: Schema.NonEmptyString,
    createdAt: Schema.optionalKey(Schema.Natural),
  });

export const syncEntityPushRows = {
  category: pushRow(CategoryRow),
  product: pushRow(ProductRow),
  batch: pushRow(BatchRow),
  invoice: pushRow(InvoiceRow),
  invoiceItem: pushRow(InvoiceItemRow),
  stockMovement: pushRow(StockMovementRow),
} as const satisfies Record<SyncEntity, Schema.Top>;
