import { createFileRoute } from "@tanstack/react-router";

import { InvoiceCreatePage } from "@/components/invoices/invoice-create-page";

export const Route = createFileRoute("/invoices/new")({
  loader: () => window.offlineStore.listProducts(),
  component: NewInvoiceRoute,
});

function NewInvoiceRoute() {
  return <InvoiceCreatePage products={Route.useLoaderData()} />;
}
