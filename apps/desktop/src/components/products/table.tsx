import type { ProductRow } from "@store/client-db";
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

import {
  DataTableColumnHeader,
  DataTableFilterMenu,
  DataTableFilterOption,
  type DataTableColumnMeta,
} from "@/components/shared/data-table";
import { EMPTY, formatDate, formatNumber } from "@/lib/format";
import type { ProductFacets, ProductSortColumn } from "@/lib/inventory";

import { ProductStatusCell, ProductStockCell } from "./insight-cells";

const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type ProductListRow = ProductRow & { readonly categoryName: string };

export const PRODUCT_PAGE_SIZES = [25, 50, 100] as const;
export type ProductPageSize = (typeof PRODUCT_PAGE_SIZES)[number];

export type ProductListView = {
  readonly q?: string;
  readonly category?: string;
  readonly aisle?: string;
  readonly composition?: string;
  readonly strength?: string;
  readonly sort: ProductSortColumn;
  readonly desc: boolean;
  readonly page: number;
  readonly size: ProductPageSize;
};

export const DEFAULT_PRODUCT_LIST_VIEW: ProductListView = {
  sort: "name",
  desc: false,
  page: 0,
  size: 50,
};

type CategoryOption = { readonly id: string; readonly name: string };

const columnHelper = createColumnHelper<typeof features, ProductListRow>();

const priceCell = ({ getValue }: { getValue: () => number | null }) => {
  const value = getValue();
  return value === null ? (
    <span className="text-muted-foreground">{EMPTY}</span>
  ) : (
    formatPrice(value)
  );
};

const textCell = (value: string) => value || <span className="text-muted-foreground">{EMPTY}</span>;

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
const SORTABLE: ReadonlySet<string> = new Set<ProductSortColumn>([
  "name",
  "aisle",
  "unitsPerPack",
  "purchasePrice",
  "retailPrice",
  "unitPrice",
  "updatedAt",
]);

const isSortColumn = (id: string): id is ProductSortColumn => SORTABLE.has(id);

const isText = Schema.is(Schema.String);

const textFilter = (filters: ColumnFiltersState, id: string) => {
  const value = filters.find((filter) => filter.id === id)?.value;
  return isText(value) && value.trim() !== "" ? value : undefined;
};

export const productTableFilters = (
  view: ProductListView,
  categories: ReadonlyArray<CategoryOption>,
): ColumnFiltersState => {
  const categoryName = categories.find((category) => category.id === view.category)?.name;
  return [
    ...(view.q ? [{ id: "name", value: view.q }] : []),
    ...(categoryName ? [{ id: "category", value: categoryName }] : []),
    ...(view.aisle ? [{ id: "aisle", value: view.aisle }] : []),
    ...(view.composition ? [{ id: "composition", value: view.composition }] : []),
    ...(view.strength ? [{ id: "strength", value: view.strength }] : []),
  ];
};

export const viewWithFilters = (
  view: ProductListView,
  filters: ColumnFiltersState,
  categories: ReadonlyArray<CategoryOption>,
): ProductListView => {
  const categoryName = textFilter(filters, "category");
  return {
    sort: view.sort,
    desc: view.desc,
    size: view.size,
    page: 0,
    q: textFilter(filters, "name"),
    category: categories.find((category) => category.name === categoryName)?.id,
    aisle: textFilter(filters, "aisle"),
    composition: textFilter(filters, "composition"),
    strength: textFilter(filters, "strength"),
  };
};

export const viewWithSorting = (view: ProductListView, sorting: SortingState): ProductListView => {
  const [first] = sorting;
  return first && isSortColumn(first.id)
    ? { ...view, sort: first.id, desc: first.desc, page: 0 }
    : { ...view, sort: DEFAULT_PRODUCT_LIST_VIEW.sort, desc: false, page: 0 };
};

const pageSizeFrom = (size: number): ProductPageSize =>
  PRODUCT_PAGE_SIZES.find((candidate) => candidate === size) ?? DEFAULT_PRODUCT_LIST_VIEW.size;

const viewWithPagination = (
  view: ProductListView,
  pagination: PaginationState,
): ProductListView => {
  const size = pageSizeFrom(pagination.pageSize);
  return { ...view, size, page: size === view.size ? Math.max(0, pagination.pageIndex) : 0 };
};

export function useProductsTable(input: {
  readonly rows: ReadonlyArray<ProductListRow>;
  readonly total: number;
  readonly view: ProductListView;
  readonly categories: ReadonlyArray<CategoryOption>;
  readonly onViewChange: (view: ProductListView) => void;
}) {
  const { view, categories, onViewChange } = input;
  const pagination: PaginationState = { pageIndex: view.page, pageSize: view.size };
  const sorting: SortingState = [{ id: view.sort, desc: view.desc }];
  const columnFilters = productTableFilters(view, categories);
  return useTable({
    features,
    columns,
    data: input.rows,
    getRowId: (product) => product.id,
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
      onViewChange(viewWithFilters(view, functionalUpdate(updater, columnFilters), categories)),
    initialState: {
      columnVisibility: {
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
