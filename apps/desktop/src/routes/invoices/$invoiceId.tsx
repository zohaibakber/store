import { createFileRoute } from "@tanstack/react-router";

import { InvoiceDetailError, InvoiceDetailPage } from "@/components/invoices/detail-page";
import { useInventoryInvoice } from "@/lib/inventory-db";

export const Route = createFileRoute("/invoices/$invoiceId")({
  component: InvoiceDetailRoute,
  errorComponent: InvoiceDetailError,
  staticData: { breadcrumb: "Invoice" },
});

function InvoiceDetailRoute() {
  const { invoiceId } = Route.useParams();
  const invoice = useInventoryInvoice(invoiceId);
  if (invoice.data) return <InvoiceDetailPage invoice={invoice.data} />;
  if (invoice.isError) {
    return <InvoiceDetailError error={new Error("The invoice could not be loaded.")} />;
  }
  if (!invoice.isReady && !invoice.data) return null;
  return <InvoiceDetailError error={new Error(`Invoice ${invoiceId} was not found.`)} />;
}
