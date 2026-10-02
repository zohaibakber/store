import {
  PURCHASE_ORDER_SORT_COLUMNS,
  type PurchaseOrderSortColumn,
  type PurchaseOrderTab,
} from "@store/inventory-react";

import { listView, type ListView } from "@/lib/list-view";

export const purchaseOrderList = listView({
  sortColumns: PURCHASE_ORDER_SORT_COLUMNS,
  sort: "createdAt",
  desc: true,
});

export const DEFAULT_PURCHASE_ORDER_TAB: PurchaseOrderTab = "open";

export type PurchaseOrderListView = ListView<PurchaseOrderSortColumn> & {
  readonly tab: PurchaseOrderTab;
};
