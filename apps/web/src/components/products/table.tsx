import type { Product } from "@store/contracts";
import { Link } from "@tanstack/react-router";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_equalsString,
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
  DataTableFilterMenu,
  DataTableFilterOption,
} from "@/components/shared/data-table";
import { formatDate, formatPrice } from "@/lib/format";

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { equalsString: filterFn_equalsString },
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
        className="font-medium capitalize hover:underline"
        onClick={(event) => event.stopPropagation()}
        params={{ productId: row.original.id }}
        to="/products/$productId"
      >
        {getValue()}
      </Link>
    ),
    enableHiding: false,
    meta: { label: "Name" },
  }),
  columnHelper.accessor((product) => product.category.name, {
    id: "category",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
    filterFn: "equalsString",
    meta: { label: "Category" },
  }),
  columnHelper.accessor((product) => product.aisle ?? "", {
    id: "aisle",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Aisle" />,
    cell: ({ getValue }) => getValue() || "—",
    filterFn: "equalsString",
    meta: { label: "Aisle" },
  }),
  columnHelper.accessor((product) => product.composition ?? "", {
    id: "composition",
    header: "Composition",
    cell: ({ getValue }) => <span>{getValue() || "—"}</span>,
    enableSorting: false,
    filterFn: "equalsString",
    meta: { label: "Composition" },
  }),
  columnHelper.accessor((product) => product.strength ?? "", {
    id: "strength",
    header: "Strength",
    cell: ({ getValue }) => getValue() || "—",
    enableSorting: false,
    filterFn: "equalsString",
    meta: { label: "Strength" },
  }),
  columnHelper.accessor("unitsPerPack", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Units / pack" />,
    cell: ({ getValue }) => <span className="font-mono tabular-nums">{getValue()}</span>,
    meta: { label: "Units / pack" },
  }),
  columnHelper.accessor("purchasePrice", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Purchase price" />,
    cell: ({ getValue }) => (
      <span className="font-mono tabular-nums">{formatPrice(getValue())}</span>
    ),
    meta: { label: "Purchase price" },
  }),
  columnHelper.accessor("retailPrice", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Retail price" />,
    cell: ({ getValue }) => (
      <span className="font-mono tabular-nums">{formatPrice(getValue())}</span>
    ),
    meta: { label: "Retail price" },
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

const distinctValues = (
  products: readonly Product[],
  valueOf: (product: Product) => string | null,
) =>
  [
    ...new Map(
      products.flatMap((product) => {
        const value = valueOf(product)?.trim();
        return value ? [[value.toLocaleLowerCase(), value] as const] : [];
      }),
    ).values(),
  ].sort((left, right) => left.localeCompare(right));

export function ProductTableFilters({ products }: { products: readonly Product[] }) {
  return (
    <DataTableFilterMenu aria-label="Filter products">
      <DataTableFilterOption
        columnId="category"
        label="Category"
        options={distinctValues(products, (product) => product.category.name)}
      />
      <DataTableFilterOption
        columnId="composition"
        label="Composition"
        options={distinctValues(products, (product) => product.composition)}
      />
      <DataTableFilterOption
        columnId="aisle"
        label="Aisle"
        options={distinctValues(products, (product) => product.aisle)}
      />
      <DataTableFilterOption
        columnId="strength"
        label="Strength"
        options={distinctValues(products, (product) => product.strength)}
      />
    </DataTableFilterMenu>
  );
}
