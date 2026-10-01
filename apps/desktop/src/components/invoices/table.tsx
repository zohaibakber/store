import type { Invoice } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { formatPrice } from "@store/services/format";
import { Link } from "@tanstack/react-router";
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

import { formatInvoiceTime } from "@/components/invoices/invoice-time";
import {
  DataTableColumnHeader,
  DataTableContent,
  DataTableFooter,
  DataTablePagination,
  type DataTableColumnMeta,
} from "@/components/shared/data-table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime, formatNumber } from "@/lib/format";
import { INVOICE_SORT_COLUMNS, type InvoiceSortColumn } from "@/lib/inventory";

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export const INVOICE_PAGE_SIZES = [25, 50, 100] as const;
export type InvoicePageSize = (typeof INVOICE_PAGE_SIZES)[number];

export type InvoiceListView = {
  readonly q?: string;
  readonly sort: InvoiceSortColumn;
  readonly desc: boolean;
  readonly page: number;
  readonly size: InvoicePageSize;
};

export const DEFAULT_INVOICE_LIST_VIEW: InvoiceListView = {
  sort: "createdAt",
  desc: true,
  page: 0,
  size: 50,
};

const columnHelper = createColumnHelper<typeof features, Invoice>();

const CUSTOMER_COLUMN = "customer";

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
    id: CUSTOMER_COLUMN,
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

const isSortColumn = Schema.is(Schema.Literals(INVOICE_SORT_COLUMNS));

const isText = Schema.is(Schema.String);

const viewWithFilters = (view: InvoiceListView, filters: ColumnFiltersState): InvoiceListView => {
  const value = filters.find((filter) => filter.id === CUSTOMER_COLUMN)?.value;
  return { ...view, page: 0, q: isText(value) && value.trim() !== "" ? value : undefined };
};

const viewWithSorting = (view: InvoiceListView, sorting: SortingState): InvoiceListView => {
  const [first] = sorting;
  return first && isSortColumn(first.id)
    ? { ...view, sort: first.id, desc: first.desc, page: 0 }
    : {
        ...view,
        sort: DEFAULT_INVOICE_LIST_VIEW.sort,
        desc: DEFAULT_INVOICE_LIST_VIEW.desc,
        page: 0,
      };
};

const pageSizeFrom = (size: number): InvoicePageSize =>
  INVOICE_PAGE_SIZES.find((candidate) => candidate === size) ?? DEFAULT_INVOICE_LIST_VIEW.size;

const viewWithPagination = (
  view: InvoiceListView,
  pagination: PaginationState,
): InvoiceListView => {
  const size = pageSizeFrom(pagination.pageSize);
  return { ...view, size, page: size === view.size ? Math.max(0, pagination.pageIndex) : 0 };
};

export function useInvoicesTable(input: {
  readonly rows: ReadonlyArray<Invoice>;
  readonly total: number;
  readonly view: InvoiceListView;
  readonly onViewChange: (view: InvoiceListView) => void;
}) {
  const { view, onViewChange } = input;
  const pagination: PaginationState = { pageIndex: view.page, pageSize: view.size };
  const sorting: SortingState = [{ id: view.sort, desc: view.desc }];
  const columnFilters: ColumnFiltersState = view.q ? [{ id: CUSTOMER_COLUMN, value: view.q }] : [];
  return useTable({
    features,
    columns,
    data: input.rows,
    getRowId: (invoice) => invoice.id,
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

export function InvoicesTable() {
  return (
    <DataTableContent>
      <DataTableFooter>
        <DataTablePagination pageSizes={INVOICE_PAGE_SIZES} />
      </DataTableFooter>
    </DataTableContent>
  );
}
