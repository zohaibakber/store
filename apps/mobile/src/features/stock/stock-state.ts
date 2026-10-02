import type { Product, StockMovement } from "@store/contracts";
import type { ProductStockSummary } from "@store/inventory-react";

import { DAY_MS, formatCount, formatSignedCount } from "../format";

const EXPIRY_WINDOW_DAYS = 90;

export type StockFilter = "all" | "lowStock" | "expiringSoon";

export const stockFilters: ReadonlyArray<{ readonly id: StockFilter; readonly label: string }> = [
  { id: "all", label: "All" },
  { id: "lowStock", label: "Low stock" },
  { id: "expiringSoon", label: "Expiring soon" },
];

type StockAttention = "expired" | "outOfStock" | "lowStock" | "expiringSoon";

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

type BatchAttention = "expired" | "expiringSoon";

export const batchAttention = (expiresAt: number | null, now: number): BatchAttention | null => {
  if (expiresAt === null) return null;
  if (expiresAt <= now) return "expired";
  return expiresWithinWindow(expiresAt, now) ? "expiringSoon" : null;
};

type OnHand = { readonly value: string; readonly unit: string };

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

const countsUnitsOnly = (unitsPerPack: number, tracksPacks: boolean) =>
  !tracksPacks || unitsPerPack <= 1;

export const onHandOf = (units: number, unitsPerPack: number, tracksPacks: boolean): OnHand => {
  if (countsUnitsOnly(unitsPerPack, tracksPacks)) {
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
  if (countsUnitsOnly(unitsPerPack, tracksPacks)) {
    const units = packQuantity * unitsPerPack + unitQuantity;
    return `${formatCount(units)} ${plural(units, "unit", "units")}`;
  }
  const packs = `${formatCount(packQuantity)} ${plural(packQuantity, "pack", "packs")}`;
  return unitQuantity > 0 ? `${packs} + ${formatCount(unitQuantity)}` : packs;
};

export const movementLabel = (type: StockMovement["type"]) => {
  switch (type) {
    case "stock_in":
      return "Received";
    case "sale":
      return "Sold";
    case "open_pack":
      return "Pack opened";
    case "adjustment":
      return "Adjusted";
  }
};

const signedPart = (delta: number, one: string, many: string) =>
  `${formatSignedCount(delta)} ${plural(Math.abs(delta), one, many)}`;

export const movementDelta = (
  movement: Pick<StockMovement, "packDelta" | "unitDelta">,
  unitsPerPack: number,
  tracksPacks: boolean,
) => {
  if (countsUnitsOnly(unitsPerPack, tracksPacks)) {
    return signedPart(movement.packDelta * unitsPerPack + movement.unitDelta, "unit", "units");
  }
  const parts = [
    movement.packDelta === 0 ? null : signedPart(movement.packDelta, "pack", "packs"),
    movement.unitDelta === 0 ? null : signedPart(movement.unitDelta, "unit", "units"),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "No change" : parts.join(", ");
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
