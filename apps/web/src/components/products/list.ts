import { PRODUCT_SORT_COLUMNS, type ProductSortColumn } from "@store/inventory-react";

import { listView, type ListView } from "@/lib/list-view";

export const productList = listView({
  sortColumns: PRODUCT_SORT_COLUMNS,
  sort: "name",
  desc: false,
});

export type ProductListView = ListView<ProductSortColumn> & {
  readonly category?: string;
  readonly aisle?: string;
  readonly composition?: string;
  readonly strength?: string;
};
