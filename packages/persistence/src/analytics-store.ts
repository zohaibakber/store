import type { DashboardAnalytics } from "@store/contracts";
import { batches, invoices, invoiceItems, products } from "@store/db/local/schema";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { MutationContext } from "./config";
import type { StoreDatabase } from "./database";
import type { PersistenceError } from "./errors";
import { mapPersistenceError } from "./errors";

const DAY_MS = 86_400_000;
const REVENUE_WINDOW_DAYS = 30;
// Batches expiring inside this window surface on the dashboard (FEFO stock).
const EXPIRY_WINDOW_DAYS = 90;
// Visible products at or below this many total units count as low stock.
export const LOW_STOCK_THRESHOLD = 10;

// All bucketing uses UTC days so the SQL `::date` buckets and the TypeScript
// zero-fill agree on day boundaries.
const utcDayStart = (timestamp: number) => timestamp - (timestamp % DAY_MS);
const isoDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

export interface AnalyticsStore {
  readonly getDashboardAnalytics: Effect.Effect<DashboardAnalytics, PersistenceError>;
}

export const makeAnalyticsStore = (
  database: StoreDatabase,
  mutationContext: () => MutationContext,
): AnalyticsStore => {
  const getDashboardAnalytics = Effect.suspend(() => {
    const actor = mutationContext();
    const now = Date.now();
    const todayStart = utcDayStart(now);
    const windowStart = todayStart - (REVENUE_WINDOW_DAYS - 1) * DAY_MS;
    const sevenDayStart = todayStart - 6 * DAY_MS;
    const expiryWindowEnd = now + EXPIRY_WINDOW_DAYS * DAY_MS;

    const invoiceScope = and(
      eq(invoices.organizationId, actor.organizationId),
      isNull(invoices.deletedAt),
    );

    const revenueByDayQuery = database
      .select({
        date: sql<string>`to_char((to_timestamp(${invoices.createdAt} / 1000.0) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`,
        revenue: sql<number>`coalesce(sum(${invoices.total}), 0)::int`,
        invoices: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(and(invoiceScope, gte(invoices.createdAt, windowStart)))
      .groupBy(sql`1`);

    const itemRevenue = sql`coalesce(sum(${invoiceItems.quantity} * ${invoiceItems.salePrice}), 0)`;
    const topProductsQuery = database
      .select({
        productId: invoiceItems.productId,
        productName: sql<string>`max(${invoiceItems.productName})`,
        unitsSold: sql<number>`coalesce(sum(${invoiceItems.baseUnitQuantity}), 0)::int`,
        revenue: sql<number>`${itemRevenue}::int`,
      })
      .from(invoiceItems)
      .where(
        and(
          eq(invoiceItems.organizationId, actor.organizationId),
          isNull(invoiceItems.deletedAt),
          gte(invoiceItems.createdAt, windowStart),
        ),
      )
      .groupBy(invoiceItems.productId)
      .orderBy(desc(itemRevenue))
      .limit(5);

    const expiringBatchesQuery = database
      .select({
        productId: batches.productId,
        productName: products.name,
        batchNumber: batches.batchNumber,
        expiresAt: sql<number>`${batches.expiresAt}`,
        packQuantity: batches.packQuantity,
        unitQuantity: batches.unitQuantity,
      })
      .from(batches)
      .innerJoin(
        products,
        and(
          eq(products.organizationId, batches.organizationId),
          eq(products.id, batches.productId),
        ),
      )
      .where(
        and(
          eq(batches.organizationId, actor.organizationId),
          isNull(batches.deletedAt),
          isNull(products.deletedAt),
          gte(batches.expiresAt, now),
          lt(batches.expiresAt, expiryWindowEnd),
          sql`(${batches.packQuantity} > 0 OR ${batches.unitQuantity} > 0)`,
        ),
      )
      .orderBy(asc(batches.expiresAt))
      .limit(8);

    const liveBatch = sql`${batches.id} IS NOT NULL AND ${batches.deletedAt} IS NULL`;
    const totalUnits = sql`coalesce(sum(CASE WHEN ${liveBatch} THEN ${batches.packQuantity} * ${products.unitsPerPack} + ${batches.unitQuantity} ELSE 0 END), 0)`;
    const lowStockQuery = database
      .select({
        productId: products.id,
        productName: products.name,
        packQuantity: sql<number>`coalesce(sum(CASE WHEN ${liveBatch} THEN ${batches.packQuantity} ELSE 0 END), 0)::int`,
        unitQuantity: sql<number>`coalesce(sum(CASE WHEN ${liveBatch} THEN ${batches.unitQuantity} ELSE 0 END), 0)::int`,
      })
      .from(products)
      .leftJoin(
        batches,
        and(
          eq(batches.organizationId, products.organizationId),
          eq(batches.productId, products.id),
        ),
      )
      .where(
        and(
          eq(products.organizationId, actor.organizationId),
          isNull(products.deletedAt),
          eq(products.visible, true),
        ),
      )
      .groupBy(products.organizationId, products.id, products.name, products.unitsPerPack)
      .having(sql`${totalUnits} <= ${LOW_STOCK_THRESHOLD}`)
      .orderBy(asc(totalUnits), asc(products.name))
      .limit(8);

    const recentInvoicesQuery = database
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        customerName: invoices.customerName,
        total: invoices.total,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .where(invoiceScope)
      .orderBy(desc(invoices.createdAt))
      .limit(5);

    const activeProductsQuery = database
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(
        and(
          eq(products.organizationId, actor.organizationId),
          isNull(products.deletedAt),
          eq(products.visible, true),
        ),
      );

    return Effect.all([
      revenueByDayQuery,
      topProductsQuery,
      expiringBatchesQuery,
      lowStockQuery,
      recentInvoicesQuery,
      activeProductsQuery,
    ]).pipe(
      Effect.map(
        ([revenueRows, topProducts, expiringBatches, lowStock, recentInvoices, counts]) => {
          const byDate = new Map(revenueRows.map((row) => [row.date, row]));
          const revenueByDay = Array.from({ length: REVENUE_WINDOW_DAYS }, (_, index) => {
            const date = isoDay(windowStart + index * DAY_MS);
            const bucket = byDate.get(date);
            return {
              date,
              revenue: bucket?.revenue ?? 0,
              invoices: bucket?.invoices ?? 0,
            };
          });

          const sumSince = (start: number, pick: (day: (typeof revenueByDay)[number]) => number) =>
            revenueByDay.reduce(
              (sum, day, index) => (windowStart + index * DAY_MS >= start ? sum + pick(day) : sum),
              0,
            );
          const revenue30d = sumSince(windowStart, (day) => day.revenue);
          const invoices30d = sumSince(windowStart, (day) => day.invoices);

          return {
            totals: {
              revenueToday: sumSince(todayStart, (day) => day.revenue),
              revenue7d: sumSince(sevenDayStart, (day) => day.revenue),
              revenue30d,
              invoicesToday: sumSince(todayStart, (day) => day.invoices),
              invoices30d,
              averageInvoice30d: invoices30d === 0 ? 0 : Math.round(revenue30d / invoices30d),
              activeProducts: counts[0]?.count ?? 0,
            },
            revenueByDay,
            topProducts,
            expiringBatches,
            lowStock,
            recentInvoices,
          };
        },
      ),
      mapPersistenceError("load dashboard analytics"),
    );
  });

  return { getDashboardAnalytics };
};
