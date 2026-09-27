import { Download01Icon, PackageIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatPrice } from "@store/services/format";
import type { InsightsReport, ProductInsight, StockStatus } from "@store/services/insights";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { PageContent, PageLayout } from "@/components/shared/page-layout";
import { SegmentedRadio } from "@/components/shared/segmented-radio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardFrame } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInventoryInsights } from "@/lib/inventory";
import { cn } from "@/lib/utils";

import { buyListCsv, downloadText } from "./buy-list";
import { InsightsHeader, InsightsRefreshing } from "./header";
import { PlanningSheet } from "./planning-sheet";
import {
  describeDemand,
  formatCount,
  formatCover,
  formatOrder,
  formatRate,
  STATUS_META,
} from "./presentation";
import { StatusBadge } from "./status-badge";

export const RESTOCK_VIEWS = [
  "action",
  "out",
  "critical",
  "low",
  "overstock",
  "dead",
  "all",
] as const;
export type RestockView = (typeof RESTOCK_VIEWS)[number];

const VIEW_STATUSES = {
  action: new Set<StockStatus>(["out", "critical", "low"]),
  out: new Set<StockStatus>(["out"]),
  critical: new Set<StockStatus>(["critical"]),
  low: new Set<StockStatus>(["low"]),
  overstock: new Set<StockStatus>(["overstock"]),
  dead: new Set<StockStatus>(["dead"]),
  all: null,
} satisfies Record<RestockView, ReadonlySet<StockStatus> | null>;

const VIEW_LABEL = {
  action: "Needs action",
  out: "Out",
  critical: "Running out",
  low: "Reorder",
  overstock: "Overstock",
  dead: "Not selling",
  all: "All",
} satisfies Record<RestockView, string>;

const PAGE_SIZE = 50;

const inView = (view: RestockView) => (insight: ProductInsight) => {
  const statuses = VIEW_STATUSES[view];
  return statuses === null ? insight.status !== "inactive" : statuses.has(insight.status);
};

const normalize = (value: string) => value.toLocaleLowerCase().trim();

function RestockRow({ insight }: { readonly insight: ProductInsight }) {
  const meta = STATUS_META[insight.status];
  const trend =
    insight.demand.trend === "rising" ? " ↑" : insight.demand.trend === "falling" ? " ↓" : "";
  return (
    <TableRow>
      <TableCell>
        <div className="flex max-w-72 min-w-0 flex-col gap-1">
          <Link
            className="truncate font-medium outline-none before:absolute before:inset-0 focus-visible:underline"
            params={{ productId: insight.productId }}
            to="/products/$productId"
          >
            {insight.name}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {insight.categoryName ?? "Uncategorized"} · Class {insight.abc}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge label={meta.label} tone={meta.tone} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col items-end gap-1 tabular-nums">
          <span>{formatCount(insight.usableUnits)}</span>
          <span className="text-xs text-muted-foreground">{formatCover(insight.daysOfCover)}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div
          className="flex flex-col items-end gap-1 tabular-nums"
          title={describeDemand(insight.demand)}
        >
          <span>
            {formatRate(insight.demand.dailyRate)}/day{trend}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatCount(insight.units30d)} in 30d
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <span className="tabular-nums">{formatCount(insight.reorderPoint)}</span>
      </TableCell>
      <TableCell className="text-right">
        {insight.order === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-col items-end gap-1 tabular-nums">
            <span className="font-medium">{formatOrder(insight.order)}</span>
            <span className="text-xs text-muted-foreground">
              {insight.order.cost === null ? "No cost price" : formatPrice(insight.order.cost)}
            </span>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function RestockTable({
  report,
  view,
  query,
}: {
  readonly report: InsightsReport;
  readonly view: RestockView;
  readonly query: string;
}) {
  const [limit, setLimit] = React.useState(PAGE_SIZE);
  const needle = normalize(query);
  const rows = React.useMemo(
    () =>
      report.products
        .filter(inView(view))
        .filter((insight) => needle === "" || normalize(insight.name).includes(needle)),
    [report.products, view, needle],
  );
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon aria-hidden="true" icon={PackageIcon} />
          </EmptyMedia>
          <EmptyTitle>{needle ? "No matching products" : "Nothing here"}</EmptyTitle>
          <EmptyDescription>
            {needle ? "Try another name or view." : "No product is in this state right now."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <CardFrame className="w-full">
        <Table variant="card">
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Demand</TableHead>
              <TableHead className="text-right">Reorder at</TableHead>
              <TableHead className="text-right">Suggested order</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, limit).map((insight) => (
              <RestockRow insight={insight} key={insight.productId} />
            ))}
          </TableBody>
        </Table>
      </CardFrame>
      {rows.length > limit ? (
        <Button
          className="self-center"
          onClick={() => setLimit(limit + PAGE_SIZE)}
          variant="outline"
        >
          Show {formatCount(Math.min(PAGE_SIZE, rows.length - limit))} more
        </Button>
      ) : null}
    </div>
  );
}

