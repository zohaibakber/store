import type { Product } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { formatPrice } from "@/lib/format";

// Mirrors the dashboard's low-stock rule so the two pages agree.
const LOW_STOCK_THRESHOLD = 10;

const summarize = (products: readonly Product[]) => {
  let outOfStock = 0;
  let lowStock = 0;
  let hidden = 0;
  let stockValue = 0;

  for (const product of products) {
    const stock = productStock(product);
    if (!product.visible) hidden += 1;
    if (stock === 0) outOfStock += 1;
    else if (stock <= LOW_STOCK_THRESHOLD) lowStock += 1;
    if (product.unitPrice != null) stockValue += stock * product.unitPrice;
  }

  return { outOfStock, lowStock, hidden, stockValue };
};

/**
 * A compact summary strip above the catalog — derived from the products the
 * route already loaded, so it costs no extra round-trip.
 */
export function ProductAnalytics({ products }: { products: readonly Product[] }) {
  const { outOfStock, lowStock, hidden, stockValue } = summarize(products);

  const tiles: ReadonlyArray<{ label: string; value: string; tone?: string }> = [
    { label: "Products", value: String(products.length) },
    {
      label: "Out of stock",
      value: String(outOfStock),
      tone: outOfStock > 0 ? "text-destructive-foreground" : undefined,
    },
    {
      label: `Low stock (≤${LOW_STOCK_THRESHOLD})`,
      value: String(lowStock),
      tone: lowStock > 0 ? "text-warning-foreground" : undefined,
    },
    { label: "Stock value", value: formatPrice(stockValue) },
    { label: "Hidden", value: String(hidden) },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-5">
      {tiles.map((tile) => (
        <div className="bg-background px-3 py-2" key={tile.label}>
          <p className="truncate text-muted-foreground text-xs">{tile.label}</p>
          <p className={`font-semibold text-lg tabular-nums ${tile.tone ?? ""}`}>{tile.value}</p>
        </div>
      ))}
    </div>
  );
}
