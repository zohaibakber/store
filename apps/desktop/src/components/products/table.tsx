import type { Product } from "@store/contracts";
import { rankItem } from "@tanstack/match-sorter-utils";
import { Link } from "@tanstack/react-router";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  type FilterFn,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/shared/data-table";
import { formatDate, formatPrice } from "@/lib/format";

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
  filterFns: { fuzzy: fuzzyProductFilter },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
  },
  columnMeta: metaHelper<{ label?: string }>(),
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
    cell: ({ getValue }) => <span className="font-mono tabular-nums">{getValue()}</span>,
    meta: { label: "Units / pack" },
  }),
  columnHelper.accessor("packPrice", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Pack price" />,
    cell: ({ getValue }) => (
      <span className="font-mono tabular-nums">{formatPrice(getValue())}</span>
    ),
    meta: { label: "Pack price" },
  }),
  columnHelper.accessor("unitPrice", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Unit price" />,
    cell: ({ getValue }) => (
      <span className="font-mono tabular-nums">{formatPrice(getValue())}</span>
    ),
    meta: { label: "Unit price" },
  }),
  columnHelper.accessor("updatedAt", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
    cell: ({ getValue }) => (
      <span className="font-mono text-muted-foreground tabular-nums">{formatDate(getValue())}</span>
    ),
    meta: { label: "Updated" },
  }),
]);
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
