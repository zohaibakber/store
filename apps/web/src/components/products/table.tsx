import type { ProductRow } from "@store/client-db";
import type { ProductFacets } from "@store/inventory-react";
import { formatPrice } from "@store/services/format";
import { Link } from "@tanstack/react-router";
import { createColumnHelper, type ReactTable } from "@tanstack/react-table";

import {
  DataTableColumnHeader,
  DataTableFilterMenu,
  DataTableFilterOption,
  type ListTableFeatures,
} from "@/components/shared/data-table";
import { useListTable } from "@/components/shared/list-view";
import { EMPTY, formatNumber } from "@/lib/format";
import { formatDate } from "@/lib/format-date";

import { ProductStatusCell, ProductStockCell } from "./insight-cells";
import { productList, type ProductListView } from "./list";

type ProductListRow = ProductRow & { readonly categoryName: string };

type CategoryOption = { readonly id: string; readonly name: string };

const columnHelper = createColumnHelper<ListTableFeatures, ProductListRow>();

const priceCell = ({ getValue }: { getValue: () => number | null }) => {
  const value = getValue();
  return value === null ? (
    <span className="text-muted-foreground">{EMPTY}</span>
  ) : (
    formatPrice(value)
  );
};

const textCell = (value: string) =>
  value ? (
    <span className="block max-w-40 truncate" title={value}>
      {value}
    </span>
  ) : (
    <span className="text-muted-foreground">{EMPTY}</span>
  );

const columns = columnHelper.columns([
  columnHelper.accessor("name", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    cell: ({ row, getValue }) => (
      <Link
        className="block max-w-80 truncate font-medium hover:underline"
        onClick={(event) => event.stopPropagation()}
        params={{ productId: row.original.id }}
        title={getValue()}
        to="/products/$productId"
      >
        {getValue()}
        {row.original.strength && (
          <span className="ms-1.5 font-normal text-muted-foreground">{row.original.strength}</span>
        )}
      </Link>
    ),
    enableHiding: false,
    meta: { label: "Name" },
  }),
  columnHelper.accessor("categoryName", {
    id: "category",
    header: "Category",
    enableSorting: false,
    meta: { label: "Category" },
  }),
  columnHelper.display({
    id: "stock",
    header: "Stock",
    cell: ({ row }) => <ProductStockCell productId={row.original.id} />,
    meta: { label: "Stock", align: "end" },
  }),
  columnHelper.display({
    id: "status",
    header: "Status",
    cell: ({ row }) => <ProductStatusCell productId={row.original.id} />,
    meta: { label: "Status" },
  }),
  columnHelper.accessor("unitPrice", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Unit price" />,
    cell: priceCell,
    meta: { label: "Unit price", align: "end" },
  }),
  columnHelper.accessor("retailPrice", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Retail price" />,
    cell: priceCell,
    meta: { label: "Retail price", align: "end" },
  }),
  columnHelper.accessor("purchasePrice", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Purchase price" />,
    cell: priceCell,
    meta: { label: "Purchase price", align: "end" },
  }),
  columnHelper.accessor((product) => product.aisle ?? "", {
    id: "aisle",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Aisle" />,
    cell: ({ getValue }) => textCell(getValue()),
    meta: { label: "Aisle" },
  }),
  columnHelper.accessor((product) => product.composition ?? "", {
    id: "composition",
    header: "Composition",
    cell: ({ getValue }) => textCell(getValue()),
    enableSorting: false,
    meta: { label: "Composition" },
  }),
  columnHelper.accessor((product) => product.strength ?? "", {
    id: "strength",
    header: "Strength",
    enableHiding: false,
    enableSorting: false,
    meta: { label: "Strength" },
  }),
  columnHelper.accessor("unitsPerPack", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Units / pack" />,
    cell: ({ getValue }) => formatNumber(getValue()),
    meta: { label: "Units / pack", align: "end" },
  }),
  columnHelper.accessor("updatedAt", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
    cell: ({ getValue }) => <span className="text-muted-foreground">{formatDate(getValue())}</span>,
    meta: { label: "Updated", align: "end" },
  }),
]);

export function useProductsTable(input: {
  readonly rows: ReadonlyArray<ProductListRow>;
  readonly total: number;
  readonly view: ProductListView;
  readonly categories: ReadonlyArray<CategoryOption>;
  readonly onViewChange: (view: ProductListView) => void;
  readonly loading: boolean;
}): ReactTable<ListTableFeatures, ProductListRow> {
  const { view, categories } = input;
  return useListTable({
    list: productList,
    columns,
    rows: input.rows,
    total: input.total,
    getRowId: (product) => product.id,
    view,
    onViewChange: input.onViewChange,
    loading: input.loading,
    filters: {
      name: view.q,
      category: categories.find((category) => category.id === view.category)?.name,
      aisle: view.aisle,
      composition: view.composition,
      strength: view.strength,
    },
    viewWithFilters: (filters) => ({
      ...view,
      q: filters.name,
      category: categories.find((category) => category.name === filters.category)?.id,
      aisle: filters.aisle,
      composition: filters.composition,
      strength: filters.strength,
    }),
    initialState: {
      columnVisibility: {
        unitPrice: false,
        purchasePrice: false,
        strength: false,
        unitsPerPack: false,
        updatedAt: false,
      },
    },
  });
}

export function ProductTableFilters({
  facets,
  categories,
}: {
  readonly facets: ProductFacets;
  readonly categories: ReadonlyArray<CategoryOption>;
}) {
  return (
    <DataTableFilterMenu aria-label="Filter products">
      <DataTableFilterOption
        columnId="category"
        label="Category"
        options={categories.map((category) => category.name)}
      />
      <DataTableFilterOption
        columnId="composition"
        label="Composition"
        options={facets.composition}
      />
      <DataTableFilterOption columnId="aisle" label="Aisle" options={facets.aisle} />
      <DataTableFilterOption columnId="strength" label="Strength" options={facets.strength} />
    </DataTableFilterMenu>
  );
}
