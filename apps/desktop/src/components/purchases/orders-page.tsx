import { Add01Icon, ShoppingBasket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PurchaseOrder } from "@store/contracts";
import { formatPrice } from "@store/services/format";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
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
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import * as React from "react";

import { formatInvoiceTime } from "@/components/invoices/invoice-time";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableContent,
  DataTableFilter,
  DataTableFooter,
  DataTablePagination,
  type DataTableColumnMeta,
} from "@/components/shared/data-table";
import { FrameCard } from "@/components/shared/frame-card";
import { PageActions } from "@/components/shared/page-actions";
import { PageLayout } from "@/components/shared/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { EMPTY, formatDateTime, formatNumber } from "@/lib/format";
import {
  PURCHASE_ORDER_TABS,
  usePurchasingGate,
  useSuspensePurchaseOrderCount,
  type PurchaseOrderTab,
} from "@/lib/inventory";
import { cn } from "@/lib/utils";

import { PurchasingGateNotice } from "./gate-notice";
import { OrderBuilderSheet } from "./order-builder";
import {
  formatOrderNumber,
  orderProgress,
  orderUnits,
  PROGRESS_RANK,
  UNKNOWN_SUPPLIER,
} from "./presentation";
import { ProgressBadge } from "./progress-badge";

const TAB_LABEL = {
  open: "Open",
  drafts: "Drafts",
  closed: "Closed",
} satisfies Record<PurchaseOrderTab, string>;

const TAB_EMPTY = {
  open: {
    title: "No open orders",
    description: "Orders you have sent to a supplier stay here until you close them.",
  },
  drafts: {
    title: "No draft orders",
    description: "Start an order here, or select products on the Restock page.",
  },
  closed: {
    title: "No closed orders",
    description: "Closed and cancelled orders are kept here.",
  },
} satisfies Record<PurchaseOrderTab, { readonly title: string; readonly description: string }>;

type OrderRow = PurchaseOrder & { readonly supplierName: string };

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
  },
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

const columnHelper = createColumnHelper<typeof features, OrderRow>();

const receivedShare = (order: OrderRow) => {
  const units = orderUnits(order.items);
  return units.ordered === 0 ? 0 : units.received / units.ordered;
};

const columns = columnHelper.columns([
  columnHelper.accessor("orderNumber", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Order" />,
    cell: ({ row, getValue }) => (
      <Link
        className="font-medium tabular-nums hover:underline"
        onClick={(event) => event.stopPropagation()}
        params={{ orderId: row.original.id }}
        to="/purchases/$orderId"
      >
        {formatOrderNumber(getValue())}
      </Link>
    ),
    enableHiding: false,
    meta: { label: "Order" },
  }),
  columnHelper.accessor("supplierName", {
    id: "supplier",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
    cell: ({ getValue }) => <span className="block max-w-64 truncate">{getValue()}</span>,
    filterFn: "includesString",
    meta: { label: "Supplier" },
  }),
  columnHelper.accessor((order) => PROGRESS_RANK[orderProgress(order)], {
    id: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <ProgressBadge progress={orderProgress(row.original)} />,
    meta: { label: "Status" },
  }),
  columnHelper.accessor((order) => order.items.length, {
    id: "lines",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Lines" />,
    cell: ({ getValue }) => formatNumber(getValue()),
    meta: { label: "Lines", align: "end" },
  }),
  columnHelper.accessor(receivedShare, {
    id: "received",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Received" />,
    cell: ({ row }) => {
      const units = orderUnits(row.original.items);
      if (units.ordered === 0) return <span className="text-muted-foreground">{EMPTY}</span>;
      return (
        <span className={units.received === 0 ? "text-muted-foreground" : undefined}>
          {formatNumber(units.received)} / {formatNumber(units.ordered)}
        </span>
      );
    },
    meta: { label: "Received", align: "end" },
  }),
  columnHelper.accessor("total", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
    cell: ({ getValue }) => <span className="font-medium">{formatPrice(getValue())}</span>,
    meta: { label: "Total", align: "end" },
  }),
  columnHelper.accessor("createdAt", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
    cell: ({ getValue }) => (
      <Tooltip>
        <TooltipTrigger render={<span className="text-muted-foreground tabular-nums" />}>
          {formatInvoiceTime(getValue())}
        </TooltipTrigger>
        <TooltipPopup>{formatDateTime(getValue())}</TooltipPopup>
      </Tooltip>
    ),
    meta: { label: "Created", align: "end" },
  }),
]);

