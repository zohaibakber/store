import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Invoice } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import {
  useSuspenseInvoiceCount,
  useSuspenseInvoicePage,
  type InvoiceListRequest,
} from "@store/inventory-react";
import { formatPrice } from "@store/services/format";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";

import { invoiceList, type InvoiceListView } from "@/components/invoices/list";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFilter,
  type ListTableFeatures,
} from "@/components/shared/data-table";
import { ListTableContent, useListTable } from "@/components/shared/list-view";
import { PageActions } from "@/components/shared/page-actions";
import { PageLayout } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";
import { formatDateTime, formatInvoiceTime } from "@/lib/format-date";

const columnHelper = createColumnHelper<ListTableFeatures, Invoice>();

const columns = columnHelper.columns([
  columnHelper.accessor("invoiceNumber", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
    cell: ({ row, getValue }) => (
      <Link
        className="font-medium tabular-nums hover:underline"
        onClick={(event) => event.stopPropagation()}
        params={{ invoiceId: row.original.id }}
        to="/invoices/$invoiceId"
      >
        #{formatInvoiceNumber(getValue())}
      </Link>
    ),
    enableHiding: false,
    meta: { label: "Invoice" },
  }),
  columnHelper.accessor((invoice) => invoice.customerName ?? "Walk-in customer", {
    id: "customer",
    header: "Customer",
    cell: ({ row, getValue }) => (
      <span className={row.original.customerName ? undefined : "text-muted-foreground"}>
        {getValue()}
      </span>
    ),
    enableSorting: false,
    meta: { label: "Customer" },
  }),
  columnHelper.accessor((invoice) => invoice.items.length, {
    id: "items",
    header: "Items",
    cell: ({ getValue }) => formatNumber(getValue()),
    enableSorting: false,
    meta: { label: "Items", align: "end" },
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

function InvoicesPage({
  loading,
  onViewChange,
  request,
  view,
}: {
  readonly loading: boolean;
  readonly onViewChange: (view: InvoiceListView) => void;
  readonly request: InvoiceListRequest;
  readonly view: InvoiceListView;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const rows = useSuspenseInvoicePage(request);
  const total = useSuspenseInvoiceCount(request.filters);
  const table = useListTable({
    list: invoiceList,
    columns,
    rows,
    total,
    getRowId: (invoice) => invoice.id,
    view,
    onViewChange,
    loading,
    filters: { customer: view.q },
    viewWithFilters: (filters) => ({ ...view, q: filters.customer }),
  });

  return (
    <DataTable
      onRowClick={(row) => navigate({ to: "/invoices/$invoiceId", params: { invoiceId: row.id } })}
      onRowPreload={(row) =>
        void router.preloadRoute({ to: "/invoices/$invoiceId", params: { invoiceId: row.id } })
      }
      table={table}
    >
      <PageActions>
        <DataTableFilter columnId="customer" placeholder="Search invoices" />
        <Button render={<Link to="/invoices/new" />} size="sm">
          <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
          New sale
        </Button>
      </PageActions>
      <PageLayout>
        <ListTableContent loading={loading} />
      </PageLayout>
    </DataTable>
  );
}

export { InvoicesPage };
