import type { Product } from "@store/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFns,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { formatDate, formatPrice } from "@/lib/format";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableContent,
  DataTableFooter,
  DataTableFilter,
  DataTableHeader,
  DataTablePagination,
  DataTableViewOptions,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";

// v9: features, row models and fn registries are stitched together statically
// so the bundle only carries what this table uses.

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns,
  sortFns,
  columnMeta: {} as { label?: string },
});

const columnHelper = createColumnHelper<typeof features, Product>();

const columns = columnHelper.columns([
  columnHelper.accessor("name", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    cell: ({ row, getValue }) => (
      <Link
        className="font-medium hover:underline"
        onClick={(event) => event.stopPropagation()}
        params={{ productId: row.original.id }}
        to="/products/$productId"
      >
        {getValue()}
      </Link>
    ),
    enableHiding: false,
    filterFn: "includesString",
    meta: { label: "Name" },
  }),
  columnHelper.accessor((product) => product.category.name, {
    id: "category",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
    cell: ({ getValue }) => <Badge variant="outline">{getValue()}</Badge>,
    meta: { label: "Category" },
  }),
  columnHelper.accessor("aisle", {
    header: "Aisle",
    cell: ({ getValue }) => getValue() ?? "—",
    meta: { label: "Aisle" },
  }),
  columnHelper.accessor("composition", {
    header: "Composition",
    cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() ?? "—"}</span>,
    enableSorting: false,
    meta: { label: "Composition" },
  }),
  columnHelper.accessor("strength", {
    header: "Strength",
    cell: ({ getValue }) => getValue() ?? "—",
    enableSorting: false,
    meta: { label: "Strength" },
  }),
  columnHelper.accessor("unitsPerPack", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Units / pack" />,
    meta: { label: "Units / pack" },
  }),
  columnHelper.accessor("packPrice", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Pack price" />,
    cell: ({ getValue }) => formatPrice(getValue()),
    meta: { label: "Pack price" },
  }),
  columnHelper.accessor("unitPrice", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Unit price" />,
    cell: ({ getValue }) => formatPrice(getValue()),
    meta: { label: "Unit price" },
  }),
  columnHelper.accessor("updatedAt", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
    cell: ({ getValue }) => <span className="text-muted-foreground">{formatDate(getValue())}</span>,
    meta: { label: "Updated" },
  }),
]);
export function ProductsTable({ products }: { products: readonly Product[] }) {
  const navigate = useNavigate();

  const table = useTable({
    features,
    columns,
    data: products,
    getRowId: (product) => product.id,
    initialState: {
      columnVisibility: { composition: false },
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [{ id: "name", desc: false }],
    },
  });
  return (
    <DataTable
      onRowClick={(row) => navigate({ to: "/products/$productId", params: { productId: row.id } })}
      table={table}
    >
      <DataTableHeader>
        <DataTableFilter columnId="name" placeholder="Filter by name…" />
        <DataTableViewOptions />
      </DataTableHeader>
      <DataTableContent />
      <DataTableFooter>
        <DataTablePagination />
      </DataTableFooter>
    </DataTable>
  );
}