function useOrdersTable(orders: ReadonlyArray<OrderRow>) {
  const table = useTable({
    features,
    columns,
    data: orders,
    getRowId: (order) => order.id,
    autoResetPageIndex: false,
    initialState: {
      pagination: { pageIndex: 0, pageSize: 50 },
      sorting: [{ id: "createdAt", desc: true }],
    },
  });
  const { columnFilters, sorting } = table.state;
  React.useEffect(() => {
    table.setPageIndex(0);
  }, [table, columnFilters, sorting]);
  return table;
}

function TabCount({ tab }: { readonly tab: PurchaseOrderTab }) {
  return <span className="tabular-nums">{formatNumber(useSuspensePurchaseOrderCount(tab))}</span>;
}

function NewOrderButton({
  disabled,
  onClick,
}: {
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button disabled={disabled} onClick={onClick} size="sm">
      <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
      New order
    </Button>
  );
}

export function PurchaseOrdersPage({
  builderOpen,
  hasMore,
  loadingMore,
  onBuilderOpenChange,
  onLoadMore,
  onTabChange,
  orders,
  shownTab,
  supplierNames,
  tab,
}: {
  readonly builderOpen: boolean;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onBuilderOpenChange: (open: boolean) => void;
  readonly onLoadMore: () => void;
  readonly onTabChange: (tab: PurchaseOrderTab) => void;
  readonly orders: ReadonlyArray<PurchaseOrder>;
  readonly shownTab: PurchaseOrderTab;
  readonly supplierNames: ReadonlyMap<string, string>;
  readonly tab: PurchaseOrderTab;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const gate = usePurchasingGate();
  const rows = React.useMemo(
    (): ReadonlyArray<OrderRow> =>
      orders.map((order) => ({
        ...order,
        supplierName: supplierNames.get(order.supplierId) ?? UNKNOWN_SUPPLIER,
      })),
    [orders, supplierNames],
  );
  const table = useOrdersTable(rows);
  const empty = TAB_EMPTY[shownTab];
  const loading = tab !== shownTab;

  return (
    <PageLayout>
      <DataTable
        className="gap-3"
        moreRows={{ hasMore, loading: loadingMore, onLoadMore }}
        onRowClick={(row) => navigate({ to: "/purchases/$orderId", params: { orderId: row.id } })}
        onRowPreload={(row) =>
          void router.preloadRoute({ to: "/purchases/$orderId", params: { orderId: row.id } })
        }
        table={table}
      >
        <PageActions>
          <DataTableFilter columnId="supplier" placeholder="Search by supplier" />
          <Button render={<Link to="/purchases/suppliers" />} size="sm" variant="outline">
            Suppliers
          </Button>
          <NewOrderButton disabled={gate.blocked} onClick={() => onBuilderOpenChange(true)} />
        </PageActions>
        <PurchasingGateNotice gate={gate} />
        <Tabs onValueChange={(next: PurchaseOrderTab) => onTabChange(next)} value={tab}>
          <TabsList aria-label="Order status">
            {PURCHASE_ORDER_TABS.map((value) => (
              <TabsTab key={value} value={value}>
                {TAB_LABEL[value]}
                <React.Suspense fallback={null}>
                  <Badge variant="outline">
                    <TabCount tab={value} />
                  </Badge>
                </React.Suspense>
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
        {rows.length === 0 && !hasMore ? (
          <FrameCard flush>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon aria-hidden="true" icon={ShoppingBasket01Icon} />
                </EmptyMedia>
                <EmptyTitle>{empty.title}</EmptyTitle>
                <EmptyDescription>{empty.description}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <div className="flex items-center gap-2">
                  <NewOrderButton
                    disabled={gate.blocked}
                    onClick={() => onBuilderOpenChange(true)}
                  />
                  <Button render={<Link to="/restock" />} size="sm" variant="outline">
                    Order from Restock
                  </Button>
                </div>
              </EmptyContent>
            </Empty>
          </FrameCard>
        ) : (
          <div aria-busy={loading} className={cn("transition-opacity", loading && "opacity-60")}>
            <DataTableContent>
              <DataTableFooter>
                <DataTablePagination />
              </DataTableFooter>
            </DataTableContent>
          </div>
        )}
      </DataTable>
      <OrderBuilderSheet onOpenChange={onBuilderOpenChange} open={builderOpen} />
    </PageLayout>
  );
}
