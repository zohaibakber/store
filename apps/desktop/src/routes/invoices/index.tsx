import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as React from "react";

import { InvoicesPage } from "@/components/invoices/page";
import {
  DEFAULT_INVOICE_LIST_VIEW,
  INVOICE_PAGE_SIZES,
  type InvoiceListView,
} from "@/components/invoices/table";
import { formValidator } from "@/lib/form-schema";
import {
  INVOICE_SORT_COLUMNS,
  preloadInventory,
  preloadInvoiceList,
  type InvoiceListRequest,
} from "@/lib/inventory";
import { lenientSearchParam } from "@/lib/search-param";

const InvoicesSearch = Schema.Struct({
  q: lenientSearchParam(Schema.String.check(Schema.isMaxLength(120))),
  sort: lenientSearchParam(Schema.Literals(INVOICE_SORT_COLUMNS)),
  desc: lenientSearchParam(Schema.Boolean),
  page: lenientSearchParam(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  size: lenientSearchParam(Schema.Literals(INVOICE_PAGE_SIZES)),
});

const invoicesSearch = formValidator(InvoicesSearch);

const viewFor = (search: typeof InvoicesSearch.Type): InvoiceListView => ({
  q: search.q,
  sort: search.sort ?? DEFAULT_INVOICE_LIST_VIEW.sort,
  desc: search.desc ?? DEFAULT_INVOICE_LIST_VIEW.desc,
  page: search.page ?? DEFAULT_INVOICE_LIST_VIEW.page,
  size: search.size ?? DEFAULT_INVOICE_LIST_VIEW.size,
});

const requestFor = (view: InvoiceListView): InvoiceListRequest => ({
  filters: { customer: view.q?.trim() || undefined },
  sort: { column: view.sort, direction: view.desc ? "desc" : "asc" },
  pageIndex: view.page,
  pageSize: view.size,
});

const searchFor = (view: InvoiceListView) => ({
  q: view.q || undefined,
  sort: view.sort === DEFAULT_INVOICE_LIST_VIEW.sort ? undefined : view.sort,
  desc: view.desc === DEFAULT_INVOICE_LIST_VIEW.desc ? undefined : view.desc,
  page: view.page || undefined,
  size: view.size === DEFAULT_INVOICE_LIST_VIEW.size ? undefined : view.size,
});

export const Route = createFileRoute("/invoices/")({
  validateSearch: invoicesSearch,
  loader: ({ context, location }) =>
    preloadInventory(context, (inventory) =>
      preloadInvoiceList(inventory, requestFor(viewFor(location.search))),
    ),
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = React.useMemo(() => viewFor(search), [search]);
  const request = React.useMemo(() => requestFor(view), [view]);
  const shownRequest = React.useDeferredValue(request);
  return (
    <InvoicesPage
      loading={request !== shownRequest}
      onViewChange={(next) => void navigate({ search: searchFor(next), replace: true })}
      request={shownRequest}
      view={view}
    />
  );
}
