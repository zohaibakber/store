import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { createFileRoute } from "@tanstack/react-router";

import { InvoiceDetailError, InvoiceDetailPage } from "@/components/invoices/detail-page";

export const Route = createFileRoute("/invoices/$invoiceId")({
  loader: ({ context, params }) => context.store.getInvoice({ id: params.invoiceId }),
  component: InvoiceDetailRoute,
  errorComponent: InvoiceDetailError,
  staticData: {
    breadcrumb: (loaderData) =>
      loaderData && "invoiceNumber" in loaderData
        ? `Invoice #${formatInvoiceNumber(loaderData.invoiceNumber)}`
        : "Invoice",
  },
});

function InvoiceDetailRoute() {
  return <InvoiceDetailPage invoice={Route.useLoaderData()} />;
}
