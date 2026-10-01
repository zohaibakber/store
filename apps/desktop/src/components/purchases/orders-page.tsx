import { Add01Icon, ShoppingBasket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PurchaseOrder } from "@store/contracts";
import { formatPrice } from "@store/services/format";
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
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import * as Schema from "effect/Schema";
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
import { usePageInRange } from "@/hooks/use-page-in-range";
import { EMPTY, formatDateTime, formatNumber } from "@/lib/format";
import {
  PURCHASE_ORDER_SORT_COLUMNS,
  PURCHASE_ORDER_TABS,
  usePurchasingGate,
  useSuspensePurchaseOrderCount,
  useSuspensePurchaseOrderListCount,
  useSuspensePurchaseOrderPage,
  type PurchaseOrderListRequest,
  type PurchaseOrderTab,
} from "@/lib/inventory";
import { cn } from "@/lib/utils";

import { PurchasingGateNotice } from "./gate-notice";
import { OrderBuilderSheet } from "./order-builder";
import {
  DEFAULT_PURCHASE_ORDER_LIST_VIEW,
  formatOrderNumber,
  orderProgress,
  orderUnits,
  PURCHASE_ORDER_PAGE_SIZES,
  UNKNOWN_SUPPLIER,
  type PurchaseOrderListView,
  type PurchaseOrderPageSize,
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
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

const columnHelper = createColumnHelper<typeof features, OrderRow>();

const SUPPLIER_COLUMN = "supplier";

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
    id: SUPPLIER_COLUMN,
    header: "Supplier",
    cell: ({ getValue }) => <span className="block max-w-64 truncate">{getValue()}</span>,
    enableSorting: false,
    meta: { label: "Supplier" },
  }),
  columnHelper.display({
    id: "status",
    header: "Status",
    cell: ({ row }) => <ProgressBadge progress={orderProgress(row.original)} />,
    meta: { label: "Status" },
  }),
  columnHelper.accessor((order) => order.items.length, {
    id: "lines",
    header: "Lines",
    cell: ({ getValue }) => formatNumber(getValue()),
    enableSorting: false,
    meta: { label: "Lines", align: "end" },
  }),
  columnHelper.display({
    id: "received",
    header: "Received",
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
    header: "Total",
    cell: ({ getValue }) => <span className="font-medium">{formatPrice(getValue())}</span>,
    enableSorting: false,
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

const isSortColumn = Schema.is(Schema.Literals(PURCHASE_ORDER_SORT_COLUMNS));

const isText = Schema.is(Schema.String);

const viewWithFilters = (
  view: PurchaseOrderListView,
  filters: ColumnFiltersState,
): PurchaseOrderListView => {
  const value = filters.find((filter) => filter.id === SUPPLIER_COLUMN)?.value;
  return { ...view, page: 0, q: isText(value) && value.trim() !== "" ? value : undefined };
};

const viewWithSorting = (
  view: PurchaseOrderListView,
  sorting: SortingState,
): PurchaseOrderListView => {
  const [first] = sorting;
  return first && isSortColumn(first.id)
    ? { ...view, sort: first.id, desc: first.desc, page: 0 }
    : {
        ...view,
        sort: DEFAULT_PURCHASE_ORDER_LIST_VIEW.sort,
        desc: DEFAULT_PURCHASE_ORDER_LIST_VIEW.desc,
        page: 0,
      };
};

const pageSizeFrom = (size: number): PurchaseOrderPageSize =>
  PURCHASE_ORDER_PAGE_SIZES.find((candidate) => candidate === size) ??
  DEFAULT_PURCHASE_ORDER_LIST_VIEW.size;

const viewWithPagination = (
  view: PurchaseOrderListView,
  pagination: PaginationState,
): PurchaseOrderListView => {
  const size = pageSizeFrom(pagination.pageSize);
  return { ...view, size, page: size === view.size ? Math.max(0, pagination.pageIndex) : 0 };
};

function useOrdersTable(input: {
  readonly rows: ReadonlyArray<OrderRow>;
  readonly total: number;
  readonly view: PurchaseOrderListView;
  readonly onViewChange: (view: PurchaseOrderListView) => void;
}) {
  const { view, onViewChange } = input;
  const pagination: PaginationState = { pageIndex: view.page, pageSize: view.size };
  const sorting: SortingState = [{ id: view.sort, desc: view.desc }];
  const columnFilters: ColumnFiltersState = view.q ? [{ id: SUPPLIER_COLUMN, value: view.q }] : [];
  return useTable({
    features,
    columns,
    data: input.rows,
    getRowId: (order) => order.id,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: input.total,
    state: { pagination, sorting, columnFilters },
    onPaginationChange: (updater: Updater<PaginationState>) =>
      onViewChange(viewWithPagination(view, functionalUpdate(updater, pagination))),
    onSortingChange: (updater: Updater<SortingState>) =>
      onViewChange(viewWithSorting(view, functionalUpdate(updater, sorting))),
    onColumnFiltersChange: (updater: Updater<ColumnFiltersState>) =>
      onViewChange(viewWithFilters(view, functionalUpdate(updater, columnFilters))),
  });
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
  loading,
  onBuilderOpenChange,
  onViewChange,
  request,
  supplierNames,
  view,
}: {
  readonly builderOpen: boolean;
  readonly loading: boolean;
  readonly onBuilderOpenChange: (open: boolean) => void;
  readonly onViewChange: (view: PurchaseOrderListView) => void;
  readonly request: PurchaseOrderListRequest;
  readonly supplierNames: ReadonlyMap<string, string>;
  readonly view: PurchaseOrderListView;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const gate = usePurchasingGate();
  const orders = useSuspensePurchaseOrderPage(request);
  const total = useSuspensePurchaseOrderListCount(request.filters);
  usePageInRange({
    page: view.page,
    pageSize: view.size,
    total,
    settled: !loading,
    onPageChange: (page) => onViewChange({ ...view, page }),
  });
  const rows = React.useMemo(
    (): ReadonlyArray<OrderRow> =>
      orders.map((order) => ({
        ...order,
        supplierName: supplierNames.get(order.supplierId) ?? UNKNOWN_SUPPLIER,
      })),
    [orders, supplierNames],
  );
  const table = useOrdersTable({ rows, total, view, onViewChange });
  const empty = TAB_EMPTY[request.filters.tab];
  const searching = request.filters.supplierIds !== undefined;

  return (
    <PageLayout>
      <DataTable
        className="gap-3"
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
        <Tabs
          onValueChange={(next: PurchaseOrderTab) => onViewChange({ ...view, tab: next, page: 0 })}
          value={view.tab}
        >
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
        {total === 0 && !searching ? (
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
                <DataTablePagination pageSizes={PURCHASE_ORDER_PAGE_SIZES} />
              </DataTableFooter>
            </DataTableContent>
          </div>
        )}
      </DataTable>
      <OrderBuilderSheet onOpenChange={onBuilderOpenChange} open={builderOpen} />
    </PageLayout>
  );
}
