import type { Invoice, Product } from "@store/contracts";

import { forecastDemand } from "./demand";
import type { StockPolicy } from "./policy";

const DAY_MS = 86_400_000;
export type StockStatus = "out" | "low" | "healthy";
export type StockRecommendation = ReturnType<typeof recommendProduct>;

type Demand = {
  dailyUnits: number[];
  recentUnits: number;
  previousUnits: number;
  units90d: number;
  sellingDays: Set<number>;
};

function recommendProduct(product: Product, demand: Demand, policy: StockPolicy, now: number) {
  const ageDays = Math.max(1, Math.ceil((now - product.createdAt) / DAY_MS));
  const observedDays = Math.min(30, ageDays);
  const recentDays = Math.min(7, observedDays);
  const previousDays = Math.max(0, observedDays - recentDays);
  const recentRate = demand.recentUnits / recentDays;
  const previousRate = previousDays > 0 ? demand.previousUnits / previousDays : 0;
  const forecast = forecastDemand(demand.dailyUnits, Math.min(90, ageDays));
  const { dailyDemand } = forecast;
  const units30d = demand.recentUnits + demand.previousUnits;
  const history: "established" | "limited" =
    observedDays >= 14 && demand.sellingDays.size >= 5 ? "established" : "limited";
  const trend: "unknown" | "rising" | "falling" | "steady" =
    previousDays < 7 || demand.sellingDays.size < 3
      ? "unknown"
      : previousRate === 0
        ? recentRate > 0
          ? "rising"
          : "steady"
        : recentRate >= previousRate * 1.25
          ? "rising"
          : recentRate <= previousRate * 0.75
            ? "falling"
            : "steady";
  let availableUnits = 0;
  let expiredUnits = 0;
  let expiryRiskUnits = 0;
  let allocated = 0;
  const horizonDays = policy.leadDays + policy.coverDays + policy.safetyDays;
  const batches = [...product.batches].sort(
    (a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity),
  );
  for (const batch of batches) {
    const units = Math.max(0, batch.packQuantity * product.unitsPerPack + batch.unitQuantity);
    if (batch.expiresAt !== null && batch.expiresAt <= now) {
      expiredUnits += units;
      continue;
    }
    availableUnits += units;
    if (batch.expiresAt !== null && batch.expiresAt <= now + horizonDays * DAY_MS) {
      const demandBeforeExpiry = (dailyDemand * (batch.expiresAt - now)) / DAY_MS;
      const sellable = Math.min(units, Math.max(0, demandBeforeExpiry - allocated));
      expiryRiskUnits += units - sellable;
      allocated += sellable;
    }
  }
  expiryRiskUnits = Math.ceil(expiryRiskUnits);
  const usableUnits = availableUnits - expiryRiskUnits;
  const reorderPoint = Math.max(
    policy.minimumUnits,
    Math.ceil(dailyDemand * (policy.leadDays + policy.safetyDays)),
  );
  const status: StockStatus =
    availableUnits === 0 ? "out" : usableUnits <= reorderPoint ? "low" : "healthy";
  const daysRemaining = dailyDemand > 0 ? usableUnits / dailyDemand : null;
  const slowMoving =
    ageDays >= 30 &&
    availableUnits > 0 &&
    (units30d === 0 || (daysRemaining !== null && daysRemaining > 90));
  // Sparse history should not turn a single large sale into an automatic purchase recommendation.
  const targetUnits = Math.max(policy.minimumUnits, Math.ceil(dailyDemand * horizonDays));
  const suggestedUnits =
    status !== "healthy" && history === "established" && dailyDemand > 0 && !slowMoving
      ? Math.max(0, targetUnits - usableUnits)
      : 0;
  const orderSize = product.category.tracksPacks ? product.unitsPerPack : 1;
  const orderQuantity = Math.ceil(suggestedUnits / orderSize);
  const orderUnit: "packs" | "units" = product.category.tracksPacks ? "packs" : "units";
  return {
    productId: product.id,
    productName: product.name,
    status,
    availableUnits,
    expiredUnits,
    expiryRiskUnits,
    units30d,
    recentUnits: demand.recentUnits,
    previousUnits: demand.previousUnits,
    observedDays,
    sellingDays: demand.sellingDays.size,
    units90d: demand.units90d,
    ...forecast,
    daysRemaining,
    reorderPoint,
    history,
    trend,
    slowMoving,
    orderQuantity,
    orderUnit,
    orderUnits: orderQuantity * orderSize,
    estimatedCost: product.purchasePrice === null ? null : orderQuantity * product.purchasePrice,
  };
}

export function recommendStock(
  products: ReadonlyArray<Product>,
  invoices: ReadonlyArray<Invoice>,
  policy: StockPolicy,
  now: number,
) {
  const demandByProduct = new Map<Product["id"], Demand>();
  for (const invoice of invoices) {
    if (invoice.createdAt > now || invoice.createdAt <= now - 90 * DAY_MS) continue;
    for (const item of invoice.items) {
      const demand = demandByProduct.get(item.productId) ?? {
        dailyUnits: [],
        recentUnits: 0,
        previousUnits: 0,
        units90d: 0,
        sellingDays: new Set<number>(),
      };
      const offset = Math.floor((now - invoice.createdAt) / DAY_MS);
      demand.dailyUnits[offset] = (demand.dailyUnits[offset] ?? 0) + item.baseUnitQuantity;
      demand.units90d += item.baseUnitQuantity;
      if (invoice.createdAt > now - 30 * DAY_MS) {
        if (item.baseUnitQuantity > 0)
          demand.sellingDays.add(Math.floor(invoice.createdAt / DAY_MS));
        if (invoice.createdAt > now - 7 * DAY_MS) demand.recentUnits += item.baseUnitQuantity;
        else demand.previousUnits += item.baseUnitQuantity;
      }
      demandByProduct.set(item.productId, demand);
    }
  }
  const priority = { out: 0, low: 1, healthy: 2 };
  return products
    .filter((product) => product.visible)
    .map((product) =>
      recommendProduct(
        product,
        demandByProduct.get(product.id) ?? {
          dailyUnits: [],
          recentUnits: 0,
          previousUnits: 0,
          units90d: 0,
          sellingDays: new Set<number>(),
        },
        policy,
        now,
      ),
    )
    .sort(
      (a, b) =>
        priority[a.status] - priority[b.status] ||
        Number(b.orderQuantity > 0) - Number(a.orderQuantity > 0) ||
        (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity) ||
        b.dailyDemand - a.dailyDemand ||
        a.productName.localeCompare(b.productName),
    );
}
