import { INVOICE_SORT_COLUMNS, type InvoiceSortColumn } from "@store/inventory-react";

import { listView, type ListView } from "@/lib/list-view";

export const invoiceList = listView({
  sortColumns: INVOICE_SORT_COLUMNS,
  sort: "createdAt",
  desc: true,
});

export type InvoiceListView = ListView<InvoiceSortColumn>;
