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
import { useDeferredValue, useEffect, useEffectEvent } from "react";

import {
  DataTableContent,
  DataTableFooter,
  DataTablePagination,
  type DataTableColumnMeta,
} from "@/components/shared/data-table";
import { LIST_PAGE_SIZES, listPageSizeOf, type ListSorting, type ListView } from "@/lib/list-view";
import { isString } from "@/lib/predicates";
import { cn } from "@/lib/utils";

export const listTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type ListTableFeatures = typeof listTableFeatures;

export type ListFilters = Readonly<Record<string, string | undefined>>;

const columnFiltersOf = (filters: ListFilters): ColumnFiltersState =>
  Object.entries(filters).flatMap(([id, value]) => (value ? [{ id, value }] : []));

const filtersOf = (columnFilters: ColumnFiltersState): ListFilters =>
  Object.fromEntries(
    columnFilters.flatMap(({ id, value }) =>
      isString(value) && value.trim() !== "" ? [[id, value]] : [],
    ),
  );

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
      const size = listPageSizeOf(next.pageSize);
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
