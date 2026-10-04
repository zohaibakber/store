import * as Schema from "effect/Schema";

import { CategoryId, SupplierId } from "../ids";
import { MAX_LIST_PAGE_SIZE, MAX_LIST_SEARCH_LENGTH } from "./limits";

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

export const PRODUCT_FACET_COLUMNS = [
  "categoryId",
  "name",
  "aisle",
  "composition",
  "strength",
] as const;
export type ProductFacetColumn = (typeof PRODUCT_FACET_COLUMNS)[number];

export const PURCHASE_ORDER_TABS = ["open", "drafts", "closed"] as const;
export type PurchaseOrderTab = (typeof PURCHASE_ORDER_TABS)[number];

export const PURCHASE_ORDER_SORT_COLUMNS = ["createdAt", "orderNumber"] as const;
export type PurchaseOrderSortColumn = (typeof PURCHASE_ORDER_SORT_COLUMNS)[number];

export const SortDirection = Schema.Literals(["asc", "desc"]);
export type SortDirection = typeof SortDirection.Type;

export const PageSize = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_LIST_PAGE_SIZE }),
);

export const ListPage = <const Columns extends ReadonlyArray<string>>(columns: Columns) =>
  Schema.Struct({
    sort: Schema.Struct({ column: Schema.Literals(columns), direction: SortDirection }),
    pageIndex: Schema.Natural,
    pageSize: PageSize,
  });

export const ListSearchText = Schema.String.check(Schema.isMaxLength(MAX_LIST_SEARCH_LENGTH));

export const ProductListFilters = Schema.Struct({
  search: Schema.optionalKey(ListSearchText),
  categoryId: Schema.optionalKey(CategoryId),
  aisle: Schema.optionalKey(ListSearchText),
  composition: Schema.optionalKey(ListSearchText),
  strength: Schema.optionalKey(ListSearchText),
});
export type ProductListFilters = typeof ProductListFilters.Type;

export const InvoiceListFilters = Schema.Struct({
  customer: Schema.optionalKey(ListSearchText),
});
export type InvoiceListFilters = typeof InvoiceListFilters.Type;

export const PurchaseOrderListFilters = Schema.Struct({
  tab: Schema.Literals(PURCHASE_ORDER_TABS),
  supplierIds: Schema.optionalKey(Schema.Array(SupplierId)),
});
export type PurchaseOrderListFilters = typeof PurchaseOrderListFilters.Type;

export const ProductListRequest = Schema.Struct({
  ...ListPage(PRODUCT_SORT_COLUMNS).fields,
  filters: ProductListFilters,
});
export type ProductListRequest = typeof ProductListRequest.Type;

export const InvoiceListRequest = Schema.Struct({
  ...ListPage(INVOICE_SORT_COLUMNS).fields,
  filters: InvoiceListFilters,
});
export type InvoiceListRequest = typeof InvoiceListRequest.Type;

export const PurchaseOrderListRequest = Schema.Struct({
  ...ListPage(PURCHASE_ORDER_SORT_COLUMNS).fields,
  filters: PurchaseOrderListFilters,
});
export type PurchaseOrderListRequest = typeof PurchaseOrderListRequest.Type;
