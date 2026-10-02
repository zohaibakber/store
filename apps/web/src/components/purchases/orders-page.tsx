import { Add01Icon, ShoppingBasket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PurchaseOrder } from "@store/contracts";
import {
  PURCHASE_ORDER_TABS,
  usePurchasingGate,
  useSuspensePurchaseOrderCount,
  useSuspensePurchaseOrderListCount,
  useSuspensePurchaseOrderPage,
  type PurchaseOrderListRequest,
  type PurchaseOrderTab,
} from "@store/inventory-react";
import { formatPrice } from "@store/services/format";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import * as React from "react";

import { ToneBadge } from "@/components/insights/status-badge";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFilter,
  type ListTableFeatures,
} from "@/components/shared/data-table";
import { FrameCard } from "@/components/shared/frame-card";
import { ListTableContent, useListTable } from "@/components/shared/list-view";
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
import { EMPTY, formatNumber } from "@/lib/format";
import { formatDateTime, formatInvoiceTime } from "@/lib/format-date";

import { PurchasingGateNotice } from "./gate-notice";
import { OrderBuilderSheet } from "./order-builder";
import { purchaseOrderList, type PurchaseOrderListView } from "./order-list";
import {
  formatOrderNumber,
  orderProgress,
  orderUnits,
  PROGRESS_META,
  UNKNOWN_SUPPLIER,
} from "./presentation";

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

const columnHelper = createColumnHelper<ListTableFeatures, OrderRow>();

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
    header: "Supplier",
    cell: ({ getValue }) => <span className="block max-w-64 truncate">{getValue()}</span>,
    enableSorting: false,
    meta: { label: "Supplier" },
  }),
  columnHelper.display({
    id: "status",
    header: "Status",
    cell: ({ row }) => <ToneBadge {...PROGRESS_META[orderProgress(row.original)]} />,
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
  const rows = React.useMemo(
    (): ReadonlyArray<OrderRow> =>
      orders.map((order) => ({
        ...order,
        supplierName: supplierNames.get(order.supplierId) ?? UNKNOWN_SUPPLIER,
      })),
    [orders, supplierNames],
  );
  const table = useListTable({
    list: purchaseOrderList,
    columns,
    rows,
    total,
    getRowId: (order) => order.id,
    view,
    onViewChange,
    loading,
    filters: { supplier: view.q },
    viewWithFilters: (filters) => ({ ...view, q: filters.supplier }),
  });
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
          <ListTableContent loading={loading} />
        )}
      </DataTable>
      <OrderBuilderSheet onOpenChange={onBuilderOpenChange} open={builderOpen} />
    </PageLayout>
  );
}
