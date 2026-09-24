import type { Product } from "@store/contracts";
import type { ProductStockSummary } from "@store/inventory-react";

import { DAY_MS, formatCount } from "../format";

const EXPIRY_WINDOW_DAYS = 90;

export type StockFilter = "all" | "lowStock" | "expiringSoon";

export const stockFilters: ReadonlyArray<{ readonly id: StockFilter; readonly label: string }> = [
  { id: "all", label: "All" },
  { id: "lowStock", label: "Low stock" },
  { id: "expiringSoon", label: "Expiring soon" },
];

export type StockAttention = "expired" | "outOfStock" | "lowStock" | "expiringSoon";

type StockState = Pick<
  ProductStockSummary,
  "expiredUnits" | "status" | "lowStock" | "nearestExpiry"
>;

const expiresWithinWindow = (expiresAt: number | null, now: number) =>
  expiresAt !== null && expiresAt < now + EXPIRY_WINDOW_DAYS * DAY_MS;

const isExpiringSoon = (stock: StockState, now: number) =>
  stock.expiredUnits > 0 || expiresWithinWindow(stock.nearestExpiry, now);

export const stockAttention = (stock: StockState, now: number): StockAttention | null => {
  if (stock.expiredUnits > 0) return "expired";
  if (stock.status === "out") return "outOfStock";
  if (stock.status === "low") return "lowStock";
  if (expiresWithinWindow(stock.nearestExpiry, now)) return "expiringSoon";
  return null;
};

export const matchesStockFilter = (stock: StockState, filter: StockFilter, now: number) => {
  switch (filter) {
    case "all":
      return true;
    case "lowStock":
      return stock.lowStock;
    case "expiringSoon":
      return isExpiringSoon(stock, now);
  }
};

export const attentionLabel = (attention: StockAttention) => {
  switch (attention) {
    case "expired":
      return "Expired stock";
    case "outOfStock":
      return "Out of stock";
    case "lowStock":
      return "Low stock";
    case "expiringSoon":
      return "Expires soon";
  }
};

export type BatchAttention = "expired" | "expiringSoon";

export const batchAttention = (expiresAt: number | null, now: number): BatchAttention | null => {
  if (expiresAt === null) return null;
  if (expiresAt <= now) return "expired";
  return expiresWithinWindow(expiresAt, now) ? "expiringSoon" : null;
};

export type OnHand = { readonly value: string; readonly unit: string };

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const onHandOf = (units: number, unitsPerPack: number, tracksPacks: boolean): OnHand => {
  if (!tracksPacks || unitsPerPack <= 1) {
    return { value: formatCount(units), unit: plural(units, "unit", "units") };
  }
  const packs = Math.floor(units / unitsPerPack);
  const loose = units - packs * unitsPerPack;
  const packUnit = plural(packs, "pack", "packs");
  return {
    value: formatCount(packs),
    unit: loose > 0 ? `${packUnit} + ${formatCount(loose)}` : packUnit,
  };
};

export const batchOnHand = (
  packQuantity: number,
  unitQuantity: number,
  unitsPerPack: number,
  tracksPacks: boolean,
) => {
  if (!tracksPacks || unitsPerPack <= 1) {
    const units = packQuantity * unitsPerPack + unitQuantity;
    return `${formatCount(units)} ${plural(units, "unit", "units")}`;
  }
  const packs = `${formatCount(packQuantity)} ${plural(packQuantity, "pack", "packs")}`;
  return unitQuantity > 0 ? `${packs} + ${formatCount(unitQuantity)}` : packs;
};

export const productSubtitle = (
  product: Pick<Product, "composition" | "strength" | "unitsPerPack">,
) =>
  [
    product.composition?.trim(),
    product.strength?.trim(),
    product.unitsPerPack > 1 ? `${formatCount(product.unitsPerPack)} per pack` : undefined,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" · ");
