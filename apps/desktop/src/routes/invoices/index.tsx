import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as React from "react";

import { InvoicesPage } from "@/components/invoices/page";
import { invoiceList, type InvoiceListView } from "@/components/invoices/table";
import { useShownRequest } from "@/components/shared/list-view";
import { formValidator } from "@/lib/form-schema";
import { preloadInventory, preloadInvoiceList, type InvoiceListRequest } from "@/lib/inventory";

const invoicesSearch = formValidator(Schema.Struct(invoiceList.searchFields));

const requestFor = (view: InvoiceListView): InvoiceListRequest => ({
  filters: { customer: view.q?.trim() || undefined },
  ...invoiceList.requestPage(view),
});

export const Route = createFileRoute("/invoices/")({
  validateSearch: invoicesSearch,
  loader: ({ context, location }) =>
    preloadInventory(context, (inventory) =>
      preloadInvoiceList(inventory, requestFor(invoiceList.viewOf(location.search))),
    ),
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = React.useMemo(() => invoiceList.viewOf(search), [search]);
  const { request, loading } = useShownRequest(React.useMemo(() => requestFor(view), [view]));
  return (
    <InvoicesPage
      loading={loading}
      onViewChange={(next) => void navigate({ search: invoiceList.searchOf(next), replace: true })}
      request={request}
      view={view}
    />
  );
}
