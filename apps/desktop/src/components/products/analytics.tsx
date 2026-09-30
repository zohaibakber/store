import { EyeClosedIcon, EyeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatPrice } from "@store/services/format";
import { Link } from "@tanstack/react-router";
import { Suspense, useState } from "react";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import type { RestockView } from "@/components/insights/restock-page";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { EMPTY, formatNumber } from "@/lib/format";
import { useInventoryInsights } from "@/lib/inventory";
import { cn } from "@/lib/utils";

function PrivateStockValue({ value }: { value: string }) {
  const [visible, setVisible] = useState(false);
  const actionLabel = visible ? "Hide stock value" : "Show stock value";

  return (
    <div className="relative bg-background px-3 py-1.5">
      <p className="truncate text-xs text-muted-foreground">Stock value at cost</p>
      <p
        aria-label={visible ? `Stock value ${value}` : "Stock value hidden"}
        className="text-base font-medium tabular-nums"
      >
        {visible ? value : "••••••"}
      </p>
      <div className="absolute inset-e-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 in-hover:opacity-100 pointer-coarse:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={actionLabel}
                aria-pressed={visible}
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
    </div>
  );
}

function StockTile({
  label,
  value,
  view,
  tone,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly view: RestockView;
  readonly tone: "error" | "warning" | "none";
}) {
  return (
    <Link
      className="bg-background px-3 py-1.5 outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
      search={{ view }}
      to="/restock"
    >
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-base font-medium tabular-nums",
          value !== null && value > 0 && tone === "error" && "text-destructive-foreground",
          value !== null && value > 0 && tone === "warning" && "text-warning-foreground",
        )}
      >
        {value === null ? EMPTY : formatNumber(value)}
      </p>
    </Link>
  );
}

type TileSpec = {
  readonly label: string;
  readonly view: RestockView;
  readonly status: "out" | "critical" | "low" | "overstock" | "dead";
  readonly tone: "error" | "warning" | "none";
};

const TILES: ReadonlyArray<TileSpec> = [
  { label: "Out of stock", view: "out", status: "out", tone: "error" },
  { label: "Running out", view: "critical", status: "critical", tone: "error" },
  { label: "Reorder", view: "low", status: "low", tone: "warning" },
  { label: "Overstocked", view: "overstock", status: "overstock", tone: "none" },
  { label: "Not selling", view: "dead", status: "dead", tone: "none" },
];

function StockTiles() {
  const { summary } = useInventoryInsights();
  if (summary === null) return PENDING_TILES;
  const { counts } = summary;
  return (
    <>
      {TILES.map((tile) => (
        <StockTile
          key={tile.view}
          label={tile.label}
          tone={tile.tone}
          value={counts[tile.status]}
          view={tile.view}
        />
      ))}
      <PrivateStockValue value={formatPrice(summary.inventory.valueAtCost)} />
    </>
  );
}

const PENDING_TILES = (
  <>
    {TILES.map((tile) => (
      <StockTile key={tile.view} label={tile.label} tone="none" value={null} view={tile.view} />
    ))}
    <PrivateStockValue value={EMPTY} />
  </>
);

export function ProductAnalytics() {
  return (
    <div
      aria-live="polite"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-6"
    >
      <AppErrorBoundary fallback={PENDING_TILES}>
        <Suspense fallback={PENDING_TILES}>
          <StockTiles />
        </Suspense>
      </AppErrorBoundary>
    </div>
  );
}
