import type { Product } from "@store/contracts";
import { productStock, productStockValue } from "@store/contracts/store-helpers";
import { EyeClosedIcon, EyeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
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
    stockValue += productStockValue(product);
  }

  return { outOfStock, lowStock, hidden, stockValue };
};

function PrivateStockValue({ value }: { value: string }) {
  const [visible, setVisible] = useState(false);
  const actionLabel = visible ? "Hide stock value" : "Show stock value";

  return (
    <div className="relative bg-background px-3 py-2">
      <p className="truncate text-muted-foreground text-xs">Stock value</p>
      <p
        aria-label={visible ? `Stock value ${value}` : "Stock value hidden"}
        className="font-medium font-mono text-lg tabular-nums"
      >
        {visible ? value : "••••••"}
      </p>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={actionLabel}
              aria-pressed={visible}
              className="absolute end-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity in-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              onClick={() => setVisible((current) => !current)}
              size="icon-xs"
              type="button"
              variant="ghost"
            />
          }
        >
          <HugeiconsIcon aria-hidden="true" icon={visible ? EyeClosedIcon : EyeIcon} />
        </TooltipTrigger>
        <TooltipPopup>{actionLabel}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

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
    { label: "Hidden", value: String(hidden) },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-5">
      {tiles.slice(0, 3).map((tile) => (
        <div className="bg-background px-3 py-2" key={tile.label}>
          <p className="truncate text-muted-foreground text-xs">{tile.label}</p>
          <p className={`font-medium font-mono text-lg tabular-nums ${tile.tone ?? ""}`}>
            {tile.value}
          </p>
        </div>
      ))}
      <PrivateStockValue value={formatPrice(stockValue)} />
      {tiles.slice(3).map((tile) => (
        <div className="bg-background px-3 py-2" key={tile.label}>
          <p className="truncate text-muted-foreground text-xs">{tile.label}</p>
          <p className={`font-medium font-mono text-lg tabular-nums ${tile.tone ?? ""}`}>
            {tile.value}
          </p>
        </div>
      ))}
    </div>
  );
}
