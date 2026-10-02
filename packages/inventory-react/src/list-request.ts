export const MAX_LIST_SEARCH_LENGTH = 120;

type ListSort<Column extends string> = {
  readonly column: Column;
  readonly direction: "asc" | "desc";
};

export type ListPage<Column extends string> = {
  readonly sort: ListSort<Column>;
  readonly pageIndex: number;
  readonly pageSize: number;
};

export const INVOICE_SORT_COLUMNS = ["createdAt", "invoiceNumber"] as const;
export type InvoiceSortColumn = (typeof INVOICE_SORT_COLUMNS)[number];

export const PRODUCT_SORT_COLUMNS = [
  "name",
  "aisle",
  "unitsPerPack",
  "purchasePrice",
  "retailPrice",
  "unitPrice",
  "updatedAt",
] as const;
export type ProductSortColumn = (typeof PRODUCT_SORT_COLUMNS)[number];

export const PURCHASE_ORDER_TABS = ["open", "drafts", "closed"] as const;
export type PurchaseOrderTab = (typeof PURCHASE_ORDER_TABS)[number];

export const PURCHASE_ORDER_SORT_COLUMNS = ["createdAt", "orderNumber"] as const;
export type PurchaseOrderSortColumn = (typeof PURCHASE_ORDER_SORT_COLUMNS)[number];
