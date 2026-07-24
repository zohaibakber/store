import { createFileRoute } from "@tanstack/react-router";

import { InvoiceDetailError, InvoiceDetailPage } from "@/components/invoices/detail-page";

export const Route = createFileRoute("/invoices/$invoiceId")({
  loader: ({ params }) => window.offlineStore.getInvoice({ id: params.invoiceId }),
  component: InvoiceDetailRoute,
  errorComponent: InvoiceDetailError,
});

function InvoiceDetailRoute() {
  return <InvoiceDetailPage invoice={Route.useLoaderData()} />;
}