const countIn = (report: InsightsReport, view: RestockView) =>
  report.products.filter(inView(view)).length;

const EXPORT_LABEL = (
  <>
    <HugeiconsIcon aria-hidden="true" icon={Download01Icon} />
    Export
  </>
);

function ExportButton() {
  const { report } = useInventoryInsights();
  return (
    <Button
      disabled={report.inventory.reorderCount === 0}
      onClick={() =>
        downloadText("buy-list.csv", buyListCsv(report.products), "text/csv;charset=utf-8")
      }
      variant="outline"
    >
      {EXPORT_LABEL}
    </Button>
  );
}

function RestockSummary() {
  const { report } = useInventoryInsights();
  const orders = report.inventory.reorderCount;
  if (orders === 0) return "Nothing needs ordering right now.";
  const cost =
    report.inventory.reorderCost > 0 ? ` · about ${formatPrice(report.inventory.reorderCost)}` : "";
  return `${formatCount(orders)} ${orders === 1 ? "product" : "products"} to order${cost}.`;
}

function RestockBody({
  view,
  onViewChange,
}: {
  readonly view: RestockView;
  readonly onViewChange: (view: RestockView) => void;
}) {
  const { report } = useInventoryInsights();
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query);
  const filtering = query !== deferredQuery;
  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="overflow-x-auto">
          <SegmentedRadio
            label="Stock view"
            onValueChange={onViewChange}
            options={RESTOCK_VIEWS.map((value) => ({
              value,
              label: (
                <>
                  {VIEW_LABEL[value]}
                  <Badge variant="outline">{formatCount(countIn(report, value))}</Badge>
                </>
              ),
            }))}
            value={view}
          />
        </div>
        <InputGroup className="md:max-w-64">
          <InputGroupInput
            aria-label="Search products"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products…"
            type="search"
            value={query}
          />
          <InputGroupAddon>
            <HugeiconsIcon aria-hidden="true" icon={Search01Icon} />
          </InputGroupAddon>
        </InputGroup>
      </div>
      <div aria-busy={filtering} className={cn("transition-opacity", filtering && "opacity-60")}>
        <RestockTable key={view} query={deferredQuery} report={report} view={view} />
      </div>
      <p className="text-xs text-muted-foreground">
        Forecasts use each product's last 90 days on this device. Reorder points add safety stock
        for a {Math.round(report.policy.serviceLevel * 1000) / 10}% service level over a{" "}
        {report.policy.leadDays}-day lead time; orders cover {report.policy.coverDays} more days.
        Check open supplier orders before buying.
      </p>
    </>
  );
}

export function RestockPage({
  view,
  onViewChange,
}: {
  readonly view: RestockView;
  readonly onViewChange: (view: RestockView) => void;
}) {
  return (
    <PageLayout contentClassName="max-w-6xl gap-4">
      <InsightsHeader
        actions={
          <>
            <React.Suspense
              fallback={
                <Button disabled variant="outline">
                  {EXPORT_LABEL}
                </Button>
              }
            >
              <ExportButton />
            </React.Suspense>
            <PlanningSheet />
          </>
        }
        description={
          <React.Suspense fallback="Reorder points and order sizes from your sales and stock.">
            <RestockSummary />
            <InsightsRefreshing />
          </React.Suspense>
        }
        title="Restock"
      />
      <PageContent>
        <React.Suspense
          fallback={
            <div aria-busy="true" aria-label="Loading restock plan">
              <Skeleton className="h-96 w-full" />
            </div>
          }
        >
          <RestockBody onViewChange={onViewChange} view={view} />
        </React.Suspense>
      </PageContent>
    </PageLayout>
  );
}
