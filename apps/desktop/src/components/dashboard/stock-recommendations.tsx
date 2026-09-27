import type { RecommendationState } from "@store/inventory-react";
import type { StockPolicy, StockRecommendation } from "@store/services/stock-recommendations";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { StockPlanning } from "@/components/dashboard/stock-planning";
import { FrameCard } from "@/components/shared/frame-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/format";
import { stockBuyListCsv } from "@/lib/inventory/stock-buy-list";

type Filter = "attention" | "out" | "low" | "buy" | "slow" | "all";
const filters: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "attention", label: "Needs attention" },
  { value: "out", label: "Out of stock" },
  { value: "low", label: "Low stock" },
  { value: "buy", label: "Buy list" },
  { value: "slow", label: "Slow moving" },
  { value: "all", label: "All products" },
];
const needsAttention = (row: StockRecommendation) =>
  row.status !== "healthy" || row.slowMoving || row.expiryRiskUnits > 0 || row.expiredUnits > 0;
function matches(row: StockRecommendation, filter: Filter) {
  switch (filter) {
    case "attention":
      return needsAttention(row);
    case "out":
      return row.status === "out";
    case "low":
      return row.status === "low";
    case "buy":
      return row.orderQuantity > 0;
    case "slow":
      return row.slowMoving;
    case "all":
      return true;
  }
}

function RecommendationRow({ row }: { row: StockRecommendation }) {
  return (
    <li className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="font-medium capitalize hover:underline"
            params={{ productId: row.productId }}
            to="/products/$productId"
          >
            {row.productName}
          </Link>
          <Badge
            variant={
              row.status === "out" ? "error" : row.status === "low" ? "warning" : "secondary"
            }
          >
            {row.status === "out" ? "Out of stock" : row.status === "low" ? "Low stock" : "Stocked"}
          </Badge>
          {row.trend === "rising" && <Badge variant="info">Selling faster</Badge>}
          {row.trend === "falling" && <Badge variant="secondary">Sales slowing</Badge>}
          {row.slowMoving && <Badge variant="warning">Slow moving</Badge>}
        </div>
        <p className="text-muted-foreground">
          {row.availableUnits} unexpired units · {row.units30d} sold in 30 days ·{" "}
          {row.dailyDemand.toFixed(1)} units/day estimated
        </p>
        <p className="text-muted-foreground">
          {row.daysRemaining === null
            ? "No recent demand to estimate stock coverage."
            : `About ${Math.floor(row.daysRemaining)} days of stock. Reorder at ${row.reorderPoint} units.`}
        </p>
        <p className="text-xs text-muted-foreground">
          {row.forecastDays}-day average ·{" "}
          {row.backtestError === null
            ? "Too little history to compare forecast methods"
            : `Recent test error: ${row.backtestError.toFixed(1)} units/day`}
        </p>
        {row.expiredUnits > 0 && (
          <p className="text-destructive">
            {row.expiredUnits} expired units excluded. Review these batches.
          </p>
        )}
        {row.expiryRiskUnits > 0 && (
          <p className="text-muted-foreground">
            About {row.expiryRiskUnits} units may expire before selling. Review batches before
            ordering.
          </p>
        )}
        {row.slowMoving && (
          <p className="text-muted-foreground">
            Hold off buying.{" "}
            {row.units30d === 0
              ? `No sales in 30 days; ${row.units90d} units sold in 90 days.`
              : "Current stock covers more than 90 days of estimated demand."}
          </p>
        )}
      </div>
      <div className="space-y-1 sm:max-w-64 sm:text-right">
        {row.orderQuantity > 0 ? (
          <>
            <p className="font-medium">
              Suggested buy: {row.orderQuantity} {row.orderUnit}
            </p>
            <p className="text-muted-foreground">
              {row.orderUnits} base units
              {row.estimatedCost !== null
                ? ` · about ${formatPrice(row.estimatedCost)}`
                : " · purchase price missing"}
            </p>
          </>
        ) : (
          <p className="font-medium">
            {row.status !== "healthy" ? "Review before buying" : "No purchase suggested"}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {row.history === "limited"
            ? "Limited history. Check demand before choosing an order quantity."
            : `Sales on ${row.sellingDays} days in ${row.observedDays} days of history.`}
        </p>
      </div>
    </li>
  );
}

export function StockRecommendations({
  state,
  policy,
  onPolicyChange,
}: {
  state: RecommendationState;
  policy: StockPolicy;
  onPolicyChange: (policy: StockPolicy) => void;
}) {
  const recommendations = state._tag === "Ready" ? state.report.recommendations : [];
  const [filter, setFilter] = useState<Filter>("attention");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const visible = recommendations.filter(
    (row) =>
      matches(row, filter) &&
      row.productName.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()),
  );
  const buyList = recommendations.filter((row) => row.orderQuantity > 0);
  const exportList = () => {
    const url = URL.createObjectURL(
      new Blob([stockBuyListCsv(buyList)], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "stock-buy-list.csv";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <FrameCard
      title="Stock & purchasing"
      description="Prioritized recommendations from your saved sales and available batches."
      action={
        <Button disabled={buyList.length === 0} onClick={exportList} variant="outline">
          Export buy list ({buyList.length})
        </Button>
      }
    >
      <div className="space-y-4">
        <StockPlanning policy={policy} onPolicyChange={onPolicyChange} />
        <div aria-label="Stock filters" className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <Button
              key={item.value}
              aria-pressed={filter === item.value}
              variant={filter === item.value ? "secondary" : "outline"}
              onClick={() => {
                setFilter(item.value);
                setLimit(20);
              }}
            >
              {item.label} ({recommendations.filter((row) => matches(row, item.value)).length})
            </Button>
          ))}
        </div>
        <Input
          aria-label="Search stock recommendations"
          placeholder="Search products…"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setLimit(20);
          }}
        />
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {visible.length} {visible.length === 1 ? "product" : "products"}
          {search ? " matching your search" : ""}
        </p>
        {state._tag === "Loading" ? (
          <p role="status">Calculating stock recommendations…</p>
        ) : state._tag === "Error" ? (
          <p role="alert" className="text-destructive">
            {state.message}
          </p>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">
            {recommendations.length === 0
              ? "Add visible products to see stock recommendations. Sales history will improve purchasing suggestions."
              : "No products match this view."}
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.slice(0, limit).map((row) => (
              <RecommendationRow key={row.productId} row={row} />
            ))}
          </ul>
        )}
        {visible.length > limit && (
          <Button variant="outline" onClick={() => setLimit(limit + 20)}>
            Show more ({visible.length - limit} remaining)
          </Button>
        )}
      </div>
    </FrameCard>
  );
}
