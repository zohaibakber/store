import {
  makeInsightsSalesAccumulator,
  MAX_INSIGHTS_BATCHES,
  MAX_INSIGHTS_PRODUCTS,
  type ReplicaInsightsFacts,
  type ReplicaInsightsWindow,
} from "@store/contracts/sync/replica-insights";
import * as Effect from "effect/Effect";

import { generationBounds } from "./query";
import type { ReplicaQueryBuilder } from "./schema";

const INVOICE_ITEM_READ_CONCURRENCY = 24;

export const readIndexedDbInsights = (
  api: ReplicaQueryBuilder,
  generation: number,
  window: ReplicaInsightsWindow,
): Effect.Effect<ReplicaInsightsFacts, unknown> =>
  Effect.gen(function* () {
    const [lower, upper] = generationBounds(generation);
    const categories = yield* api.from("categories").select().between(lower, upper);
    const products = yield* api
      .from("products")
      .select()
      .between(lower, upper)
      .limit(MAX_INSIGHTS_PRODUCTS + 1);
    const batches = yield* api.from("batches").select().between(lower, upper);
    const invoices = yield* api
      .from("invoices")
      .select("byCreatedAt")
      .between([generation, window.since], [generation, window.until], {
        excludeUpperBound: true,
      });
    const lines = yield* Effect.forEach(
      invoices,
      (invoice) => api.from("invoice_items").select("byInvoice").equals([generation, invoice.id]),
      { concurrency: INVOICE_ITEM_READ_CONCURRENCY },
    );
    const accumulator = makeInsightsSalesAccumulator(window);
    invoices.every((invoice, index) => accumulator.addInvoice(invoice, lines[index] ?? []));
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const stocked = batches.filter((batch) => batch.packQuantity !== 0 || batch.unitQuantity !== 0);
    const sales = accumulator.result();
    return {
      window,
      products: products.slice(0, MAX_INSIGHTS_PRODUCTS).map((product) => {
        const category = categoryById.get(product.categoryId);
        return {
          id: product.id,
          name: product.name,
          categoryId: product.categoryId,
          categoryName: category?.name ?? null,
          tracksPacks: category?.tracksPacks ?? true,
          unitsPerPack: Math.max(1, product.unitsPerPack),
          purchasePrice: product.purchasePrice,
          retailPrice: product.retailPrice,
          unitPrice: product.unitPrice,
          visible: product.visible,
          createdAt: product.createdAt,
        };
      }),
      batches: stocked.slice(0, MAX_INSIGHTS_BATCHES).map((batch) => ({
        productId: batch.productId,
        batchNumber: batch.batchNumber,
        packQuantity: batch.packQuantity,
        unitQuantity: batch.unitQuantity,
        expiresAt: batch.expiresAt,
      })),
      sales: sales.sales,
      days: sales.days,
      hours: sales.hours,
      truncated:
        sales.truncated ||
        products.length > MAX_INSIGHTS_PRODUCTS ||
        stocked.length > MAX_INSIGHTS_BATCHES,
    } satisfies ReplicaInsightsFacts;
  });
