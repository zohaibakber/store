import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  categories: {
    products: r.many.products(),
  },
  products: {
    category: r.one.categories({
      from: r.products.categoryId,
      to: r.categories.id,
      optional: false,
    }),
    batches: r.many.batches(),
    stockMovements: r.many.stockMovements(),
  },
  batches: {
    product: r.one.products({
      from: r.batches.productId,
      to: r.products.id,
      optional: false,
    }),
    stockMovements: r.many.stockMovements(),
  },
  invoices: {
    items: r.many.invoiceItems(),
    stockMovements: r.many.stockMovements(),
  },
  invoiceItems: {
    invoice: r.one.invoices({
      from: r.invoiceItems.invoiceId,
      to: r.invoices.id,
      optional: false,
    }),
    product: r.one.products({
      from: r.invoiceItems.productId,
      to: r.products.id,
      optional: false,
    }),
    batch: r.one.batches({
      from: r.invoiceItems.batchId,
      to: r.batches.id,
      optional: false,
    }),
  },
  stockMovements: {
    product: r.one.products({
      from: r.stockMovements.productId,
      to: r.products.id,
      optional: false,
    }),
    batch: r.one.batches({
      from: r.stockMovements.batchId,
      to: r.batches.id,
      optional: false,
    }),
    invoice: r.one.invoices({
      from: r.stockMovements.invoiceId,
      to: r.invoices.id,
      optional: true,
    }),
  },
}));
