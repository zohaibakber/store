import {
  columnFilteringFeature,
  columnVisibilityFeature,
  functionalUpdate,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type PaginationState,
  type ReactTable,
  type RowData,
  type SortingState,
  type TableOptions,
  type Updater,
} from "@tanstack/react-table";
import * as Schema from "effect/Schema";
import { useDeferredValue, useEffect, useEffectEvent } from "react";

import {
  DataTableContent,
  DataTableFooter,
  DataTablePagination,
  type DataTableColumnMeta,
} from "@/components/shared/data-table";
import { MAX_LIST_SEARCH_LENGTH, type ListPage } from "@/lib/inventory";
import { isString } from "@/lib/predicates";
import { lenientSearchParam } from "@/lib/search-param";
import { cn } from "@/lib/utils";

export const listTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type ListTableFeatures = typeof listTableFeatures;

const LIST_PAGE_SIZES = [25, 50, 100] as const;
type ListPageSize = (typeof LIST_PAGE_SIZES)[number];

const DEFAULT_LIST_PAGE_SIZE: ListPageSize = 50;

export const ListSearchText = Schema.String.check(Schema.isMaxLength(MAX_LIST_SEARCH_LENGTH));

type SortColumns = readonly [string, ...ReadonlyArray<string>];

export type ListView<Sort extends string> = {
  readonly q?: string;
  readonly sort: Sort;
  readonly desc: boolean;
  readonly page: number;
  readonly size: ListPageSize;
};

type ListSearch<Sort extends string> = {
  readonly q: string | undefined;
  readonly sort: Sort | undefined;
  readonly desc: boolean | undefined;
  readonly page: number | undefined;
  readonly size: ListPageSize | undefined;
};

const listSearchFields = <const Columns extends SortColumns>(sortColumns: Columns) => ({
  q: lenientSearchParam(ListSearchText),
  sort: lenientSearchParam(Schema.Literals(sortColumns)),
  desc: lenientSearchParam(Schema.Boolean),
  page: lenientSearchParam(Schema.Natural),
  size: lenientSearchParam(Schema.Literals(LIST_PAGE_SIZES)),
});

interface ListSorting<Sort extends string> {
  readonly defaults: ListView<Sort>;
  readonly isSort: (id: string) => id is Sort;
}

export interface ListViewDefinition<Columns extends SortColumns> extends ListSorting<
  Columns[number]
> {
  readonly searchFields: ReturnType<typeof listSearchFields<Columns>>;
  readonly viewOf: (search: Partial<ListSearch<Columns[number]>>) => ListView<Columns[number]>;
  readonly searchOf: (view: ListView<Columns[number]>) => ListSearch<Columns[number]>;
  readonly requestPage: (view: ListView<Columns[number]>) => ListPage<Columns[number]>;
}

export const listView = <const Columns extends SortColumns>(input: {
  readonly sortColumns: Columns;
  readonly sort: Columns[number];
  readonly desc: boolean;
}): ListViewDefinition<Columns> => {
  const defaults: ListView<Columns[number]> = {
    sort: input.sort,
    desc: input.desc,
    page: 0,
    size: DEFAULT_LIST_PAGE_SIZE,
  };
  const sortable: ReadonlyArray<string> = input.sortColumns;
  return {
    defaults,
    isSort: (id): id is Columns[number] => sortable.includes(id),
    searchFields: listSearchFields(input.sortColumns),
    viewOf: (search) => ({
      q: search.q,
      sort: search.sort ?? defaults.sort,
      desc: search.desc ?? defaults.desc,
      page: search.page ?? defaults.page,
      size: search.size ?? defaults.size,
    }),
    searchOf: (view) => ({
      q: view.q || undefined,
      sort: view.sort === defaults.sort ? undefined : view.sort,
      desc: view.desc === defaults.desc ? undefined : view.desc,
      page: view.page || undefined,
      size: view.size === defaults.size ? undefined : view.size,
    }),
    requestPage: (view) => ({
      sort: { column: view.sort, direction: view.desc ? "desc" : "asc" },
      pageIndex: view.page,
      pageSize: view.size,
    }),
  };
};

