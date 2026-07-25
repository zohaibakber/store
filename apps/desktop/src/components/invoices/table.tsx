import type { Invoice } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { Link } from "@tanstack/react-router";
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

import {
  DataTableColumnHeader,
  DataTableContent,
  DataTableFooter,
  DataTablePagination,
} from "@/components/shared/data-table";
import { formatDateTime, formatPrice } from "@/lib/format";

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
  columnMeta: metaHelper<{ label?: string }>(),
});

const columnHelper = createColumnHelper<typeof features, Invoice>();

const columns = columnHelper.columns([
  columnHelper.accessor("invoiceNumber", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
    cell: ({ row, getValue }) => (
      <Link
        className="font-mono font-medium tabular-nums hover:underline"
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
    header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
    cell: ({ row, getValue }) => (
      <span className={row.original.customerName ? undefined : "text-muted-foreground"}>
        {getValue()}
      </span>
    ),
    filterFn: "includesString",
    meta: { label: "Customer" },
  }),
  columnHelper.accessor((invoice) => invoice.items.length, {
    id: "items",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Items" />,
    cell: ({ getValue }) => <span className="font-mono tabular-nums">{getValue()}</span>,
    meta: { label: "Items" },
  }),
  columnHelper.accessor("total", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
    cell: ({ getValue }) => (
      <span className="font-mono tabular-nums">{formatPrice(getValue())}</span>
    ),
    meta: { label: "Total" },
  }),
  columnHelper.accessor("createdAt", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
    cell: ({ getValue }) => (
      <span className="font-mono text-muted-foreground tabular-nums">
        {formatDateTime(getValue())}
      </span>
    ),
    meta: { label: "Created" },
  }),
]);

export function useInvoicesTable(invoices: readonly Invoice[]) {
  return useTable({
    features,
    columns,
    data: invoices,
    getRowId: (invoice) => invoice.id,
    initialState: {
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [{ id: "createdAt", desc: true }],
    },
  });
}

export function InvoicesTable() {
  return (
    <DataTableContent>
      <DataTableFooter>
        <DataTablePagination />
      </DataTableFooter>
    </DataTableContent>
  );
}
