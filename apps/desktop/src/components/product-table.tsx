import type { Product } from "@store/contracts";
import { Link } from "@tanstack/react-router";
import { rankItem } from "@tanstack/match-sorter-utils";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFns as builtInFilterFns,
  type FilterFn,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { formatDate, formatPrice } from "@/lib/format";
import { DataTableColumnHeader } from "@/components/data-table";

// v9: features, row models and fn registries are stitched together statically
// so the bundle only carries what this table uses.

// Fuzzy-ranks name and composition together so a search matches on either
// field and tolerates typos, per TanStack's fuzzy filtering guide.
const fuzzyProductFilter: FilterFn<any, Product> = (row, _columnId, filterValue) => {
  const { passed } = rankItem(row.original, String(filterValue ?? ""), {
    accessors: [
      (product: Product) => product.name,
      (product: Product) => product.composition ?? "",
    ],
  });
  return passed;
};

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { ...builtInFilterFns, fuzzy: fuzzyProductFilter },
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
    filterFn: "fuzzy",
    meta: { label: "Name" },
  }),
  columnHelper.accessor((product) => product.category.name, {
    id: "category",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
    meta: { label: "Category" },
  }),
  columnHelper.accessor("aisle", {
    header: "Aisle",
    cell: ({ getValue }) => getValue() ?? "—",
    meta: { label: "Aisle" },
  }),
  columnHelper.accessor("composition", {
    header: "Composition",
    cell: ({ getValue }) => <span>{getValue() ?? "—"}</span>,
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
/**
 * The table instance lives in the page rather than a self-contained component:
 * the filter and column-visibility controls now sit in the page header, which
 * is outside the table's markup but must share its context.
 */
export function useProductsTable(products: readonly Product[]) {
  return useTable({
    features,
    columns,
    data: products,
    getRowId: (product) => product.id,
    initialState: {
      columnVisibility: { unitsPerPack: false, updatedAt: false },
      pagination: { pageIndex: 0, pageSize: 10 },
      sorting: [{ id: "name", desc: false }],
    },
  });
}
