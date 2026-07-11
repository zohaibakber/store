import type { Product } from "@store/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableContent,
  DataTableFilter,
  DataTablePagination,
  DataTableViewOptions,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatPrice } from "@/lib/format";

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
  columnHelper.accessor("barcode", {
    header: "Barcode",
    cell: ({ getValue }) => (
      <span className="font-mono text-muted-foreground">{getValue() ?? "—"}</span>
    ),
    enableSorting: false,
    meta: { label: "Barcode" },
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

export const Route = createFileRoute("/products/")({
  loader: () => window.offlineStore.listProducts(),
  component: ProductsPage,
});

function ProductsPage() {
  const products = Route.useLoaderData();
  const navigate = useNavigate();

  const table = useTable({
    features,
    columns,
    data: products as Array<Product>,
    getRowId: (product) => product.id,
    initialState: {
      columnVisibility: { barcode: false, composition: false },
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [{ id: "name", desc: false }],
    },
  });

  return (
    <main className="p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">Products</h1>
            <p className="mt-1 text-muted-foreground">
              Everything the shop sells, straight from the local database.
            </p>
          </div>
          <Link className={buttonVariants({ size: "sm" })} to="/products/new">
            <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
            Add product
          </Link>
        </div>

        <DataTable
          onRowClick={(row) =>
            navigate({ to: "/products/$productId", params: { productId: row.id } })
          }
          table={table}
        >
          <div className="flex items-center gap-2">
            <DataTableFilter columnId="name" placeholder="Filter by name…" />
            <DataTableViewOptions />
          </div>
          <DataTableContent />
          <DataTablePagination />
        </DataTable>
      </div>
    </main>
  );
}
