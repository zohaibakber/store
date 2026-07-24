import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const localRelations = defineRelations(schema, (r) => ({
  categories: {
    products: r.many.products(),
  },
  products: {
    category: r.one.categories({
      from: [r.products.organizationId, r.products.categoryId],
      to: [r.categories.organizationId, r.categories.id],
      optional: false,
    }),
    batches: r.many.batches(),
    stockMovements: r.many.stockMovements(),
  },
  batches: {
    product: r.one.products({
      from: [r.batches.organizationId, r.batches.productId],
      to: [r.products.organizationId, r.products.id],
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
      from: [r.invoiceItems.organizationId, r.invoiceItems.invoiceId],
      to: [r.invoices.organizationId, r.invoices.id],
      optional: false,
    }),
    product: r.one.products({
      from: [r.invoiceItems.organizationId, r.invoiceItems.productId],
      to: [r.products.organizationId, r.products.id],
      optional: false,
    }),
    batch: r.one.batches({
      from: [r.invoiceItems.organizationId, r.invoiceItems.batchId],
      to: [r.batches.organizationId, r.batches.id],
      optional: false,
    }),
  },
  stockMovements: {
    product: r.one.products({
      from: [r.stockMovements.organizationId, r.stockMovements.productId],
      to: [r.products.organizationId, r.products.id],
      optional: false,
    }),
    batch: r.one.batches({
      from: [r.stockMovements.organizationId, r.stockMovements.batchId],
      to: [r.batches.organizationId, r.batches.id],
      optional: false,
    }),
    invoice: r.one.invoices({
      from: [r.stockMovements.organizationId, r.stockMovements.invoiceId],
      to: [r.invoices.organizationId, r.invoices.id],
      optional: true,
    }),
  },
}));
