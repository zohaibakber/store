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
  },
  batches: {
    product: r.one.products({
      from: r.batches.productId,
      to: r.products.id,
      optional: false,
    }),
  },
}));