export type ListFilters = Readonly<Record<string, string | undefined>>;

const columnFiltersOf = (filters: ListFilters): ColumnFiltersState =>
  Object.entries(filters).flatMap(([id, value]) => (value ? [{ id, value }] : []));

const filtersOf = (columnFilters: ColumnFiltersState): ListFilters =>
  Object.fromEntries(
    columnFilters.flatMap(({ id, value }) =>
      isString(value) && value.trim() !== "" ? [[id, value]] : [],
    ),
  );

const pageSizeOf = (size: number): ListPageSize =>
  LIST_PAGE_SIZES.find((candidate) => candidate === size) ?? DEFAULT_LIST_PAGE_SIZE;

const lastPageIndex = (total: number, pageSize: number) =>
  Math.max(0, Math.ceil(total / Math.max(1, pageSize)) - 1);

export function useListTable<
  Row extends RowData,
  Sort extends string,
  View extends ListView<Sort>,
>(input: {
  readonly list: ListSorting<Sort>;
  readonly columns: TableOptions<ListTableFeatures, Row>["columns"];
  readonly rows: ReadonlyArray<Row>;
  readonly total: number;
  readonly getRowId: (row: Row) => string;
  readonly view: View;
  readonly onViewChange: (view: View) => void;
  readonly loading: boolean;
  readonly filters: ListFilters;
  readonly viewWithFilters: (filters: ListFilters) => View;
  readonly initialState?: TableOptions<ListTableFeatures, Row>["initialState"];
}): ReactTable<ListTableFeatures, Row> {
  const { list, view, onViewChange, viewWithFilters } = input;
  const pagination: PaginationState = { pageIndex: view.page, pageSize: view.size };
  const sorting: SortingState = [{ id: view.sort, desc: view.desc }];
  const columnFilters = columnFiltersOf(input.filters);

  const lastPage = lastPageIndex(input.total, view.size);
  const beyond = !input.loading && view.page > lastPage;
  const clamp = useEffectEvent(() => onViewChange({ ...view, page: lastPage }));
  useEffect(() => {
    if (beyond) clamp();
  }, [beyond, lastPage]);

  return useTable({
    features: listTableFeatures,
    columns: input.columns,
    data: input.rows,
    getRowId: input.getRowId,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: input.total,
    state: { pagination, sorting, columnFilters },
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next = functionalUpdate(updater, pagination);
      const size = pageSizeOf(next.pageSize);
      onViewChange({
        ...view,
        size,
        page: size === view.size ? Math.max(0, next.pageIndex) : 0,
      });
    },
    onSortingChange: (updater: Updater<SortingState>) => {
      const [first] = functionalUpdate(updater, sorting);
      onViewChange(
        first && list.isSort(first.id)
          ? { ...view, sort: first.id, desc: first.desc, page: 0 }
          : { ...view, sort: list.defaults.sort, desc: list.defaults.desc, page: 0 },
      );
    },
    onColumnFiltersChange: (updater: Updater<ColumnFiltersState>) =>
      onViewChange({
        ...viewWithFilters(filtersOf(functionalUpdate(updater, columnFilters))),
        page: 0,
      }),
    initialState: input.initialState,
  });
}

export interface ShownRequest<Request> {
  readonly request: Request;
  readonly loading: boolean;
}

export function useShownRequest<Request>(request: Request): ShownRequest<Request> {
  const shown = useDeferredValue(request);
  return { request: shown, loading: request !== shown };
}

export function ListTableContent({ loading }: { readonly loading: boolean }) {
  return (
    <div aria-busy={loading} className={cn("transition-opacity", loading && "opacity-60")}>
      <DataTableContent>
        <DataTableFooter>
          <DataTablePagination pageSizes={LIST_PAGE_SIZES} />
        </DataTableFooter>
      </DataTableContent>
    </div>
  );
}
