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
import { omitManaged } from "./managed-columns";
import type { SyncEntity } from "./schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const SignedInteger = Schema.Number.check(Schema.isInt());
const NullableNonNegativeInteger = Schema.NullOr(NonNegativeInteger);

const CategoryRow = createSelectSchema(categories, {
  id: CategoryId,
  name: NonEmptyString,
  // Change-log entries written before categories gained this column do not
  // contain it. The database migration used the same default for those rows.
  tracksPacks: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
});

const ProductRow = createSelectSchema(products, {
  id: ProductId,
  name: NonEmptyString,
  categoryId: CategoryId,
  unitsPerPack: PositiveInteger,
  purchasePrice: NullableNonNegativeInteger,
  retailPrice: NullableNonNegativeInteger,
  unitPrice: NullableNonNegativeInteger,
});

const BatchRow = createSelectSchema(batches, {
  id: BatchId,
  productId: ProductId,
  expiresAt: NullableNonNegativeInteger,
  packQuantity: NonNegativeInteger,
  unitQuantity: NonNegativeInteger,
});

const InvoiceRow = createSelectSchema(invoices, {
  id: InvoiceId,
  invoiceNumber: PositiveInteger,
  total: NonNegativeInteger,
});

const InvoiceItemRow = createSelectSchema(invoiceItems, {
  id: InvoiceItemId,
  invoiceId: InvoiceId,
  productId: ProductId,
  batchId: BatchId,
  productName: NonEmptyString,
  quantity: PositiveInteger,
  quantityType: Schema.Literals(["unit", "pack"]),
  baseUnitQuantity: PositiveInteger,
  salePrice: NonNegativeInteger,
});

const StockMovementRow = createSelectSchema(stockMovements, {
  productId: ProductId,
  batchId: BatchId,
  type: Schema.Literals(["stock_in", "sale", "open_pack", "adjustment"]),
  packDelta: SignedInteger,
  unitDelta: SignedInteger,
  createdAt: NonNegativeInteger,
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
