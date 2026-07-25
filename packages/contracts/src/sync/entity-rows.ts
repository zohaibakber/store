import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/store.schema";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Schema from "effect/Schema";

import { omitManaged } from "./managed-columns";
import type { SyncEntity } from "./schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const SignedInteger = Schema.Number.check(Schema.isInt());
const NullableNonNegativeInteger = Schema.NullOr(NonNegativeInteger);

const CategoryRow = createSelectSchema(categories, {
  name: NonEmptyString,
});

const ProductRow = createSelectSchema(products, {
  name: NonEmptyString,
  categoryId: NonEmptyString,
  unitsPerPack: PositiveInteger,
  packPrice: NullableNonNegativeInteger,
  unitPrice: NullableNonNegativeInteger,
});

const BatchRow = createSelectSchema(batches, {
  productId: NonEmptyString,
  expiresAt: NullableNonNegativeInteger,
  packQuantity: NonNegativeInteger,
  unitQuantity: NonNegativeInteger,
});

const InvoiceRow = createSelectSchema(invoices, {
  invoiceNumber: PositiveInteger,
  total: NonNegativeInteger,
});

const InvoiceItemRow = createSelectSchema(invoiceItems, {
  invoiceId: NonEmptyString,
  productId: NonEmptyString,
  batchId: NonEmptyString,
  productName: NonEmptyString,
  quantity: PositiveInteger,
  quantityType: Schema.Literals(["unit", "pack"]),
  baseUnitQuantity: PositiveInteger,
  salePrice: NonNegativeInteger,
});

const StockMovementRow = createSelectSchema(stockMovements, {
  productId: NonEmptyString,
  batchId: NonEmptyString,
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
