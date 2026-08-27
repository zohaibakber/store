import type { DashboardAnalytics, Product } from "@store/contracts";
import * as React from "react";

import { useCatalogProducts, useInventoryInvoices } from "./queries";

const DAY_MS = 86_400_000;
const DASHBOARD_DAYS = 30;
const EXPIRY_DAYS = 90;
const LOW_STOCK_THRESHOLD = 10;
const utcDayStart = (timestamp: number) => timestamp - (timestamp % DAY_MS);
const isoDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

export const useInventoryDashboardAnalytics = () => {
  const products = useCatalogProducts();
  const invoices = useInventoryInvoices();
  const [now] = React.useState(() => Date.now());
  const data = React.useMemo<DashboardAnalytics>(() => {
    const todayStart = utcDayStart(now);
    const windowStart = todayStart - (DASHBOARD_DAYS - 1) * DAY_MS;
    const sevenDayStart = todayStart - 6 * DAY_MS;
    const revenueByDay = Array.from({ length: DASHBOARD_DAYS }, (_, index) => {
      const dayStart = windowStart + index * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const matches = invoices.data.filter(
        (invoice) => invoice.createdAt >= dayStart && invoice.createdAt < dayEnd,
      );
      return {
        date: isoDay(dayStart),
        revenue: matches.reduce((sum, invoice) => sum + invoice.total, 0),
        invoices: matches.length,
      };
    });
    const sumSince = (start: number, pick: (day: (typeof revenueByDay)[number]) => number) =>
      revenueByDay.reduce(
        (sum, day, index) => (windowStart + index * DAY_MS >= start ? sum + pick(day) : sum),
        0,
      );
    const revenue30d = sumSince(windowStart, (day) => day.revenue);
    const invoices30d = sumSince(windowStart, (day) => day.invoices);

    const sales = new Map<
      string,
      { productId: Product["id"]; productName: string; unitsSold: number; revenue: number }
    >();
    for (const invoice of invoices.data) {
      if (invoice.createdAt < windowStart) continue;
      for (const item of invoice.items) {
        const current = sales.get(item.productId) ?? {
          productId: item.productId,
          productName: item.productName,
          unitsSold: 0,
          revenue: 0,
        };
        current.unitsSold += item.baseUnitQuantity;
        current.revenue += item.quantity * item.salePrice;
        sales.set(item.productId, current);
      }
    }

    return {
      totals: {
        revenueToday: sumSince(todayStart, (day) => day.revenue),
        revenue7d: sumSince(sevenDayStart, (day) => day.revenue),
        revenue30d,
        invoicesToday: sumSince(todayStart, (day) => day.invoices),
        invoices30d,
        averageInvoice30d: invoices30d === 0 ? 0 : Math.round(revenue30d / invoices30d),
        activeProducts: products.data.filter((product) => product.visible).length,
      },
      revenueByDay,
      topProducts: [...sales.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      expiringBatches: products.data
        .flatMap((product) =>
          product.batches.flatMap((batch) =>
            batch.expiresAt !== null &&
            batch.expiresAt >= now &&
            batch.expiresAt < now + EXPIRY_DAYS * DAY_MS &&
            (batch.packQuantity > 0 || batch.unitQuantity > 0)
              ? [
                  {
                    productId: product.id,
                    productName: product.name,
                    batchNumber: batch.batchNumber,
                    expiresAt: batch.expiresAt,
                    packQuantity: batch.packQuantity,
                    unitQuantity: batch.unitQuantity,
                  },
                ]
              : [],
          ),
        )
        .sort((a, b) => a.expiresAt - b.expiresAt)
        .slice(0, 8),
      lowStock: products.data
        .filter((product) => product.visible)
        .map((product) => ({
          productId: product.id,
          productName: product.name,
          packQuantity: product.batches.reduce((sum, batch) => sum + batch.packQuantity, 0),
          unitQuantity: product.batches.reduce((sum, batch) => sum + batch.unitQuantity, 0),
          totalUnits: product.batches.reduce(
            (sum, batch) => sum + batch.packQuantity * product.unitsPerPack + batch.unitQuantity,
            0,
          ),
        }))
        .filter((product) => product.totalUnits <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => a.totalUnits - b.totalUnits || a.productName.localeCompare(b.productName))
        .slice(0, 8)
        .map(({ totalUnits: _totalUnits, ...product }) => product),
      recentInvoices: invoices.data.slice(0, 5).map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        total: invoice.total,
        createdAt: invoice.createdAt,
      })),
    };
  }, [invoices.data, now, products.data]);

  return {
    data,
    isError: invoices.isError || products.isError,
    hasCachedData: invoices.data.length > 0 || products.data.length > 0,
    isLoading: false,
  };
};
