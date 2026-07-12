import { createFileRoute } from "@tanstack/react-router";

import { InvoicesPage } from "@/components/invoices/invoices-page";

export const Route = createFileRoute("/invoices/")({
  loader: () => window.offlineStore.listInvoices(),
  component: InvoicesRoute,
});

function InvoicesRoute() {
  return <InvoicesPage invoices={Route.useLoaderData()} />;
}
