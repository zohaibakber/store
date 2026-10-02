import { MAX_LIST_SEARCH_LENGTH, type ListPage } from "@store/inventory-react";
import * as Schema from "effect/Schema";

import { lenientSearchParam } from "@/lib/search-param";

export const LIST_PAGE_SIZES = [25, 50, 100] as const;
type ListPageSize = (typeof LIST_PAGE_SIZES)[number];

const DEFAULT_LIST_PAGE_SIZE: ListPageSize = 50;

export const listPageSizeOf = (size: number): ListPageSize =>
  LIST_PAGE_SIZES.find((candidate) => candidate === size) ?? DEFAULT_LIST_PAGE_SIZE;

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

export interface ListSorting<Sort extends string> {
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
