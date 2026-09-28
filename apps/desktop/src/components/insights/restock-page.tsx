import { Download01Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatPrice } from "@store/services/format";
import type { InsightsReport, ProductInsight, StockStatus } from "@store/services/insights";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import * as React from "react";

import { LoadingSpinner } from "@/components/app/loading-spinner";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableContent,
  DataTableFilter,
  DataTableFooter,
  DataTablePagination,
  type DataTableColumnMeta,
} from "@/components/shared/data-table";
import { PageActions } from "@/components/shared/page-actions";
import { PageLayout } from "@/components/shared/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { EMPTY, formatNumber } from "@/lib/format";
import { useInventoryInsights } from "@/lib/inventory";

import { buyListCsv, downloadText } from "./buy-list";
import { PlanningSheet } from "./planning-sheet";
import {
  describeDemand,
  formatOrder,
  formatRate,
  formatStockCover,
  HEALTH_ORDER,
} from "./presentation";
import { InsightsRefreshing } from "./refreshing";
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
  out: "Out of stock",
  critical: "Running out",
  low: "Reorder",
  overstock: "Overstocked",
  dead: "Not selling",
  all: "All",
} satisfies Record<RestockView, string>;

const PAGE_SIZES = [25, 50, 100] as const;

const STATUS_RANK = new Map<StockStatus, number>(
  [...HEALTH_ORDER, "inactive" as const].map((status, index) => [status, index]),
);

const inView = (view: RestockView) => (insight: ProductInsight) => {
  const statuses = VIEW_STATUSES[view];
  return statuses === null ? insight.status !== "inactive" : statuses.has(insight.status);
};

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: { basic: sortFn_basic, text: sortFn_text },
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

const columnHelper = createColumnHelper<typeof features, ProductInsight>();

function TwoLine({
  primary,
  secondary,
  title,
}: {
  readonly primary: React.ReactNode;
  readonly secondary: React.ReactNode;
  readonly title?: string;
}) {
  return (
    <div className="-my-1 flex min-w-0 flex-col gap-0.5" title={title}>
      <span className="truncate text-sm leading-none">{primary}</span>
      <span className="truncate text-xs leading-none text-muted-foreground">{secondary}</span>
    </div>
  );
}

const trendArrow = (trend: ProductInsight["demand"]["trend"]) =>
  trend === "rising" ? " ↑" : trend === "falling" ? " ↓" : "";

const columns = columnHelper.columns([
  columnHelper.accessor("name", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Product" />,
    cell: ({ row }) => (
      <div className="w-72 max-w-72">
        <TwoLine
          primary={
            <Link
              className="font-medium outline-none hover:underline focus-visible:underline"
              onClick={(event) => event.stopPropagation()}
              params={{ productId: row.original.productId }}
              to="/products/$productId"
            >
              {row.original.name}
            </Link>
          }
          secondary={`${row.original.categoryName ?? "Uncategorized"} · Class ${row.original.abc}`}
        />
      </div>
    ),
    filterFn: "includesString",
    sortFn: "text",
    meta: { label: "Product" },
  }),
  columnHelper.accessor((insight) => STATUS_RANK.get(insight.status) ?? 0, {
    id: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    sortFn: "basic",
    meta: { label: "Status" },
  }),
  columnHelper.accessor("usableUnits", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="On hand" />,
    cell: ({ row }) => (
      <TwoLine
        primary={formatNumber(row.original.usableUnits)}
        secondary={formatStockCover(row.original)}
      />
    ),
    sortFn: "basic",
    meta: { label: "On hand", align: "end" },
  }),
  columnHelper.accessor((insight) => insight.demand.dailyRate, {
    id: "demand",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Demand" />,
    cell: ({ row }) => (
      <TwoLine
        primary={`${formatRate(row.original.demand.dailyRate)} / day${trendArrow(row.original.demand.trend)}`}
        secondary={`${formatNumber(row.original.units30d)} in 30 days`}
        title={describeDemand(row.original.demand)}
      />
    ),
    sortFn: "basic",
    meta: { label: "Demand", align: "end" },
  }),
  columnHelper.accessor("reorderPoint", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Reorder at" />,
    cell: ({ getValue }) => formatNumber(getValue()),
    sortFn: "basic",
    meta: { label: "Reorder at", align: "end" },
  }),
  columnHelper.accessor((insight) => insight.order?.cost ?? -1, {
    id: "order",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Suggested order" />,
    cell: ({ row }) => {
      const order = row.original.order;
      if (order === null) return <span className="text-muted-foreground">{EMPTY}</span>;
      return (
        <TwoLine
          primary={<span className="font-medium">{formatOrder(order)}</span>}
          secondary={order.cost === null ? "No cost price" : formatPrice(order.cost)}
        />
      );
    },
    sortFn: "basic",
    meta: { label: "Suggested order", align: "end" },
  }),
]);

