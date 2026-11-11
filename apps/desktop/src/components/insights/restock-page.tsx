import {
  Cancel01Icon,
  Download01Icon,
  InformationCircleIcon,
  ShoppingBasket01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  RESTOCK_VIEWS,
  roundedMoney,
  type InsightsSummary,
  type ProductInsight,
  type RestockCursor,
  type RestockView,
  type StockStatus,
} from "@store/contracts";
import { formatPrice } from "@store/services/format";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import {
  createColumnHelper,
  functionalUpdate,
  useTable,
  type ColumnFiltersState,
  type PaginationState,
  type RowSelectionState,
  type Updater,
} from "@tanstack/react-table";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as React from "react";

import { PurchasingGateNotice } from "@/components/purchases/gate-notice";
import { OrderBuilderSheet } from "@/components/purchases/order-builder";
import type { DraftLine } from "@/components/purchases/presentation";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFilter,
  listTableFeatures,
  type ListTableFeatures,
} from "@/components/shared/data-table";
import { ListTableContent } from "@/components/shared/list-view";
import { PageHeading, PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { restockExportFailureCopy } from "@/inventory/errors";
import { useInventoryInsights, useRestockExport, useRestockPage } from "@/inventory/insights";
import { usePurchasingGate } from "@/inventory/purchasing-queries";
import { EMPTY, formatNumber } from "@/lib/format";
import { isString } from "@/lib/predicates";

import { InsightsBuilding } from "./building";
import { buyListHeader, buyListLine, downloadText } from "./buy-list";
import { PlanningSheet } from "./planning-sheet";
import {
  describeDemand,
  formatOrder,
  formatRate,
  formatStockCover,
  HEALTH_ORDER,
  RESTOCK_PAGE_SIZE,
  restockActionCount,
} from "./presentation";
import { StatusBadge } from "./status-badge";

const VIEW_LABEL = {
  action: "Needs action",
  out: "Out of stock",
  critical: "Running out",
  low: "Reorder",
  overstock: "Overstocked",
  dead: "Not selling",
  all: "All",
} satisfies Record<RestockView, string>;

const STATUS_RANK = new Map<StockStatus, number>(
  [...HEALTH_ORDER, "inactive" as const].map((status, index) => [status, index]),
);

const columnHelper = createColumnHelper<ListTableFeatures, ProductInsight>();

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

const draftLineOf = (insight: ProductInsight): DraftLine => ({
  productId: insight.productId,
  name: insight.name,
  quantity: insight.order?.quantity ?? 1,
  quantityType: insight.tracksPacks ? "pack" : "unit",
  unitsPerPack: insight.unitsPerPack,
  tracksPacks: insight.tracksPacks,
  packCost:
    insight.unitCost === null ? null : roundedMoney(insight.unitCost * insight.unitsPerPack),
});

const trendArrow = (trend: ProductInsight["demand"]["trend"]) =>
  trend === "rising" ? " ↑" : trend === "falling" ? " ↓" : "";

const columns = columnHelper.columns([
  columnHelper.display({
    id: "select",
    header: ({ table }) => {
      const all = table.getIsAllPageRowsSelected();
      return (
        <Checkbox
          aria-label="Select all products on this page"
          checked={all}
          disabled={table.getRowModel().rows.length === 0}
          indeterminate={!all && table.getIsSomePageRowsSelected()}
          onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
        />
      );
    },
    cell: ({ row }) => (
      <Checkbox
        aria-label={`Select ${row.original.name}`}
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked)}
        onClick={(event) => event.stopPropagation()}
      />
    ),
    enableHiding: false,
    meta: { label: "Select" },
  }),
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
              title={row.original.name}
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
  const { exporting, run } = useRestockExport();
  const runExport = async () => {
    const exit = await run({ view: "all" });
    if (Exit.isSuccess(exit)) {
      downloadText(
        "buy-list.csv",
        [buyListHeader(), ...exit.value.map(buyListLine).filter(Predicate.isNotNull)].join("\r\n"),
        "text/csv;charset=utf-8",
      );
    } else if (!Cause.hasInterruptsOnly(exit.cause)) {
      toastManager.add({
        title: "Couldn't export the buy list",
        description: restockExportFailureCopy(exit.cause),
        type: "error",
      });
    }
  };
  return (
    <Button
      disabled={exporting || summary === null || summary.inventory.reorderCount === 0}
      onClick={() => void runExport()}
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
      return restockActionCount(counts);
    case "all":
      return restockActionCount(counts) + counts.dead + counts.overstock + counts.healthy;
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
  const gate = usePurchasingGate();
  const [drafts, setDrafts] = React.useState<ReadonlyMap<string, DraftLine>>(new Map());
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [pageSize, setPageSize] = React.useState<number>(RESTOCK_PAGE_SIZE);
  const [isPending, startTransition] = React.useTransition();
  const term = search.trim();
  const shownView = React.useDeferredValue(view);
  const shownTerm = React.useDeferredValue(term);
  const shownPageSize = React.useDeferredValue(pageSize);
  const loading =
    isPending || shownView !== view || shownTerm !== term || shownPageSize !== pageSize;
  const scope = `${shownView}|${shownTerm}|${shownPageSize}`;
  const [stored, setStored] = React.useState<Paging>({ scope, cursors: [null], total: 0 });
  const paging: Paging = stored.scope === scope ? stored : { scope, cursors: [null], total: 0 };
  const pageIndex = paging.cursors.length - 1;
  const page = useRestockPage({
    filters: { view: shownView, search: shownTerm === "" ? undefined : shownTerm },
    cursor: paging.cursors[pageIndex] ?? null,
    limit: shownPageSize,
  });
  const rowCount = pageIndex === 0 ? (page.total ?? 0) : paging.total;
  const pagination: PaginationState = { pageIndex, pageSize };
  const columnFilters: ColumnFiltersState = term === "" ? [] : [{ id: "name", value: term }];
  const rowSelection: RowSelectionState = Object.fromEntries(
    [...drafts.keys()].map((productId) => [productId, true as const]),
  );

  if (page.cursorExpired && pageIndex > 0) setStored({ scope, cursors: [null], total: 0 });

  const table = useTable({
    features: listTableFeatures,
    columns,
    data: page.rows,
    getRowId: (insight) => insight.productId,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableSorting: false,
    rowCount,
    state: { pagination, columnFilters, rowSelection },
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
    onRowSelectionChange: (updater: Updater<RowSelectionState>) =>
      setDrafts(
        new Map(
          Object.keys(functionalUpdate(updater, rowSelection)).map((productId) => [
            productId,
            drafts.get(productId) ?? draftLineOf(table.getRow(productId).original),
          ]),
        ),
      ),
  });

  const deselect = (productIds: ReadonlyArray<string>) =>
    setDrafts((current) => {
      const next = new Map(current);
      for (const productId of productIds) next.delete(productId);
      return next;
    });

  return (
    <DataTable
      onRowClick={(row) =>
        navigate({
          to: "/products/$productId",
          params: { productId: row.original.productId },
        })
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
      <PageToolbar>
        <DataTableFilter className="me-auto" columnId="name" placeholder="Search products" />
        <ExportButton />
        <PlanningSheet />
        {drafts.size > 0 ? (
          <Button
            aria-label="Clear selection"
            onClick={() => setDrafts(new Map())}
            size="icon-sm"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
          </Button>
        ) : null}
        <Button
          disabled={gate.blocked || drafts.size === 0}
          onClick={() => setBuilderOpen(true)}
          size="sm"
        >
          <HugeiconsIcon aria-hidden="true" icon={ShoppingBasket01Icon} />
          Order selected
          {drafts.size > 0 ? (
            <Badge variant="secondary">
              <span className="tabular-nums">{formatNumber(drafts.size)}</span>
            </Badge>
          ) : null}
        </Button>
      </PageToolbar>
      <PurchasingGateNotice gate={gate} />
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
      <ListTableContent loading={loading} />
      <OrderBuilderSheet
        onOpenChange={setBuilderOpen}
        onOrdered={deselect}
        open={builderOpen}
        seed={[...drafts.values()]}
      />
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
        <PageToolbar>
          <PageHeading className="me-auto">Restock</PageHeading>
        </PageToolbar>
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
