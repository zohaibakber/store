import { EyeClosedIcon, EyeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatPrice } from "@store/services/format";
import { Link } from "@tanstack/react-router";
import { Suspense, useState } from "react";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import type { RestockView } from "@/components/insights/restock-page";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useInventoryInsights } from "@/lib/inventory";
import { cn } from "@/lib/utils";

function PrivateStockValue({ value }: { value: string }) {
  const [visible, setVisible] = useState(false);
  const actionLabel = visible ? "Hide stock value" : "Show stock value";

  return (
    <div className="relative bg-background px-3 py-2">
      <p className="truncate text-xs text-muted-foreground">Stock value at cost</p>
      <p
        aria-label={visible ? `Stock value ${value}` : "Stock value hidden"}
        className="text-lg font-medium tabular-nums"
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
      className="bg-background px-3 py-2 outline-none hover:bg-accent/40 focus-visible:bg-accent/40"
      search={{ view }}
      to="/restock"
    >
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-medium tabular-nums",
          value !== null && value > 0 && tone === "error" && "text-destructive-foreground",
          value !== null && value > 0 && tone === "warning" && "text-warning-foreground",
        )}
      >
        {value === null ? "—" : value}
      </p>
    </Link>
  );
}

function StockTiles() {
  const { report } = useInventoryInsights();
  const { counts } = report;
  return (
    <>
      <StockTile label="Out of stock" tone="error" value={counts.out} view="out" />
      <StockTile
        label="Running low"
        tone="warning"
        value={counts.critical + counts.low}
        view="action"
      />
      <StockTile label="Not selling" tone="none" value={counts.dead} view="dead" />
      <StockTile label="Overstocked" tone="none" value={counts.overstock} view="overstock" />
      <PrivateStockValue value={formatPrice(report.inventory.valueAtCost)} />
    </>
  );
}

const PENDING_TILES = (
  <>
    <StockTile label="Out of stock" tone="none" value={null} view="out" />
    <StockTile label="Running low" tone="none" value={null} view="action" />
    <StockTile label="Not selling" tone="none" value={null} view="dead" />
    <StockTile label="Overstocked" tone="none" value={null} view="overstock" />
    <PrivateStockValue value="—" />
  </>
);

export function ProductAnalytics() {
  return (
    <div
      aria-live="polite"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-5"
    >
      <AppErrorBoundary fallback={PENDING_TILES}>
        <Suspense fallback={PENDING_TILES}>
          <StockTiles />
        </Suspense>
      </AppErrorBoundary>
    </div>
  );
}
