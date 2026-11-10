export {
  INVOICE_SORT_COLUMNS,
  MAX_LIST_SEARCH_LENGTH,
  PRODUCT_SORT_COLUMNS,
  PURCHASE_ORDER_SORT_COLUMNS,
  PURCHASE_ORDER_TABS,
  type InvoiceSortColumn,
  type ProductSortColumn,
  type PurchaseOrderSortColumn,
  type PurchaseOrderTab,
  type SortDirection,
} from "@store/contracts/replica";
import {
  MAX_LIST_PAGE_SIZE,
  MAX_LIST_SEARCH_LENGTH,
  type SortDirection,
} from "@store/contracts/replica";

type ListSort<Column extends string> = {
  readonly column: Column;
  readonly direction: SortDirection;
};

export type ListPage<Column extends string> = {
  readonly sort: ListSort<Column>;
  readonly pageIndex: number;
  readonly pageSize: number;
};

export const boundedPage = <Column extends string>(page: ListPage<Column>): ListPage<Column> => ({
  sort: { column: page.sort.column, direction: page.sort.direction },
  pageIndex: Math.max(0, Math.floor(page.pageIndex)),
  pageSize: Math.min(MAX_LIST_PAGE_SIZE, Math.max(1, Math.floor(page.pageSize))),
});

export const boundedText = (text: string | undefined): string =>
  (text ?? "").slice(0, MAX_LIST_SEARCH_LENGTH);