function ExportButton() {
  const { report } = useInventoryInsights();
  return (
    <Button
      disabled={report.inventory.reorderCount === 0}
      onClick={() =>
        downloadText("buy-list.csv", buyListCsv(report.products), "text/csv;charset=utf-8")
      }
      size="sm"
      variant="outline"
    >
      <HugeiconsIcon aria-hidden="true" icon={Download01Icon} />
      Export
    </Button>
  );
}

function PolicyInfo({ report }: { readonly report: InsightsReport }) {
  const { policy } = report;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label="How suggestions work" size="icon-xs" type="button" variant="ghost" />
        }
      >
        <HugeiconsIcon aria-hidden="true" icon={InformationCircleIcon} />
      </TooltipTrigger>
      <TooltipPopup className="max-w-72">
        Forecasts use each product's last 90 days on this device. Reorder points cover a{" "}
        {Math.round(policy.serviceLevel * 1000) / 10}% service level over a {policy.leadDays}-day
        lead time, and orders last {policy.coverDays} more days. Check open supplier orders before
        buying.
      </TooltipPopup>
    </Tooltip>
  );
}

function RestockBody({
  view,
  onViewChange,
}: {
  readonly view: RestockView;
  readonly onViewChange: (view: RestockView) => void;
}) {
  const { report } = useInventoryInsights();
  const navigate = useNavigate();
  const counts = React.useMemo(
    () =>
      Object.fromEntries(
        RESTOCK_VIEWS.map((value) => [value, report.products.filter(inView(value)).length]),
      ),
    [report.products],
  );
  const rows = React.useMemo(() => report.products.filter(inView(view)), [report.products, view]);
  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId: (insight) => insight.productId,
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
  });
  React.useEffect(() => {
    table.setPageIndex(0);
  }, [table, view]);

  return (
    <DataTable
      onRowClick={(row) =>
        navigate({ to: "/products/$productId", params: { productId: row.original.productId } })
      }
      className="gap-3"
      table={table}
    >
      <PageActions>
        <InsightsRefreshing />
        <DataTableFilter columnId="name" placeholder="Search products" />
        <ExportButton />
        <PlanningSheet />
      </PageActions>
      <div className="flex items-center gap-2">
        <div className="min-w-0 overflow-x-auto">
          <Tabs onValueChange={(next: RestockView) => onViewChange(next)} value={view}>
            <TabsList aria-label="Stock view">
              {RESTOCK_VIEWS.map((value) => (
                <TabsTab key={value} value={value}>
                  {VIEW_LABEL[value]}
                  <Badge variant="outline">
                    <span className="tabular-nums">{formatNumber(counts[value] ?? 0)}</span>
                  </Badge>
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <PolicyInfo report={report} />
      </div>
      <DataTableContent>
        <DataTableFooter>
          <DataTablePagination pageSizes={PAGE_SIZES} />
        </DataTableFooter>
      </DataTableContent>
    </DataTable>
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
    <PageLayout>
      <React.Suspense fallback={<LoadingSpinner className="h-96" label="Loading restock plan" />}>
        <RestockBody onViewChange={onViewChange} view={view} />
      </React.Suspense>
    </PageLayout>
  );
}
