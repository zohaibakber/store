import { Download01Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  RESTOCK_VIEWS,
  type InsightsSummary,
  type RestockCursor,
  type RestockView,
} from "@store/contracts";
import { formatPrice } from "@store/services/format";
import type { ProductInsight, StockStatus } from "@store/services/insights";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  functionalUpdate,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type PaginationState,
  type Updater,
} from "@tanstack/react-table";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as React from "react";

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
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { EMPTY, formatNumber } from "@/lib/format";
import { useInventoryInsights, useRestockExport, useRestockPage } from "@/lib/inventory";
import { isString } from "@/lib/predicates";

import { InsightsBuilding } from "./building";
import { buyListHeader, buyListLine, downloadText } from "./buy-list";
import { InsightsFreshness } from "./freshness";
import { PlanningSheet } from "./planning-sheet";
import {
  describeDemand,
  formatOrder,
  formatRate,
  formatStockCover,
  HEALTH_ORDER,
} from "./presentation";
import { StatusBadge } from "./status-badge";

export { RESTOCK_VIEWS };
export type { RestockView };

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

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
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
      <span className="truncate text-sm leading-tight">{primary}</span>
      <span className="truncate text-xs leading-tight text-muted-foreground">{secondary}</span>
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
    meta: { label: "Product" },
  }),
  columnHelper.accessor((insight) => STATUS_RANK.get(insight.status) ?? 0, {
    id: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
    meta: { label: "Demand", align: "end" },
  }),
  columnHelper.accessor("reorderPoint", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Reorder at" />,
    cell: ({ getValue }) => formatNumber(getValue()),
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
    meta: { label: "Suggested order", align: "end" },
  }),
]);

function ExportButton() {
  const { summary } = useInventoryInsights();
  const exportRestock = useRestockExport();
  const [exporting, setExporting] = React.useState(false);
  const runExport = React.useCallback(() => {
    setExporting(true);
    const lines: Array<string> = [buyListHeader()];
    void Effect.runPromise(
      exportRestock({ view: "all" }).pipe(
        Stream.runForEach((insight) =>
          Effect.sync(() => {
            const line = buyListLine(insight);
            if (line !== null) lines.push(line);
          }),
        ),
      ),
    )
      .then(() => downloadText("buy-list.csv", lines.join("\r\n"), "text/csv;charset=utf-8"))
      .catch(() =>
        toastManager.add({
          title: "Couldn't export the buy list",
          description: "The insights were recalculated. Try again in a moment.",
          type: "error",
        }),
      )
      .finally(() => setExporting(false));
  }, [exportRestock]);
  return (
    <Button
      disabled={exporting || summary === null || summary.inventory.reorderCount === 0}
      onClick={runExport}
      size="sm"
      variant="outline"
    >
      <HugeiconsIcon aria-hidden="true" icon={Download01Icon} />
      Export
    </Button>
  );
}

function PolicyInfo({ summary }: { readonly summary: InsightsSummary }) {
  const { policy } = summary;
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

const viewCount = (summary: InsightsSummary, view: RestockView) => {
  const { counts } = summary;
  switch (view) {
    case "action":
      return counts.out + counts.critical + counts.low;
    case "all":
      return (
        counts.out + counts.critical + counts.low + counts.dead + counts.overstock + counts.healthy
      );
    default:
      return counts[view];
  }
};

type Paging = {
  readonly scope: string;
  readonly cursors: ReadonlyArray<RestockCursor | null>;
  readonly total: number;
};

function RestockBody({
  view,
  onViewChange,
}: {
  readonly view: RestockView;
  readonly onViewChange: (view: RestockView) => void;
}) {
  const { summary } = useInventoryInsights();
  const navigate = useNavigate();
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [pageSize, setPageSize] = React.useState<number>(50);
  const [isPending, startTransition] = React.useTransition();
  const term = search.trim();
  const scope = `${view}|${term}|${pageSize}`;
  const [stored, setStored] = React.useState<Paging>({ scope, cursors: [null], total: 0 });
  const paging: Paging = stored.scope === scope ? stored : { scope, cursors: [null], total: 0 };
  const pageIndex = paging.cursors.length - 1;
  const page = useRestockPage({
    filters: { view, search: term === "" ? undefined : term },
    cursor: paging.cursors[pageIndex] ?? null,
    limit: pageSize,
  });
  const rowCount = pageIndex === 0 ? (page.total ?? 0) : paging.total;
  const pagination: PaginationState = { pageIndex, pageSize };
  const columnFilters: ColumnFiltersState = term === "" ? [] : [{ id: "name", value: term }];

  if (page.cursorExpired && pageIndex > 0) setStored({ scope, cursors: [null], total: 0 });

  const table = useTable({
    features,
    columns,
    data: page.rows,
    getRowId: (insight) => insight.productId,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableSorting: false,
    rowCount,
    state: { pagination, columnFilters },
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next = functionalUpdate(updater, pagination);
      if (next.pageSize !== pageSize) {
        setPageSize(next.pageSize);
        return;
      }
      startTransition(() => {
        if (next.pageIndex === pageIndex + 1 && page.nextCursor !== null) {
          setStored({
            scope,
            cursors: [...paging.cursors, page.nextCursor],
            total: rowCount,
          });
        } else if (next.pageIndex === pageIndex - 1 && pageIndex > 0) {
          setStored({ scope, cursors: paging.cursors.slice(0, -1), total: paging.total });
        }
      });
    },
    onColumnFiltersChange: (updater: Updater<ColumnFiltersState>) => {
      const next = functionalUpdate(updater, columnFilters);
      const value = next.find((filter) => filter.id === "name")?.value;
      setSearch(isString(value) ? value : "");
    },
  });

  return (
    <DataTable
      onRowClick={(row) =>
        navigate({ to: "/products/$productId", params: { productId: row.original.productId } })
      }
      onRowPreload={(row) =>
        void router.preloadRoute({
          to: "/products/$productId",
          params: { productId: row.original.productId },
        })
      }
      className="gap-3"
      table={table}
    >
      <PageActions>
        <InsightsFreshness />
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
                    <span className="tabular-nums">
                      {formatNumber(summary === null ? 0 : viewCount(summary, value))}
                    </span>
                  </Badge>
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {summary === null ? null : <PolicyInfo summary={summary} />}
      </div>
      <div
        aria-busy={isPending}
        className={isPending ? "opacity-60 transition-opacity" : "transition-opacity"}
      >
        <DataTableContent>
          <DataTableFooter>
            <DataTablePagination pageSizes={PAGE_SIZES} />
          </DataTableFooter>
        </DataTableContent>
      </div>
    </DataTable>
  );
}

function RestockGate({
  view,
  onViewChange,
}: {
  readonly view: RestockView;
  readonly onViewChange: (view: RestockView) => void;
}) {
  const { summary, status } = useInventoryInsights();
  if (summary === null) {
    return (
      <>
        <PageActions>
          <InsightsFreshness />
        </PageActions>
        <InsightsBuilding status={status} />
      </>
    );
  }
  return <RestockBody onViewChange={onViewChange} view={view} />;
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
      <RestockGate onViewChange={onViewChange} view={view} />
    </PageLayout>
  );
}
