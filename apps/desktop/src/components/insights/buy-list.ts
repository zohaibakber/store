import type { ProductInsight } from "@store/services/insights";

import { STATUS_META } from "./presentation";

const FORMULA_PREFIX = /^[\s]*[=+@-]/u;

const cell = (value: string | number) => {
  const text = String(value);
  const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/gu, '""')}"`;
};

const money = (paisa: number | null) => (paisa === null ? "" : (paisa / 100).toFixed(2));

const HEADER = [
  "Product",
  "Category",
  "Class",
  "Status",
  "Usable units",
  "Units per day",
  "Days of cover",
  "Reorder point",
  "On order units",
  "Order quantity",
  "Order unit",
  "Order base units",
  "Estimated cost",
];

const csvLine = (values: ReadonlyArray<string | number>) => values.map(cell).join(",");

export const buyListHeader = () => csvLine(HEADER);

export const buyListLine = (insight: ProductInsight): string | null =>
  insight.order === null
    ? null
    : csvLine([
        insight.name,
        insight.categoryName ?? "",
        insight.abc,
        STATUS_META[insight.status].label,
        insight.usableUnits,
        insight.demand.dailyRate.toFixed(2),
        insight.daysOfCover === null ? "" : Math.floor(insight.daysOfCover),
        insight.reorderPoint,
        insight.onOrderUnits,
        insight.order.quantity,
        insight.order.unit,
        insight.order.baseUnits,
        money(insight.order.cost),
      ]);

export const downloadText = (filename: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
