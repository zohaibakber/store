import type { Invoice } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { formatPrice } from "@store/services/format";
import { Link } from "@tanstack/react-router";
import { createColumnHelper, type ReactTable } from "@tanstack/react-table";

import { formatInvoiceTime } from "@/components/invoices/invoice-time";
import { DataTableColumnHeader } from "@/components/shared/data-table";
import { useListTable, type ListTableFeatures } from "@/components/shared/list-view";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";
import { formatDateTime } from "@/lib/format-date";

import { invoiceList, type InvoiceListView } from "./list";

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

export function useInvoicesTable(input: {
  readonly rows: ReadonlyArray<Invoice>;
  readonly total: number;
  readonly view: InvoiceListView;
  readonly onViewChange: (view: InvoiceListView) => void;
  readonly loading: boolean;
}): ReactTable<ListTableFeatures, Invoice> {
  const { view } = input;
  return useListTable({
    list: invoiceList,
    columns,
    rows: input.rows,
    total: input.total,
    getRowId: (invoice) => invoice.id,
    view,
    onViewChange: input.onViewChange,
    loading: input.loading,
    filters: { customer: view.q },
    viewWithFilters: (filters) => ({ ...view, q: filters.customer }),
  });
}
