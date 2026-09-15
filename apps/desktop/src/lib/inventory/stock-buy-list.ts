import type { StockRecommendation } from "@store/services/stock-recommendations";

export function stockBuyListCsv(recommendations: ReadonlyArray<StockRecommendation>) {
  const cell = (value: string | number) => {
    const text = String(value);
    // Spreadsheet applications interpret these leading characters as formulas, even inside quotes.
    const safe = /^[\s]*[=+@-]/u.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/gu, '""')}"`;
  };
  return [
    [
      "Product",
      "Status",
      "Available units",
      "Sold in 30 days",
      "Order quantity",
      "Order unit",
      "Order base units",
    ],
    ...recommendations
      .filter((row) => row.orderQuantity > 0)
      .map((row) => [
        row.productName,
        row.status,
        row.availableUnits,
        row.units30d,
        row.orderQuantity,
        row.orderUnit,
        row.orderUnits,
      ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
